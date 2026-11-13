use crate::{
    connection::Connections,
    error::{deadline, AppError, Result},
    models::{QueryOutput, Scope},
};
use sqlparser::{
    ast::{Query, SetExpr, Statement, TableFactor, Visit, Visitor},
    dialect::MsSqlDialect,
    parser::Parser,
};
use std::ops::ControlFlow;

pub async fn read(connections: &Connections, scope: Scope, source: String) -> Result<QueryOutput> {
    let statement = validate(&source)?;
    deadline(async {
        let mut client = connections.open_database(&scope).await?;
        client.read_editor(&statement).await
    })
    .await
}

fn rejected() -> AppError {
    AppError::new(
        "input",
        "Execute um único SELECT no banco atual. Alterações são feitas pela grade.",
    )
}

fn validate(source: &str) -> Result<String> {
    if source.len() > 32_768 {
        return Err(AppError::new("input", "A consulta excede 32 KB."));
    }
    let statements = Parser::parse_sql(&MsSqlDialect {}, source).map_err(|_| rejected())?;
    let [statement @ Statement::Query(_)] = statements.as_slice() else {
        return Err(rejected());
    };
    if statement.visit(&mut ReadOnly).is_break() {
        return Err(rejected());
    }
    // Execute the parsed form, excluding batch separators and discarded tokens.
    Ok(statement.to_string())
}

struct ReadOnly;

impl Visitor for ReadOnly {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<()> {
        if !query.locks.is_empty() || query.for_clause.is_some() || !read_body(&query.body) {
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_table_factor(&mut self, factor: &TableFactor) -> ControlFlow<()> {
        match factor {
            TableFactor::Table {
                name,
                args: None,
                with_hints,
                ..
            } if name.0.len() <= 2 && with_hints.is_empty() => ControlFlow::Continue(()),
            TableFactor::Derived { .. } | TableFactor::NestedJoin { .. } => {
                ControlFlow::Continue(())
            }
            _ => ControlFlow::Break(()),
        }
    }
}

fn read_body(body: &SetExpr) -> bool {
    match body {
        SetExpr::Select(select) => select.into.is_none(),
        SetExpr::Query(_) => true,
        SetExpr::SetOperation { left, right, .. } => read_body(left) && read_body(right),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn accepts_select_and_rejects_mutation_and_external_sources() {
        assert!(validate("WITH x AS (SELECT 1 AS n) SELECT n FROM x").is_ok());
        assert!(validate("SELECT TOP (10) * FROM [dbo].[t]").is_ok());
        for sql in [
            "SELECT 1; DELETE FROM dbo.t",
            "SELECT * INTO dbo.t2 FROM dbo.t",
            "SELECT * FROM another.dbo.t",
            "SELECT * FROM OPENQUERY(remote, 'select 1')",
            "SELECT NEXT VALUE FOR dbo.sequence",
            "EXEC dbo.proc",
            "UPDATE dbo.t SET n = 1",
            "SELECT * FROM dbo.t WITH (UPDLOCK)",
        ] {
            assert!(validate(sql).is_err(), "{sql}");
        }
    }
}
