mod commands;
mod connection_store;
mod ftp_client;
mod sftp_client;
mod transfer_manager;
mod ssh_key_store;
mod encryption;

use commands::AppState;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Disable DMABuf renderer to avoid "Error 71 (Protocol error)" on Wayland
    // with WebKitGTK. Safe to set on X11 too — has no effect there.
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Create the splash screen window
            WebviewWindowBuilder::new(
                app,
                "splashscreen",
                WebviewUrl::App("splashscreen.html".into()),
            )
            .title("Piply")
            .inner_size(400.0, 280.0)
            .resizable(false)
            .decorations(false)
            .center()
            .always_on_top(true)
            .build()?;

            // Main window starts hidden; the splash will show it when ready
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.hide();
            }

            Ok(())
        })
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::disconnect,
            commands::list_local,
            commands::list_remote,
            commands::upload,
            commands::download,
            commands::cancel_transfer,
            commands::pause_transfer,
            commands::resume_transfer,
            commands::get_transfer_status,
            commands::file_exists,
            commands::rename_local,
            commands::delete_local,
            commands::mkdir_local,
            commands::open_local,
            commands::rename_remote,
            commands::delete_remote,
            commands::mkdir_remote,
            commands::get_connections,
            commands::save_connection,
            commands::delete_connection,
            commands::get_version,
            commands::close_splashscreen,
            commands::chmod_remote,
            commands::list_ssh_keys,
            commands::import_ssh_key,
            commands::delete_ssh_key,
            commands::touch_local,
            commands::touch_remote,
            commands::save_text_file,
            commands::open_text_file,
            commands::load_connections_encrypted,
            commands::save_connections_encrypted,
            commands::wipe_encryption_key,
            commands::regenerate_encryption_key,
            commands::get_encryption_key_status,
            commands::load_folders,
            commands::add_folder,
            commands::remove_folder,
            commands::rename_folder,
            commands::load_folders_nested,
            commands::add_folder_nested,
            commands::remove_folder_nested,
            commands::rename_folder_nested,
            commands::move_folder_nested,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
