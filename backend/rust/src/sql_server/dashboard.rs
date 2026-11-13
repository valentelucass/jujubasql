use super::{connection::SqlClient, optional_text, text, unexpected_catalog, Parameter, Row};
use crate::{
    connection::Connections,
    error::{deadline, AppError, Result},
    models::Scope,
};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    tables: u64,
    views: u64,
    schemas: u64,
    foreign_keys: u64,
    files: Vec<DatabaseFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseFile {
    name: String,
    kind: String,
    size_mib: f64,
    used_mib: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStorage {
    schema: String,
    name: String,
    rows: u64,
    reserved_mib: f64,
    used_mib: f64,
}

#[derive(Serialize)]
pub struct Performance {
    state: String,
    timeline: Vec<Activity>,
    queries: Vec<Activity>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Activity {
    label: String,
    executions: u64,
    average_ms: f64,
    total_ms: f64,
    sql_preview: Option<String>,
}

fn number<T: std::str::FromStr>(row: &Row, name: &str) -> Result<T> {
    text(row, name)?.parse().map_err(|_| unexpected_catalog())
}

pub async fn overview(connections: &Connections, scope: Scope) -> Result<Overview> {
    deadline(async {
        let mut client = connections.open_database(&scope).await?;
        let counts = client.query(
            "SELECT
                CONVERT(varchar(24), (SELECT COUNT_BIG(*) FROM sys.tables WHERE is_ms_shipped = 0)) AS tables,
                CONVERT(varchar(24), (SELECT COUNT_BIG(*) FROM sys.views WHERE is_ms_shipped = 0)) AS views,
                CONVERT(varchar(24), (SELECT COUNT_BIG(DISTINCT schema_id) FROM sys.tables WHERE is_ms_shipped = 0)) AS schemas,
                CONVERT(varchar(24), (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE is_ms_shipped = 0)) AS foreign_keys",
            &[],
        ).await?;
        let counts = counts.first().ok_or_else(unexpected_catalog)?;
        let files = client.query(
            "SELECT name, type_desc AS kind,
                CONVERT(varchar(40), CONVERT(decimal(24,3), size / 128.0)) AS size_mib,
                CONVERT(varchar(40), CONVERT(decimal(24,3), CASE WHEN type = 0
                    THEN FILEPROPERTY(name, 'SpaceUsed') / 128.0 END)) AS used_mib
             FROM sys.database_files ORDER BY type, file_id",
            &[],
        ).await?.iter().map(|row| {
            let used_mib = optional_text(row, "used_mib")?
                .map(|value| value.parse().map_err(|_| unexpected_catalog()))
                .transpose()?;
            Ok(DatabaseFile {
                name: text(row, "name")?,
                kind: text(row, "kind")?,
                size_mib: number(row, "size_mib")?,
                used_mib,
            })
        }).collect::<Result<_>>()?;
        Ok(Overview {
            tables: number(counts, "tables")?,
            views: number(counts, "views")?,
            schemas: number(counts, "schemas")?,
            foreign_keys: number(counts, "foreign_keys")?,
            files,
        })
    }).await
}

pub async fn storage(connections: &Connections, scope: Scope) -> Result<Vec<TableStorage>> {
    deadline(async {
        let mut client = connections.open_database(&scope).await?;
        client.query(
            "SELECT TOP (30) s.name AS schema_name, t.name,
                CONVERT(varchar(24), SUM(CASE WHEN p.index_id < 2 THEN p.row_count ELSE 0 END)) AS row_count,
                CONVERT(varchar(40), CONVERT(decimal(24,3), SUM(p.reserved_page_count) / 128.0)) AS reserved_mib,
                CONVERT(varchar(40), CONVERT(decimal(24,3), SUM(p.used_page_count) / 128.0)) AS used_mib
             FROM sys.dm_db_partition_stats AS p
             JOIN sys.tables AS t ON t.object_id = p.object_id
             JOIN sys.schemas AS s ON s.schema_id = t.schema_id
             WHERE t.is_ms_shipped = 0
             GROUP BY t.object_id, s.name, t.name
             ORDER BY SUM(p.reserved_page_count) DESC, s.name, t.name",
            &[],
        ).await?.iter().map(|row| Ok(TableStorage {
            schema: text(row, "schema_name")?,
            name: text(row, "name")?,
            rows: number(row, "row_count")?,
            reserved_mib: number(row, "reserved_mib")?,
            used_mib: number(row, "used_mib")?,
        })).collect()
    }).await
}

pub async fn performance(
    connections: &Connections,
    scope: Scope,
    hours: i32,
) -> Result<Performance> {
    if !matches!(hours, 24 | 168 | 720) {
        return Err(AppError::new(
            "input",
            "Selecione um dos períodos disponíveis.",
        ));
    }
    deadline(async {
        let mut client = connections.open_database(&scope).await?;
        let rows = client.query(
            "SELECT actual_state_desc AS state FROM sys.database_query_store_options",
            &[],
        ).await?;
        let state = text(rows.first().ok_or_else(unexpected_catalog)?, "state")?;
        let mut result = Performance { state, timeline: Vec::new(), queries: Vec::new() };
        if matches!(result.state.as_str(), "OFF" | "ERROR") {
            return Ok(result);
        }
        // Query Store can expose several runtime rows for a plan in the active interval.
        // Sum execution counts and weight durations by those counts.
        const METRICS: &str = "CONVERT(varchar(24), SUM(r.count_executions)) AS executions,
            CONVERT(varchar(40), CONVERT(decimal(24,3),
                SUM(r.avg_duration * r.count_executions) / NULLIF(SUM(r.count_executions), 0) / 1000.0)) AS average_ms,
            CONVERT(varchar(40), CONVERT(decimal(28,3),
                SUM(r.avg_duration * r.count_executions) / 1000.0)) AS total_ms";
        const SOURCE: &str = "FROM sys.query_store_runtime_stats AS r
            JOIN sys.query_store_runtime_stats_interval AS i ON i.runtime_stats_interval_id = r.runtime_stats_interval_id";
        const FILTER: &str = "WHERE i.start_time >= DATEADD(hour, -@P1, SYSUTCDATETIME())
            AND r.execution_type = 0 AND r.count_executions > 0";
        let bucket = if hours == 24 {
            "LEFT(CONVERT(varchar(19), CONVERT(datetime2, SWITCHOFFSET(i.start_time, '+00:00')), 126), 13) + ':00:00Z'"
        } else {
            "CONVERT(varchar(10), CONVERT(date, SWITCHOFFSET(i.start_time, '+00:00')), 23) + 'T00:00:00Z'"
        };
        result.timeline = activity(&mut client, &format!(
            "SELECT {bucket} AS label, {METRICS}, CAST(NULL AS nvarchar(240)) AS sql_preview
             {SOURCE} {FILTER} GROUP BY {bucket} ORDER BY label"
        ), hours).await?;
        if !result.timeline.is_empty() {
            result.queries = activity(&mut client, &format!(
                "WITH ranking AS (
                    SELECT TOP (15) p.query_id, {METRICS}, SUM(r.avg_duration * r.count_executions) AS duration_us
                    {SOURCE} JOIN sys.query_store_plan AS p ON p.plan_id = r.plan_id
                    {FILTER} GROUP BY p.query_id
                    ORDER BY duration_us DESC, p.query_id
                 )
                 SELECT CONVERT(varchar(24), ranking.query_id) AS label, ranking.executions,
                    ranking.average_ms, ranking.total_ms, LEFT(qt.query_sql_text, 240) AS sql_preview
                 FROM ranking
                 LEFT JOIN sys.query_store_query AS q ON q.query_id = ranking.query_id
                 LEFT JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
                 ORDER BY ranking.duration_us DESC, ranking.query_id"
            ), hours).await?;
        }
        Ok(result)
    }).await
}

async fn activity(client: &mut SqlClient, sql: &str, hours: i32) -> Result<Vec<Activity>> {
    client
        .query(sql, &[Parameter::Int(hours)])
        .await?
        .iter()
        .map(|row| {
            Ok(Activity {
                label: text(row, "label")?,
                executions: number(row, "executions")?,
                average_ms: number(row, "average_ms")?,
                total_ms: number(row, "total_ms")?,
                sql_preview: optional_text(row, "sql_preview")?,
            })
        })
        .collect()
}
