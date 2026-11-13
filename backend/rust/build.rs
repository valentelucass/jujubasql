fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "connect",
            "has_saved_password",
            "forget_password",
            "disconnect",
            "schemas",
            "tables",
            "structure",
            "records",
            "relationships",
            "database_diagram",
            "dashboard_overview",
            "dashboard_storage",
            "dashboard_files",
            "dashboard_performance",
            "dashboard_live",
            "query_read",
            "update_cell",
        ]),
    ))
    .expect("preparar permissões e recursos do JujubaSQL");
}
