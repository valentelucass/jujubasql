use super::{connection::SqlClient, quote, Parameter};
use crate::{
    error::{AppError, Result},
    models::{Column, Index, RecordsInput, RecordsPage, Table},
};

pub async fn page(
    client: &mut SqlClient,
    table: Table,
    columns: Vec<Column>,
    indexes: &[Index],
    input: RecordsInput,
) -> Result<RecordsPage> {
    if columns.is_empty() {
        return Err(AppError::denied());
    }
    let find_column = |id| {
        columns
            .iter()
            .find(|column| column.id == id)
            .ok_or_else(|| {
                AppError::new(
                    "input",
                    "A coluna escolhida não está disponível nesta tabela.",
                )
            })
    };
    let projection = columns
        .iter()
        .map(projection)
        .collect::<Vec<_>>()
        .join(", ");
    let mut order = Vec::new();
    let mut sorted_name = None;
    if let Some(sort) = &input.sort {
        let column = find_column(sort.column_id)?;
        if !column.sortable {
            return Err(AppError::new(
                "input",
                "Este tipo de coluna não oferece ordenação.",
            ));
        }
        sorted_name = Some(&column.name);
        let direction = if sort.descending { "DESC" } else { "ASC" };
        order.push(format!("{} {direction}", quote(&column.name)));
    }
    let keys = indexes
        .iter()
        .filter(|index| index.unique && !index.filtered && !index.disabled)
        .filter_map(|index| {
            let keys = index
                .columns
                .iter()
                .filter(|key| !key.included)
                .map(|key| {
                    columns
                        .iter()
                        .find(|column| column.name == key.name && column.sortable)
                })
                .collect::<Option<Vec<_>>>()?;
            (!keys.is_empty()).then_some((index.primary, keys))
        })
        .min_by_key(|(primary, keys)| (!primary, keys.len()));
    let stable_order = keys.is_some();
    if let Some((_, keys)) = keys {
        order.extend(
            keys.into_iter()
                .filter(|key| Some(&key.name) != sorted_name)
                .map(|key| quote(&key.name)),
        );
    }
    if order.is_empty() {
        order.push("(SELECT NULL)".to_owned());
    }

    let offset = (input.page * input.page_size) as i32;
    let limit = (input.page_size + 1) as i32;
    let mut params = vec![Parameter::Int(offset), Parameter::Int(limit)];
    let predicate = if let Some(filter) = &input.filter {
        let column = find_column(filter.column_id)?;
        if !column.filterable {
            return Err(AppError::new(
                "input",
                "Este tipo de coluna não oferece filtro textual.",
            ));
        }
        params.push(Parameter::Text(filter.text.clone()));
        format!(" WHERE CHARINDEX(@P3, {}) > 0", filter_expression(column))
    } else {
        String::new()
    };
    let sql = format!(
        "SELECT {projection} FROM {}.{}{predicate}
        ORDER BY {} OFFSET @P1 ROWS FETCH NEXT @P2 ROWS ONLY",
        quote(&table.schema),
        quote(&table.name),
        order.join(", ")
    );
    let rows = client.query(&sql, &params).await?;
    let has_next = rows.len() > input.page_size as usize;
    let rows = rows
        .into_iter()
        .take(input.page_size as usize)
        .map(|row| {
            (0..columns.len())
                .map(|index| row.cell(index))
                .collect::<Result<Vec<_>>>()
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(RecordsPage {
        rows,
        columns,
        page: input.page,
        page_size: input.page_size,
        has_next,
        stable_order,
    })
}

pub fn editable_value(value: Option<&str>) -> bool {
    value.is_none_or(|value| !value.contains('\0') && value.encode_utf16().count() < 2048)
}

fn projection(column: &Column) -> String {
    let id = quote(&column.name);
    match column.system_type {
        34 | 165 | 173 | 189 => {
            format!("CONVERT(nvarchar(2050), CONVERT(varbinary(1024), {id}), 1)")
        }
        40 | 41 | 42 | 43 | 58 | 61 => format!("CONVERT(nvarchar(64), {id}, 126)"),
        59 | 62 => format!("CONVERT(nvarchar(64), {id}, 3)"),
        60 | 122 => format!("CONVERT(nvarchar(64), {id}, 2)"),
        240 => format!("CASE WHEN {id} IS NULL THEN NULL ELSE N'‹valor CLR›' END"),
        _ => format!("LEFT(CONVERT(nvarchar(max), {id}), 2048)"),
    }
}

fn filter_expression(column: &Column) -> String {
    let id = quote(&column.name);
    match column.system_type {
        34 | 165 | 173 | 189 => format!("CONVERT(nvarchar(max), CONVERT(varbinary(max), {id}), 1)"),
        40 | 41 | 42 | 43 | 58 | 61 => format!("CONVERT(nvarchar(64), {id}, 126)"),
        59 | 62 => format!("CONVERT(nvarchar(64), {id}, 3)"),
        60 | 122 => format!("CONVERT(nvarchar(64), {id}, 2)"),
        _ => format!("CONVERT(nvarchar(max), {id})"),
    }
}
