use crate::{
    connection::Connections,
    error::Result,
    models::{DatabaseDiagram, Relationship, Scope, TableScope},
    sql_server::{catalog, relationships},
};

pub async fn database(connections: &Connections, scope: Scope) -> Result<DatabaseDiagram> {
    crate::error::deadline(async {
        let mut client = connections.open_database(&scope).await?;
        let tables = catalog::all_tables(&mut client).await?;
        let relationships = relationships::list(&mut client, None).await?;
        Ok(DatabaseDiagram {
            tables,
            relationships,
        })
    })
    .await
}

pub async fn list(connections: &Connections, scope: TableScope) -> Result<Vec<Relationship>> {
    crate::error::deadline(async {
        let mut client = connections.open_database(&scope.scope).await?;
        let table = catalog::table(&mut client, scope.table_id).await?;
        relationships::list(&mut client, Some(table.id)).await
    })
    .await
}
