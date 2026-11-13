use crate::{
    credentials::PasswordKey,
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
    pub async fn connect(
        &self,
        input: ConnectInput,
        use_saved: bool,
        remember: bool,
    ) -> Result<Connected> {
        let key = PasswordKey::for_input(&input);
        let saved = if use_saved && input.password.is_none() {
            Some(
                key.as_ref()
                    .map(PasswordKey::read)
                    .transpose()?
                    .flatten()
                    .ok_or_else(|| {
                        AppError::new(
                            "credentials",
                            "A senha salva não está disponível. Digite a senha para conectar.",
                        )
                    })?,
            )
        } else {
            None
        };
        let profile = Arc::new(Profile::with_saved_password(input, saved)?);
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
        let password_save_failed = remember
            && key
                .as_ref()
                .zip(profile.sql_password())
                .is_some_and(|(key, password)| key.save(password).is_err());
        state.active = Some(Session {
            profile,
            databases: databases.iter().cloned().collect(),
        });
        Ok(Connected {
            session: revision,
            endpoint,
            transport,
            databases,
            password_save_failed,
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
