use crate::{
    error::{deadline, AppError, Result},
    models::{ConnectInput, Connected, Scope},
    sql_server::{
        catalog,
        connection::{Profile, SqlClient},
    },
};
use std::{collections::HashSet, sync::Arc};
use tokio::sync::RwLock;

#[derive(Default)]
pub struct Connections {
    state: RwLock<ConnectionState>,
}

#[derive(Default)]
struct ConnectionState {
    revision: u32,
    active: Option<Session>,
}

struct Session {
    profile: Arc<Profile>,
    databases: HashSet<String>,
}

impl Connections {
    pub async fn connect(&self, input: ConnectInput) -> Result<Connected> {
        let profile = Arc::new(Profile::new(input)?);
        let revision = self.clear().await;
        let databases = deadline(async {
            let mut client = profile.open("master").await?;
            catalog::databases(&mut client).await
        })
        .await?;

        let endpoint = profile.endpoint();
        let transport = profile.transport();
        let mut state = self.state.write().await;
        if state.revision != revision {
            return Err(AppError::new(
                "disconnected",
                "A conexão foi substituída ou encerrada.",
            ));
        }
        state.active = Some(Session {
            profile,
            databases: databases.iter().cloned().collect(),
        });
        Ok(Connected {
            session: revision,
            endpoint,
            transport,
            databases,
        })
    }

    async fn clear(&self) -> u32 {
        let mut state = self.state.write().await;
        state.revision = state.revision.wrapping_add(1);
        state.active = None;
        state.revision
    }

    pub async fn disconnect(&self) {
        self.clear().await;
    }

    pub async fn open_database(&self, scope: &Scope) -> Result<SqlClient> {
        let profile = {
            let state = self.state.read().await;
            let session = state
                .active
                .as_ref()
                .filter(|_| state.revision == scope.session)
                .ok_or_else(|| {
                    AppError::new(
                        "disconnected",
                        "A conexão foi encerrada. Conecte novamente.",
                    )
                })?;
            if !session.databases.contains(&scope.database) {
                return Err(AppError::denied());
            }
            Arc::clone(&session.profile)
        };
        profile.open(&scope.database).await
    }
}
