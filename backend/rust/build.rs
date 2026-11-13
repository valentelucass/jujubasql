fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "connect",
            "disconnect",
            "schemas",
            "tables",
            "structure",
            "records",
            "relationships",
            "database_diagram",
            "query_read",
            "update_cell",
        ]),
    ))
    .expect("preparar permissões e recursos do Nexo SQL");
}
