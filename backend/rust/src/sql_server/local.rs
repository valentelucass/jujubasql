use super::{connection::Login, Parameter, Row};
use crate::{
    error::{AppError, Result},
    models::QueryOutput,
};
use odbc_api::{
    environment, parameter::InputParameter, Connection, ConnectionOptions, Cursor, IntoParameter,
    ResultSetMetadata,
};
use std::{
    fmt::Write,
    sync::{Arc, Mutex},
};
use zeroize::Zeroizing;

pub type LocalConnection = Arc<Mutex<Connection<'static>>>;

pub async fn open(
    instance: Option<&str>,
    database: &str,
    login: &Login,
) -> Result<LocalConnection> {
    let server = instance.map_or_else(|| "lpc:.".to_owned(), |name| format!("lpc:.\\{name}"));
    let mut attributes = Zeroizing::new(format!(
        "Server={server};Database={};Encrypt=Optional;TrustServerCertificate=No;APP=Nexo SQL;",
        attribute(database)
    ));
    match login {
        Login::Windows => attributes.push_str("Trusted_Connection=Yes;"),
        Login::Sql { user, password } => {
            let password = Zeroizing::new(attribute(password.as_str()));
            write!(
                attributes,
                "UID={};PWD={};",
                attribute(user),
                password.as_str()
            )
            .expect("escrever parâmetros em memória");
        }
    }
    blocking(move || {
        let env = environment().map_err(local_error)?;
        let drivers = env.drivers().map_err(local_error)?;
        let driver = ["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server"]
            .into_iter()
            .find(|name| drivers.iter().any(|entry| entry.description == *name))
            .ok_or_else(|| AppError::new("driver", "Instale o Microsoft ODBC Driver 18 para SQL Server (x64) para usar a conexão neste computador."))?;
        if driver.starts_with("ODBC Driver 17") {
            let compatible = Zeroizing::new(attributes.replacen("Encrypt=Optional;", "Encrypt=No;", 1));
            attributes = compatible;
        }
        let mut connection_string = Zeroizing::new(format!("Driver={{{driver}}};"));
        connection_string.push_str(&attributes);
        let connection = env.connect_with_connection_string(
            &connection_string,
            ConnectionOptions { login_timeout_sec: Some(6), ..Default::default() },
        ).map_err(local_error)?;
        Ok(Arc::new(Mutex::new(connection)))
    }).await
}

fn attribute(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    escaped.push('{');
    for ch in value.chars() {
        if ch == '}' {
            escaped.push('}');
        }
        escaped.push(ch);
    }
    escaped.push('}');
    escaped
}

pub async fn query(
    connection: LocalConnection,
    sql: String,
    parameters: Vec<Parameter>,
) -> Result<Vec<Row>> {
    blocking(move || {
        let connection = connection.lock().map_err(|_| local_worker_error())?;
        let mut cursor = execute(&connection, &sql, &parameters)?;
        let names: Arc<[String]> = cursor
            .column_names()
            .map_err(local_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(local_error)?
            .into();
        let mut buffer = Vec::new();
        let mut rows = Vec::new();
        while let Some(mut row) = cursor.next_row().map_err(local_error)? {
            let mut cells = Vec::with_capacity(names.len());
            for column in 1..=names.len() as u16 {
                let present = row
                    .get_wide_text(column, &mut buffer)
                    .map_err(local_error)?;
                cells.push(present.then(|| String::from_utf16_lossy(&buffer)));
            }
            rows.push(Row::Local {
                names: Arc::clone(&names),
                cells,
            });
        }
        Ok(rows)
    })
    .await
}

pub async fn read_editor(connection: LocalConnection, sql: String) -> Result<QueryOutput> {
    blocking(move || {
        let connection = connection.lock().map_err(|_| local_worker_error())?;
        connection
            .execute(&super::editor_row_limit(), (), Some(20))
            .map_err(local_error)?;
        let mut cursor = execute(&connection, &sql, &[])?;
        let columns = cursor
            .column_names()
            .map_err(local_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(local_error)?;
        let mut buffer = Vec::new();
        let mut rows = Vec::new();
        while let Some(mut row) = cursor.next_row().map_err(local_error)? {
            if rows.len() == super::EDITOR_LIMIT {
                return Ok(QueryOutput {
                    columns,
                    rows,
                    truncated: true,
                });
            }
            let mut cells = Vec::with_capacity(columns.len());
            for index in 1..=columns.len() as u16 {
                let present = row.get_wide_text(index, &mut buffer).map_err(local_error)?;
                cells.push(
                    present.then(|| super::editor_preview(&String::from_utf16_lossy(&buffer))),
                );
            }
            rows.push(cells);
        }
        Ok(QueryOutput {
            columns,
            rows,
            truncated: false,
        })
    })
    .await
}

fn execute<'a>(
    connection: &'a Connection<'_>,
    sql: &str,
    parameters: &[Parameter],
) -> Result<impl Cursor + 'a> {
    // Bind the statement and its parameters separately. The ODBC driver generates
    // its own parameter names, so declaring @P1 in its outer batch can collide.
    let cursor = if parameters.is_empty() {
        connection.execute(sql, (), Some(20))
    } else {
        let mut definitions = Vec::with_capacity(parameters.len());
        let mut bindings: Vec<Box<dyn InputParameter>> = Vec::with_capacity(parameters.len() + 2);
        bindings.push(Box::new(sql.into_parameter()));
        for (index, parameter) in parameters.iter().enumerate() {
            let sql_type = match parameter {
                Parameter::Int(_) => "int",
                Parameter::Text(_) | Parameter::NullableText(_) => "nvarchar(4000)",
            };
            definitions.push(format!("@P{} {sql_type}", index + 1));
        }
        bindings.push(Box::new(definitions.join(", ").into_parameter()));
        for parameter in parameters {
            match parameter {
                Parameter::Int(value) => bindings.push(Box::new(*value)),
                Parameter::Text(value) => bindings.push(Box::new(value.as_str().into_parameter())),
                Parameter::NullableText(value) => {
                    bindings.push(Box::new(value.as_deref().into_parameter()))
                }
            }
        }
        let markers = vec!["?"; bindings.len()].join(", ");
        connection.execute(
            &format!("EXEC sys.sp_executesql {markers}"),
            bindings.as_slice(),
            Some(20),
        )
    };
    cursor
        .map_err(local_error)?
        .ok_or_else(super::unexpected_catalog)
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| local_worker_error())?
}

fn local_worker_error() -> AppError {
    AppError::new(
        "application",
        "Não foi possível concluir a operação com o SQL Server local.",
    )
}

fn local_error(error: odbc_api::Error) -> AppError {
    if let odbc_api::Error::Diagnostics { record, .. } = error {
        match record.native_error {
            18452 | 18456 | 18470 | 18486 | 18487 | 18488 => return AppError::authentication(),
            229 | 230 | 297 | 916 | 4060 | 4064 => return AppError::denied(),
            _ => {}
        }
        match record.state.as_str() {
            "28000" => return AppError::authentication(),
            "HYT00" | "HYT01" => return AppError::new("timeout", "O SQL Server local demorou demais para responder."),
            state if state.starts_with("08") => return AppError::new(
                "network", "Não foi possível abrir a instância local. Confira se ela está em execução e se a memória compartilhada está ativa.",
            ),
            _ => {}
        }
    }
    AppError::new(
        "query",
        "O SQL Server local não conseguiu concluir a leitura.",
    )
}
