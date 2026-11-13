use crate::{
    catalog,
    connection::Connections,
    edit, editor,
    error::Result,
    models::{
        ConnectInput, Connected, DatabaseDiagram, EditInput, EditOutcome, QueryOutput,
        RecordsInput, RecordsPage, Relationship, Scope, Structure, Table, TableScope,
    },
    records, relationships,
};
use tauri::State;

#[tauri::command]
pub async fn connect(input: ConnectInput, state: State<'_, Connections>) -> Result<Connected> {
    state.connect(input).await
}

#[tauri::command]
pub async fn disconnect(state: State<'_, Connections>) -> Result<()> {
    state.disconnect().await;
    Ok(())
}

#[tauri::command]
pub async fn schemas(scope: Scope, state: State<'_, Connections>) -> Result<Vec<String>> {
    catalog::schemas(&state, scope).await
}

#[tauri::command]
pub async fn tables(
    scope: Scope,
    schema: String,
    state: State<'_, Connections>,
) -> Result<Vec<Table>> {
    catalog::tables(&state, scope, schema).await
}

#[tauri::command]
pub async fn structure(scope: TableScope, state: State<'_, Connections>) -> Result<Structure> {
    catalog::structure(&state, scope).await
}

#[tauri::command]
pub async fn records(input: RecordsInput, state: State<'_, Connections>) -> Result<RecordsPage> {
    records::page(&state, input).await
}

#[tauri::command]
pub async fn query_read(
    scope: Scope,
    source: String,
    state: State<'_, Connections>,
) -> Result<QueryOutput> {
    editor::read(&state, scope, source).await
}

#[tauri::command]
pub async fn update_cell(input: EditInput, state: State<'_, Connections>) -> Result<EditOutcome> {
    edit::apply(&state, input).await
}

#[tauri::command]
pub async fn database_diagram(
    scope: Scope,
    state: State<'_, Connections>,
) -> Result<DatabaseDiagram> {
    relationships::database(&state, scope).await
}

#[tauri::command]
pub async fn relationships(
    scope: TableScope,
    state: State<'_, Connections>,
) -> Result<Vec<Relationship>> {
    relationships::list(&state, scope).await
}
