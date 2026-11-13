#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod catalog;
mod commands;
mod connection;
mod credentials;
mod edit;
mod editor;
mod error;
mod models;
mod records;
mod relationships;
mod sql_server;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(connection::Connections::default())
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::has_saved_password,
            commands::forget_password,
            commands::disconnect,
            commands::schemas,
            commands::tables,
            commands::structure,
            commands::records,
            commands::relationships,
            commands::database_diagram,
            commands::dashboard_overview,
            commands::dashboard_storage,
            commands::dashboard_performance,
            commands::dashboard_live,
            commands::query_read,
            commands::update_cell,
        ])
        .run(tauri::generate_context!())
        .expect("iniciar o JujubaSQL");
}
