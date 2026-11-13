use crate::{
    connection::Connections,
    error::{deadline, AppError, Result},
    models::{EditInput, EditOutcome},
    sql_server::{catalog, quote, records::editable_value, Parameter},
};

pub async fn apply(connections: &Connections, input: EditInput) -> Result<EditOutcome> {
    let outcome = deadline(async {
        let mut client = connections.open_database(&input.table.scope).await?;
        let table = catalog::table(&mut client, input.table.table_id).await?;
        let columns = catalog::columns(&mut client, table.id).await?;
        let column = columns.iter().find(|col| col.id == input.column_id && col.editable)
            .ok_or_else(unsupported)?;
        let keys: Vec<_> = columns.iter().filter(|col| col.primary_key).collect();
        if keys.is_empty() || keys.len() != input.key.len() || !keys.iter().all(|col| col.editable_key)
            || !editable_value(input.old_value.as_deref()) || !editable_value(input.value.as_deref())
            || (input.value.is_none() && !column.nullable) || input.value == input.old_value {
            return Err(unsupported());
        }

        let mut parameters = vec![Parameter::NullableText(input.value), Parameter::NullableText(input.old_value)];
        let mut predicates = Vec::new();
        for (key, value) in keys.into_iter().zip(input.key) {
            if !editable_value(Some(&value)) { return Err(unsupported()); }
            parameters.push(Parameter::Text(value));
            let name = quote(&key.name);
            let number = parameters.len();
            predicates.push(format!("{name} = @P{number} AND
                DATALENGTH(CONVERT(nvarchar(max), {name})) = DATALENGTH(@P{number}) AND
                CONVERT(varbinary(max), CONVERT(nvarchar(max), {name})) = CONVERT(varbinary(max), @P{number})"));
        }
        let target = quote(&column.name);
        let qualified = format!("{}.{}", quote(&table.schema), quote(&table.name));
        let where_key = predicates.join(" AND ");
        // The previous value must still match byte-for-byte, including case and whitespace.
        // OUTPUT counts base rows even when SQL Server emits other row counts.
        let sql = format!("SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_WARNINGS ON;
            DECLARE @jujuba_changed TABLE (matched int NOT NULL);
            DECLARE @jujuba_count int;
            BEGIN TRANSACTION;
            UPDATE {qualified} SET {target} = @P1 OUTPUT 1 INTO @jujuba_changed
            WHERE {where_key} AND (({target} IS NULL AND @P2 IS NULL) OR
              (DATALENGTH(CONVERT(nvarchar(max), {target})) = DATALENGTH(@P2)
               AND CONVERT(varbinary(max), CONVERT(nvarchar(max), {target})) = CONVERT(varbinary(max), @P2)));
            SELECT @jujuba_count = COUNT(*) FROM @jujuba_changed;
            IF @jujuba_count = 1 COMMIT TRANSACTION ELSE ROLLBACK TRANSACTION;
            SELECT @jujuba_count AS changed;");
        let rows = client.query(&sql, &parameters).await?;
        let count = rows.first().map(|row| crate::sql_server::int(row, "changed")).transpose()?;
        match count {
            Some(1) => Ok(EditOutcome { changed: true }),
            Some(_) => Err(AppError::new("conflict", "O registro mudou ou não pôde ser identificado com segurança. Atualize a tabela.")),
            None => Err(AppError::new("update_unknown", "Atualize a tabela para conferir o resultado antes de tentar novamente.")),
        }
    }).await;
    outcome.map_err(|error| if matches!(error.kind, "timeout" | "network") {
        AppError::new("update_unknown", "A conexão foi interrompida. Atualize a tabela para conferir o resultado antes de tentar novamente.")
    } else { error })
}

fn unsupported() -> AppError {
    AppError::new("input", "A edição requer uma chave primária compatível e uma coluna de texto ou número inteiro. Confira os valores antes de continuar.")
}
