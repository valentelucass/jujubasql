#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod catalog;
mod commands;
mod connection;
mod edit;
mod editor;
mod error;
mod models;
mod records;
mod relationships;
mod sql_server;

fn main() {
    tauri::Builder::default()
        .manage(connection::Connections::default())
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::disconnect,
            commands::schemas,
            commands::tables,
            commands::structure,
            commands::records,
            commands::relationships,
            commands::database_diagram,
            commands::query_read,
            commands::update_cell,
        ])
        .run(tauri::generate_context!())
        .expect("iniciar o JujubaSQL");
}
