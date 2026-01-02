mod commands;

use commands::{read_file, save_file, get_file_info, list_directory_files};
use tauri::{Manager, Emitter};
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Store the CLI file path to emit after window is ready
    let cli_file_path: Mutex<Option<String>> = Mutex::new(None);
    
    // Get CLI arguments early
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        let file_path = &args[1];
        if file_path.ends_with(".md") || file_path.ends_with(".markdown") {
            *cli_file_path.lock().unwrap() = Some(file_path.clone());
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            save_file,
            get_file_info,
            list_directory_files
        ])
        .setup(move |app| {
            // Listen for window ready event
            let file_path = cli_file_path.lock().unwrap().clone();
            
            if let Some(path) = file_path {
                let app_handle = app.handle().clone();
                
                // Use a small delay to ensure window is fully ready
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.emit("file-open-from-cli", path);
                    }
                });
            }
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

