use super::{bit, connection::SqlClient, int, text, Parameter};
use crate::{
    error::Result,
    models::{ColumnPair, Relationship, Table},
};

const RELATIONS: &str = "
WITH relations AS (
    SELECT f.object_id, f.name, f.parent_object_id, f.referenced_object_id,
        f.is_disabled, f.is_not_trusted, f.is_not_for_replication,
        src.name AS source_table, ss.name AS source_schema,
        dst.name AS target_table, ds.name AS target_schema,
        CAST(CASE WHEN EXISTS (
            SELECT 1 FROM sys.indexes AS i
            WHERE i.object_id = f.referenced_object_id AND i.index_id = f.key_index_id
              AND i.is_unique = 1 AND i.is_disabled = 0 AND i.has_filter = 0
        ) THEN 1 ELSE 0 END AS bit) AS target_unique,
        CAST(CASE WHEN EXISTS (
            SELECT 1 FROM sys.indexes AS i
            WHERE i.object_id = f.parent_object_id AND i.is_unique = 1 AND i.is_disabled = 0
              AND i.is_hypothetical = 0 AND i.has_filter = 0
              AND EXISTS (SELECT 1 FROM sys.index_columns AS k
                WHERE k.object_id = i.object_id AND k.index_id = i.index_id AND k.key_ordinal > 0)
              AND NOT EXISTS (
                SELECT 1 FROM sys.index_columns AS k
                WHERE k.object_id = i.object_id AND k.index_id = i.index_id AND k.key_ordinal > 0
                  AND NOT EXISTS (
                    SELECT 1 FROM sys.foreign_key_columns AS fc
                    WHERE fc.constraint_object_id = f.object_id AND fc.parent_column_id = k.column_id
                  )
              )
        ) THEN 1 ELSE 0 END AS bit) AS source_unique,
        CAST(CASE WHEN EXISTS (
            SELECT 1 FROM sys.foreign_key_columns AS fc JOIN sys.columns AS c
              ON c.object_id = fc.parent_object_id AND c.column_id = fc.parent_column_id
            WHERE fc.constraint_object_id = f.object_id AND c.is_nullable = 1
        ) THEN 1 ELSE 0 END AS bit) AS source_nullable,
        CAST(CASE WHEN HAS_PERMS_BY_NAME(
            QUOTENAME(ss.name) + N'.' + QUOTENAME(src.name), 'OBJECT', 'VIEW DEFINITION'
        ) = 1 THEN 1 ELSE 0 END AS bit) AS definition_visible
    FROM sys.foreign_keys AS f
    JOIN sys.tables AS src ON src.object_id = f.parent_object_id
    JOIN sys.schemas AS ss ON ss.schema_id = src.schema_id
    JOIN sys.tables AS dst ON dst.object_id = f.referenced_object_id
    JOIN sys.schemas AS ds ON ds.schema_id = dst.schema_id
    WHERE src.is_ms_shipped = 0 AND dst.is_ms_shipped = 0
    /* scope */
)
SELECT r.*, c.constraint_column_id, pc.name AS source_column, rc.name AS target_column
FROM relations AS r JOIN sys.foreign_key_columns AS c ON c.constraint_object_id = r.object_id
JOIN sys.columns AS pc ON pc.object_id = c.parent_object_id AND pc.column_id = c.parent_column_id
JOIN sys.columns AS rc ON rc.object_id = c.referenced_object_id AND rc.column_id = c.referenced_column_id
ORDER BY r.object_id, c.constraint_column_id";

pub async fn list(client: &mut SqlClient, object_id: Option<i32>) -> Result<Vec<Relationship>> {
    let (sql, parameters) = match object_id {
        Some(id) => (
            RELATIONS.replace(
                "/* scope */",
                "AND (f.parent_object_id = @P1 OR f.referenced_object_id = @P1)",
            ),
            vec![Parameter::Int(id)],
        ),
        None => (RELATIONS.to_owned(), Vec::new()),
    };
    let rows = client.query(&sql, &parameters).await?;
    let mut relationships: Vec<Relationship> = Vec::new();
    for row in rows {
        let id = int(&row, "object_id")?;
        if relationships.last().map(|relationship| relationship.id) != Some(id) {
            let enforced = !bit(&row, "is_disabled")?
                && !bit(&row, "is_not_trusted")?
                && !bit(&row, "is_not_for_replication")?;
            let (target_per_source, source_per_target, unknown_reason) = cardinality(
                enforced,
                bit(&row, "target_unique")?,
                bit(&row, "source_nullable")?,
                bit(&row, "source_unique")?,
                bit(&row, "definition_visible")?,
            );
            relationships.push(Relationship {
                id,
                name: text(&row, "name")?,
                source: Table {
                    id: int(&row, "parent_object_id")?,
                    schema: text(&row, "source_schema")?,
                    name: text(&row, "source_table")?,
                },
                target: Table {
                    id: int(&row, "referenced_object_id")?,
                    schema: text(&row, "target_schema")?,
                    name: text(&row, "target_table")?,
                },
                columns: Vec::new(),
                target_per_source,
                source_per_target,
                unknown_reason,
            });
        }
        relationships
            .last_mut()
            .expect("relacionamento correspondente")
            .columns
            .push(ColumnPair {
                source: text(&row, "source_column")?,
                target: text(&row, "target_column")?,
                ordinal: int(&row, "constraint_column_id")?,
            });
    }
    Ok(relationships)
}

fn cardinality(
    enforced: bool,
    target_unique: bool,
    nullable: bool,
    source_unique: bool,
    definition_visible: bool,
) -> (
    Option<&'static str>,
    Option<&'static str>,
    Option<&'static str>,
) {
    if !enforced {
        return (
            None,
            None,
            Some("A FK está desabilitada, não foi validada ou pode ser ignorada na replicação."),
        );
    }
    if !target_unique {
        return (
            None,
            None,
            Some("O catálogo disponível não confirma a chave única referenciada."),
        );
    }
    let target = Some(if nullable { "0..1" } else { "1" });
    if source_unique {
        return (target, Some("0..1"), None);
    }
    if definition_visible {
        return (target, Some("0..N"), None);
    }
    (
        target,
        None,
        Some("O catálogo disponível não confirma a unicidade no lado de origem."),
    )
}

#[cfg(test)]
mod tests {
    use super::cardinality;

    #[test]
    fn classifies_composite_nullability_and_uniqueness() {
        assert_eq!(
            cardinality(true, true, true, true, false),
            (Some("0..1"), Some("0..1"), None)
        );
        assert_eq!(
            cardinality(true, true, false, false, true),
            (Some("1"), Some("0..N"), None)
        );
    }

    #[test]
    fn reports_unknown_cardinality_when_metadata_is_insufficient() {
        assert!(cardinality(true, true, false, false, false).1.is_none());
        assert!(cardinality(true, false, false, true, true).0.is_none());
        assert!(cardinality(false, true, false, true, true).0.is_none());
    }
}
