use crate::{
    connection::Connections,
    error::{deadline, AppError, Result},
    models::{RecordsInput, RecordsPage},
    sql_server::{catalog, records},
};

pub async fn page(connections: &Connections, input: RecordsInput) -> Result<RecordsPage> {
    if ![25, 50, 100].contains(&input.page_size)
        || input.page > 100_000
        || input
            .filter
            .as_ref()
            .is_some_and(|filter| filter.text.encode_utf16().count() > 200)
    {
        return Err(AppError::new(
            "input",
            "A página, o tamanho ou o filtro informado é inválido.",
        ));
    }
    deadline(async {
        let mut client = connections.open_database(&input.table.scope).await?;
        let table = catalog::table(&mut client, input.table.table_id).await?;
        let columns = catalog::columns(&mut client, table.id).await?;
        let indexes = catalog::indexes(&mut client, table.id).await?;
        records::page(&mut client, table, columns, &indexes, input).await
    })
    .await
}
