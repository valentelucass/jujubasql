pub mod catalog;
pub mod connection;
pub mod dashboard;
mod local;
pub mod records;
pub mod relationships;

use crate::error::{AppError, Result};
use std::sync::Arc;

#[derive(Clone)]
pub enum Parameter {
    Int(i32),
    Text(String),
    NullableText(Option<String>),
}

pub const EDITOR_LIMIT: usize = 200;
const DASHBOARD_LOCK_TIMEOUT: &str = "SET LOCK_TIMEOUT 3500";

fn editor_row_limit() -> String {
    format!("SET ROWCOUNT {}", EDITOR_LIMIT + 1)
}

fn editor_preview(value: &str) -> String {
    let mut chars = value.chars();
    let mut preview: String = chars.by_ref().take(2048).collect();
    if chars.next().is_some() {
        preview.push('…');
    }
    preview
}

pub enum Row {
    Network(tiberius::Row),
    Local {
        names: Arc<[String]>,
        cells: Vec<Option<String>>,
    },
}

impl Row {
    fn cell(&self, index: usize) -> Result<Option<String>> {
        match self {
            Self::Network(row) => Ok(row.try_get::<&str, _>(index)?.map(str::to_owned)),
            Self::Local { cells, .. } => cells.get(index).cloned().ok_or_else(unexpected_catalog),
        }
    }
}

fn local_cell<'a>(
    names: &[String],
    cells: &'a [Option<String>],
    name: &str,
) -> Result<Option<&'a str>> {
    let index = names
        .iter()
        .position(|column| column == name)
        .ok_or_else(unexpected_catalog)?;
    Ok(cells.get(index).ok_or_else(unexpected_catalog)?.as_deref())
}

fn text(row: &Row, name: &str) -> Result<String> {
    optional_text(row, name)?.ok_or_else(unexpected_catalog)
}

fn optional_text(row: &Row, name: &str) -> Result<Option<String>> {
    let value = match row {
        Row::Network(row) => row.try_get::<&str, _>(name)?,
        Row::Local { names, cells } => local_cell(names, cells, name)?,
    };
    Ok(value.map(str::to_owned))
}

pub(crate) fn int(row: &Row, name: &str) -> Result<i32> {
    match row {
        Row::Network(row) => row.try_get::<i32, _>(name)?.ok_or_else(unexpected_catalog),
        Row::Local { names, cells } => local_cell(names, cells, name)?
            .and_then(|value| value.parse().ok())
            .ok_or_else(unexpected_catalog),
    }
}

fn bit(row: &Row, name: &str) -> Result<bool> {
    match row {
        Row::Network(row) => row.try_get::<bool, _>(name)?.ok_or_else(unexpected_catalog),
        Row::Local { names, cells } => match local_cell(names, cells, name)? {
            Some("0") => Ok(false),
            Some("1") => Ok(true),
            _ => Err(unexpected_catalog()),
        },
    }
}

fn unexpected_catalog() -> AppError {
    AppError::new(
        "catalog",
        "O catálogo do SQL Server retornou um valor inesperado.",
    )
}

pub(crate) fn quote(identifier: &str) -> String {
    format!("[{}]", identifier.replace(']', "]]"))
}
