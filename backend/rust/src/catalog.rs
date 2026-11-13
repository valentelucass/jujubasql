use crate::{
    connection::Connections,
    error::{deadline, Result},
    models::{Scope, Structure, Table, TableScope},
    sql_server::catalog,
};

pub async fn schemas(connections: &Connections, scope: Scope) -> Result<Vec<String>> {
    deadline(async { catalog::schemas(&mut connections.open_database(&scope).await?).await }).await
}

pub async fn tables(connections: &Connections, scope: Scope, schema: String) -> Result<Vec<Table>> {
    deadline(async {
        catalog::tables(&mut connections.open_database(&scope).await?, &schema).await
    })
    .await
}

pub async fn structure(connections: &Connections, scope: TableScope) -> Result<Structure> {
    deadline(async {
        let mut client = connections.open_database(&scope.scope).await?;
        let table = catalog::table(&mut client, scope.table_id).await?;
        let columns = catalog::columns(&mut client, table.id).await?;
        let indexes = catalog::indexes(&mut client, table.id).await?;
        Ok(Structure {
            table,
            columns,
            indexes,
        })
    })
    .await
}
