use super::{bit, connection::SqlClient, int, optional_text, text};
use super::{Parameter, Row};
use crate::{
    error::{AppError, Result},
    models::{Column, Index, IndexColumn, Table},
};

pub async fn databases(client: &mut SqlClient) -> Result<Vec<String>> {
    names(
        client,
        "SELECT name FROM sys.databases
        WHERE database_id > 4 AND state = 0
          AND HAS_DBACCESS(name) = 1 ORDER BY name",
    )
    .await
}

pub async fn schemas(client: &mut SqlClient) -> Result<Vec<String>> {
    names(
        client,
        "SELECT s.name FROM sys.schemas AS s WHERE EXISTS (
        SELECT 1 FROM sys.tables AS t WHERE t.schema_id = s.schema_id AND t.is_ms_shipped = 0
    ) ORDER BY s.name",
    )
    .await
}

async fn names(client: &mut SqlClient, sql: &str) -> Result<Vec<String>> {
    client
        .query(sql, &[])
        .await?
        .iter()
        .map(|row| text(row, "name"))
        .collect()
}

pub async fn all_tables(client: &mut SqlClient) -> Result<Vec<Table>> {
    client
        .query(
            "SELECT t.object_id, s.name AS schema_name, t.name
        FROM sys.tables AS t JOIN sys.schemas AS s ON s.schema_id = t.schema_id
        WHERE t.is_ms_shipped = 0 ORDER BY s.name, t.name",
            &[],
        )
        .await?
        .iter()
        .map(table_from_row)
        .collect()
}

pub async fn tables(client: &mut SqlClient, schema: &str) -> Result<Vec<Table>> {
    client
        .query(
            "SELECT t.object_id, s.name AS schema_name, t.name
        FROM sys.tables AS t JOIN sys.schemas AS s ON s.schema_id = t.schema_id
        WHERE s.name = @P1 AND t.is_ms_shipped = 0 ORDER BY t.name",
            &[Parameter::Text(schema.to_owned())],
        )
        .await?
        .iter()
        .map(table_from_row)
        .collect()
}

pub async fn table(client: &mut SqlClient, id: i32) -> Result<Table> {
    let row = client
        .query(
            "SELECT t.object_id, s.name AS schema_name, t.name
        FROM sys.tables AS t JOIN sys.schemas AS s ON s.schema_id = t.schema_id
        WHERE t.object_id = @P1 AND t.is_ms_shipped = 0",
            &[Parameter::Int(id)],
        )
        .await?
        .into_iter()
        .next()
        .ok_or_else(AppError::denied)?;
    table_from_row(&row)
}

fn table_from_row(row: &Row) -> Result<Table> {
    Ok(Table {
        id: int(row, "object_id")?,
        schema: text(row, "schema_name")?,
        name: text(row, "name")?,
    })
}

pub async fn columns(client: &mut SqlClient, id: i32) -> Result<Vec<Column>> {
    let rows = client.query("SELECT c.column_id, c.name,
        CAST(CASE WHEN c.generated_always_type <> 0 OR c.encryption_type IS NOT NULL THEN 1 ELSE 0 END AS bit) AS write_restricted,
        CAST(CASE WHEN HAS_PERMS_BY_NAME(QUOTENAME(OBJECT_SCHEMA_NAME(c.object_id)) + N'.' + QUOTENAME(OBJECT_NAME(c.object_id)),
            'OBJECT', 'UPDATE', c.name, 'COLUMN') = 1 THEN 1 ELSE 0 END AS bit) AS can_update,
        CASE WHEN y.is_user_defined = 1 THEN QUOTENAME(SCHEMA_NAME(y.schema_id)) + N'.' + QUOTENAME(y.name)
             WHEN y.name IN (N'char',N'varchar',N'binary',N'varbinary',N'nchar',N'nvarchar') THEN y.name + N'(' +
               CASE WHEN c.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(10),
                 CASE WHEN y.name IN (N'nchar',N'nvarchar') THEN c.max_length / 2 ELSE c.max_length END) END + N')'
             WHEN y.name IN (N'decimal',N'numeric') THEN y.name + N'(' + CONVERT(nvarchar(10),c.precision)
               + N',' + CONVERT(nvarchar(10),c.scale) + N')'
             WHEN y.name IN (N'datetime2',N'datetimeoffset',N'time') THEN y.name + N'(' + CONVERT(nvarchar(10),c.scale) + N')'
             ELSE y.name END AS data_type,
        CAST(c.system_type_id AS int) AS system_type, c.is_nullable, c.is_identity, c.is_computed,
        CAST(CASE WHEN EXISTS (
            SELECT 1 FROM sys.indexes AS i JOIN sys.index_columns AS k
              ON k.object_id = i.object_id AND k.index_id = i.index_id
            WHERE i.object_id = c.object_id AND i.is_primary_key = 1 AND k.column_id = c.column_id AND k.key_ordinal > 0
        ) THEN 1 ELSE 0 END AS bit) AS is_primary
        FROM sys.columns AS c JOIN sys.types AS y ON y.user_type_id = c.user_type_id
        WHERE c.object_id = @P1 AND c.is_hidden = 0 ORDER BY c.column_id", &[Parameter::Int(id)])
        .await?;
    rows.iter()
        .map(|row| {
            let system_type = int(row, "system_type")?;
            Ok(Column {
                id: int(row, "column_id")?,
                name: text(row, "name")?,
                data_type: text(row, "data_type")?,
                nullable: bit(row, "is_nullable")?,
                identity: bit(row, "is_identity")?,
                computed: bit(row, "is_computed")?,
                primary_key: bit(row, "is_primary")?,
                system_type,
                sortable: !matches!(system_type, 34 | 35 | 99 | 240 | 241),
                filterable: system_type != 240,
                editable: bit(row, "can_update")?
                    && !bit(row, "is_primary")?
                    && !bit(row, "is_identity")?
                    && !bit(row, "is_computed")?
                    && !bit(row, "write_restricted")?
                    && matches!(system_type, 48 | 52 | 56 | 127 | 231 | 239),
                editable_key: !bit(row, "write_restricted")?
                    && matches!(system_type, 36 | 48 | 52 | 56 | 127 | 167 | 175 | 231 | 239),
            })
        })
        .collect()
}

pub async fn indexes(client: &mut SqlClient, id: i32) -> Result<Vec<Index>> {
    let rows = client.query("SELECT i.index_id, i.name, i.type_desc, i.is_unique, i.is_primary_key,
        i.is_disabled, i.has_filter, i.filter_definition, c.name AS column_name,
        k.is_descending_key, k.is_included_column
        FROM sys.indexes AS i LEFT JOIN sys.index_columns AS k
          ON k.object_id = i.object_id AND k.index_id = i.index_id
        LEFT JOIN sys.columns AS c ON c.object_id = k.object_id AND c.column_id = k.column_id
        WHERE i.object_id = @P1 AND i.index_id > 0 AND i.is_hypothetical = 0
        ORDER BY i.index_id, CASE WHEN k.key_ordinal > 0 THEN 0 ELSE 1 END, k.key_ordinal, k.index_column_id", &[Parameter::Int(id)])
        .await?;
    let mut indexes: Vec<Index> = Vec::new();
    let mut current = None;
    for row in rows {
        let id = int(&row, "index_id")?;
        if current != Some(id) {
            current = Some(id);
            indexes.push(Index {
                name: text(&row, "name")?,
                kind: text(&row, "type_desc")?,
                unique: bit(&row, "is_unique")?,
                primary: bit(&row, "is_primary_key")?,
                disabled: bit(&row, "is_disabled")?,
                filtered: bit(&row, "has_filter")?,
                filter: optional_text(&row, "filter_definition")?,
                columns: Vec::new(),
            });
        }
        if let Some(name) = optional_text(&row, "column_name")? {
            indexes
                .last_mut()
                .expect("índice correspondente")
                .columns
                .push(IndexColumn {
                    name,
                    descending: bit(&row, "is_descending_key")?,
                    included: bit(&row, "is_included_column")?,
                });
        }
    }
    Ok(indexes)
}
