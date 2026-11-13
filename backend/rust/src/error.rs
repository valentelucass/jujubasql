use serde::Serialize;
use std::{future::Future, time::Duration};

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, Serialize)]
pub struct AppError {
    pub kind: &'static str,
    pub message: &'static str,
}

impl AppError {
    pub const fn new(kind: &'static str, message: &'static str) -> Self {
        Self { kind, message }
    }

    pub const fn authentication() -> Self {
        Self::new(
            "authentication",
            "O SQL Server rejeitou o login. Confira o usuário, a senha e o tipo de autenticação.",
        )
    }

    pub const fn denied() -> Self {
        Self::new(
            "authorization",
            "O login não tem acesso a este banco ou objeto.",
        )
    }
}

impl From<tiberius::error::Error> for AppError {
    fn from(error: tiberius::error::Error) -> Self {
        use tiberius::error::Error;
        match error {
            Error::Server(server) => match server.code() {
                18452 | 18456 | 18470 | 18486 | 18487 | 18488 => {
                    Self::authentication()
                }
                229 | 230 | 297 | 916 | 4060 | 4064 => Self::denied(),
                208 => Self::new("catalog", "O objeto mudou ou foi removido. Atualize o explorador."),
                _ => Self::new("query", "O SQL Server não conseguiu concluir a leitura."),
            },
            Error::Tls(_) => Self::new(
                "certificate",
                "Falha na negociação TLS. Confira o nome DNS, a validade e a confiança no certificado do SQL Server.",
            ),
            Error::Io { .. } => Self::new("network", "A comunicação com o SQL Server falhou."),
            _ => Self::new("query", "Não foi possível interpretar a resposta do SQL Server."),
        }
    }
}

pub async fn deadline<T>(operation: impl Future<Output = Result<T>>) -> Result<T> {
    tokio::time::timeout(Duration::from_secs(25), operation)
        .await
        .map_err(|_| AppError::new("timeout", "O SQL Server demorou demais para responder."))?
}
