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
    sql_server::dashboard,
};
use tauri::State;

#[tauri::command]
pub async fn dashboard_live(
    scope: Scope,
    state: State<'_, Connections>,
) -> Result<dashboard::LiveActivity> {
    dashboard::live(&state, scope).await
}

#[tauri::command]
pub async fn dashboard_overview(
    scope: Scope,
    state: State<'_, Connections>,
) -> Result<dashboard::Overview> {
    dashboard::overview(&state, scope).await
}

#[tauri::command]
pub async fn dashboard_storage(
    scope: Scope,
    state: State<'_, Connections>,
) -> Result<Vec<dashboard::TableStorage>> {
    dashboard::storage(&state, scope).await
}

#[tauri::command]
pub async fn dashboard_performance(
    scope: Scope,
    hours: i32,
    state: State<'_, Connections>,
) -> Result<dashboard::Performance> {
    dashboard::performance(&state, scope, hours).await
}

#[tauri::command]
pub async fn connect(
    input: ConnectInput,
    use_saved: Option<bool>,
    remember: Option<bool>,
    state: State<'_, Connections>,
) -> Result<Connected> {
    state
        .connect(input, use_saved.unwrap_or(false), remember.unwrap_or(false))
        .await
}

#[tauri::command]
pub fn has_saved_password(input: ConnectInput) -> Result<bool> {
    match crate::credentials::PasswordKey::for_input(&input) {
        Some(key) => key.exists(),
        None => Ok(false),
    }
}

#[tauri::command]
pub fn forget_password(input: ConnectInput) -> Result<()> {
    if let Some(key) = crate::credentials::PasswordKey::for_input(&input) {
        key.forget()?;
    }
    Ok(())
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
