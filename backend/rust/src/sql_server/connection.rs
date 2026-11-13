use super::{local, Parameter, Row};
use crate::{
    error::{AppError, Result},
    models::{Authentication, ConnectInput, QueryOutput, Transport},
};
use std::time::Duration;
use tiberius::{AuthMethod, Client, Config, EncryptionLevel};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};
use zeroize::Zeroizing;

pub enum SqlClient {
    Network(Box<Client<Compat<TcpStream>>>),
    Local(local::LocalConnection),
}

impl SqlClient {
    pub async fn set_dashboard_lock_timeout(&mut self) -> Result<()> {
        match self {
            Self::Local(connection) => local::set_dashboard_lock_timeout(connection.clone()).await,
            Self::Network(client) => {
                client
                    .simple_query(super::DASHBOARD_LOCK_TIMEOUT)
                    .await?
                    .into_results()
                    .await?;
                Ok(())
            }
        }
    }
    pub async fn read_editor(&mut self, sql: &str) -> Result<QueryOutput> {
        match self {
            Self::Local(connection) => local::read_editor(connection.clone(), sql.to_owned()).await,
            Self::Network(client) => {
                client
                    .simple_query(super::editor_row_limit())
                    .await?
                    .into_results()
                    .await?;
                let mut results = client.simple_query(sql).await?;
                let columns = results
                    .columns()
                    .await?
                    .ok_or_else(super::unexpected_catalog)?
                    .iter()
                    .map(|col| col.name().to_owned())
                    .collect();
                use futures_util::TryStreamExt;
                let mut rows = Vec::new();
                while let Some(item) = results.try_next().await? {
                    if let tiberius::QueryItem::Row(row) = item {
                        if rows.len() == super::EDITOR_LIMIT {
                            return Ok(QueryOutput {
                                columns,
                                rows,
                                truncated: true,
                            });
                        }
                        rows.push(
                            row.cells()
                                .enumerate()
                                .map(|(index, (_, value))| editor_cell(&row, index, value))
                                .collect(),
                        );
                    }
                }
                Ok(QueryOutput {
                    columns,
                    rows,
                    truncated: false,
                })
            }
        }
    }

    pub async fn query(&mut self, sql: &str, parameters: &[Parameter]) -> Result<Vec<Row>> {
        match self {
            Self::Network(client) => {
                let bindings: Vec<&dyn tiberius::ToSql> = parameters
                    .iter()
                    .map(|parameter| match parameter {
                        Parameter::Int(value) => value as &dyn tiberius::ToSql,
                        Parameter::Text(value) => value as &dyn tiberius::ToSql,
                        Parameter::NullableText(value) => value as &dyn tiberius::ToSql,
                    })
                    .collect();
                let rows = client
                    .query(sql, &bindings)
                    .await?
                    .into_first_result()
                    .await?;
                Ok(rows.into_iter().map(Row::Network).collect())
            }
            Self::Local(connection) => {
                local::query(connection.clone(), sql.to_owned(), parameters.to_vec()).await
            }
        }
    }
}

fn editor_cell(
    row: &tiberius::Row,
    index: usize,
    value: &tiberius::ColumnData<'_>,
) -> Option<String> {
    use tiberius::{
        time::chrono::{
            DateTime as OffsetDateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime,
        },
        ColumnData,
        ColumnData::*,
    };
    match value {
        U8(v) => v.map(|v| v.to_string()),
        I16(v) => v.map(|v| v.to_string()),
        I32(v) => v.map(|v| v.to_string()),
        I64(v) => v.map(|v| v.to_string()),
        F32(v) => v.map(|v| v.to_string()),
        F64(v) => v.map(|v| v.to_string()),
        Bit(v) => v.map(|v| if v { "1" } else { "0" }.to_owned()),
        String(v) => v.as_deref().map(super::editor_preview),
        Guid(v) => v.map(|v| v.to_string()),
        Numeric(v) => v.map(|v| v.to_string()),
        Xml(v) => v
            .as_ref()
            .map(|v| super::editor_preview(v.as_ref().as_ref())),
        Binary(v) => v.as_ref().map(|v| {
            use std::fmt::Write;
            let mut text = std::string::String::from("0x");
            for byte in v.iter().take(1024) {
                let _ = write!(text, "{byte:02X}");
            }
            if v.len() > 1024 {
                text.push('…');
            }
            text
        }),
        ColumnData::DateTime(_) | SmallDateTime(_) | DateTime2(_) => row
            .try_get::<NaiveDateTime, _>(index)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        Date(_) => row
            .try_get::<NaiveDate, _>(index)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        Time(_) => row
            .try_get::<NaiveTime, _>(index)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        DateTimeOffset(_) => row
            .try_get::<OffsetDateTime<FixedOffset>, _>(index)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
    }
}

enum Endpoint {
    Network { host: String, port: u16 },
    Local { instance: Option<String> },
}

pub struct Profile {
    endpoint: Endpoint,
    login: Login,
}

pub(super) enum Login {
    Windows,
    Sql {
        user: String,
        password: Zeroizing<String>,
    },
}

impl Profile {
    #[cfg(test)]
    pub fn new(input: ConnectInput) -> Result<Self> {
        Self::with_saved_password(input, None)
    }

    pub fn with_saved_password(
        input: ConnectInput,
        saved: Option<Zeroizing<String>>,
    ) -> Result<Self> {
        let password = saved.unwrap_or_else(|| Zeroizing::new(input.password.unwrap_or_default()));
        let endpoint = match input.transport {
            Transport::Network => network_endpoint(input.host, input.port)?,
            Transport::Local => {
                let instance = input
                    .instance
                    .map(|name| name.trim().to_owned())
                    .filter(|name| !name.is_empty() && !name.eq_ignore_ascii_case("MSSQLSERVER"));
                if instance.as_ref().is_some_and(|name| {
                    name.len() > 16
                        || !name
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$'))
                }) {
                    return Err(AppError::new(
                        "input",
                        "Informe apenas o nome da instância instalada neste computador.",
                    ));
                }
                Endpoint::Local { instance }
            }
        };
        let login = match input.authentication {
            Authentication::Windows => Login::Windows,
            Authentication::Sql => {
                let user = input.username.unwrap_or_default();
                let user = user.trim().to_owned();
                if user.is_empty()
                    || user.encode_utf16().count() > 128
                    || user.contains('\0')
                    || password.contains('\0')
                    || password.is_empty()
                    || password.encode_utf16().count() > 128
                {
                    return Err(AppError::new(
                        "input",
                        "Informe um usuário e uma senha do SQL Server válidos.",
                    ));
                }
                Login::Sql { user, password }
            }
        };
        Ok(Self { endpoint, login })
    }

    pub fn sql_password(&self) -> Option<&str> {
        match &self.login {
            Login::Sql { password, .. } => Some(password.as_str()),
            Login::Windows => None,
        }
    }

    pub fn endpoint(&self) -> String {
        match &self.endpoint {
            Endpoint::Network { host, port } => format!("{host}:{port}"),
            Endpoint::Local { instance } => instance.as_ref().map_or_else(
                || "Neste computador".to_owned(),
                |name| format!("Neste computador · {name}"),
            ),
        }
    }

    pub fn transport(&self) -> Transport {
        match self.endpoint {
            Endpoint::Network { .. } => Transport::Network,
            Endpoint::Local { .. } => Transport::Local,
        }
    }

    pub async fn open(&self, database: &str) -> Result<SqlClient> {
        let (host, port) = match &self.endpoint {
            Endpoint::Network { host, port } => (host, *port),
            Endpoint::Local { instance } => {
                return local::open(instance.as_deref(), database, &self.login)
                    .await
                    .map(SqlClient::Local)
            }
        };
        let mut config = Config::new();
        config.host(host);
        config.port(port);
        config.database(database);
        config.application_name("JujubaSQL");
        config.encryption(EncryptionLevel::Required);
        config.authentication(match &self.login {
            Login::Windows => AuthMethod::Integrated,
            Login::Sql { user, password } => AuthMethod::sql_server(user, password.as_str()),
        });
        let tcp = tokio::time::timeout(Duration::from_secs(6), TcpStream::connect((host.as_str(), port)))
            .await
            .ok()
            .and_then(std::result::Result::ok)
            .ok_or_else(|| AppError::new("network", "O servidor não respondeu na porta indicada. Confira o DNS e a rede privada ou VPN."))?;
        tcp.set_nodelay(true).map_err(|_| {
            AppError::new(
                "network",
                "Não foi possível preparar a conexão com o SQL Server.",
            )
        })?;
        Ok(SqlClient::Network(Box::new(
            Client::connect(config, tcp.compat_write()).await?,
        )))
    }
}

fn network_endpoint(host: String, port: u16) -> Result<Endpoint> {
    let host = host.trim().to_owned();
    let dns_name = host.len() <= 253
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        });
    if !dns_name || host.parse::<std::net::IpAddr>().is_ok() || port == 0 {
        return Err(AppError::new(
            "input",
            "Informe o nome DNS do servidor e uma porta válida.",
        ));
    }
    Ok(Endpoint::Network { host, port })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_dns_before_opening_a_socket() {
        for host in [
            "",
            "https://servidor.local",
            "127.0.0.1",
            "host\\instance",
            "host:1433",
        ] {
            let result = Profile::new(ConnectInput {
                host: host.to_owned(),
                port: 1433,
                transport: Transport::Network,
                instance: None,
                authentication: Authentication::Windows,
                username: None,
                password: None,
            });
            assert!(matches!(result, Err(AppError { kind: "input", .. })));
        }
    }

    #[test]
    fn local_profile_supports_default_and_named_instances() {
        for (input, expected) in [
            (None, None),
            (Some("MSSQLSERVER"), None),
            (Some("SQLEXPRESS"), Some("SQLEXPRESS")),
        ] {
            let profile = Profile::new(ConnectInput {
                host: String::new(),
                port: 0,
                transport: Transport::Local,
                instance: input.map(str::to_owned),
                authentication: Authentication::Windows,
                username: None,
                password: None,
            })
            .expect("perfil local válido");
            assert!(
                matches!(profile.endpoint, Endpoint::Local { instance } if instance.as_deref() == expected)
            );
        }
    }

    #[test]
    #[ignore = "requer uma instância SQL Server local com memória compartilhada"]
    fn local_connection_reaches_authentication() {
        let profile = Profile::new(ConnectInput {
            host: String::new(),
            port: 0,
            transport: Transport::Local,
            instance: None,
            authentication: Authentication::Sql,
            username: Some("JujubaSqlTesteLoginInexistente".to_owned()),
            password: Some("TesteLocalSemConta123!".to_owned()),
        })
        .expect("perfil local válido");
        let result = tauri::async_runtime::block_on(crate::error::deadline(profile.open("master")));
        match result {
            Err(error) => assert_eq!(error.kind, "authentication", "{error:?}"),
            Ok(_) => panic!("o login de teste não deveria existir"),
        }
    }

    #[test]
    #[ignore = "requer instância de teste com certificado inválido"]
    fn rejects_untrusted_sql_server_certificate() {
        let host = std::env::var("JUJUBASQL_TEST_UNTRUSTED_SQL_HOST")
            .expect("informar o DNS do SQL Server de teste");
        let profile = Profile::new(ConnectInput {
            host,
            port: 1433,
            transport: Transport::Network,
            instance: None,
            authentication: Authentication::Windows,
            username: None,
            password: None,
        })
        .expect("perfil de teste válido");
        let result = tauri::async_runtime::block_on(crate::error::deadline(profile.open("master")));
        match result {
            Err(error) => assert_eq!(error.kind, "certificate", "{error:?}"),
            Ok(_) => panic!("a conexão aceitou o certificado de teste"),
        }
    }
}
