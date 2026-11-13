use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectInput {
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub transport: Transport,
    pub instance: Option<String>,
    pub authentication: Authentication,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Transport {
    #[default]
    Network,
    Local,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Authentication {
    Windows,
    Sql,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connected {
    pub session: u32,
    pub endpoint: String,
    pub transport: Transport,
    pub databases: Vec<String>,
    pub password_save_failed: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    pub session: u32,
    pub database: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableScope {
    #[serde(flatten)]
    pub scope: Scope,
    pub table_id: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    pub id: i32,
    pub schema: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub id: i32,
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub identity: bool,
    pub computed: bool,
    pub primary_key: bool,
    pub sortable: bool,
    pub filterable: bool,
    pub editable: bool,
    pub editable_key: bool,
    #[serde(skip)]
    pub system_type: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub name: String,
    pub kind: String,
    pub unique: bool,
    pub primary: bool,
    pub disabled: bool,
    pub filter: Option<String>,
    pub filtered: bool,
    pub columns: Vec<IndexColumn>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexColumn {
    pub name: String,
    pub descending: bool,
    pub included: bool,
}

#[derive(Serialize)]
pub struct Structure {
    pub table: Table,
    pub columns: Vec<Column>,
    pub indexes: Vec<Index>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordsInput {
    #[serde(flatten)]
    pub table: TableScope,
    pub page: u32,
    pub page_size: u32,
    pub sort: Option<Sort>,
    pub filter: Option<Filter>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sort {
    pub column_id: i32,
    pub descending: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub column_id: i32,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordsPage {
    pub rows: Vec<Vec<Option<String>>>,
    pub columns: Vec<Column>,
    pub page: u32,
    pub page_size: u32,
    pub has_next: bool,
    pub stable_order: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryOutput {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditInput {
    #[serde(flatten)]
    pub table: TableScope,
    pub column_id: i32,
    pub key: Vec<String>,
    pub old_value: Option<String>,
    pub value: Option<String>,
}

#[derive(Serialize)]
pub struct EditOutcome {
    pub changed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDiagram {
    pub tables: Vec<Table>,
    pub relationships: Vec<Relationship>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Relationship {
    pub id: i32,
    pub name: String,
    pub source: Table,
    pub target: Table,
    pub columns: Vec<ColumnPair>,
    pub target_per_source: Option<&'static str>,
    pub source_per_target: Option<&'static str>,
    pub unknown_reason: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnPair {
    pub source: String,
    pub target: String,
    pub ordinal: i32,
}
