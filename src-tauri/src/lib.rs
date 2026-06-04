mod commands;

use commands::{read_file, save_file, get_file_info, list_directory_files, save_image, read_image_file, get_ai_key, set_ai_key};
use tauri::{Manager, Emitter};
use std::sync::Mutex;

/// File path passed on the command line (double-clicking a .md in the OS).
/// Held until the frontend asks for it via `get_cli_file`.
struct CliFile(Mutex<Option<String>>);

/// First markdown path among the process arguments (skipping argv[0]).
fn md_arg(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| a.ends_with(".md") || a.ends_with(".markdown"))
        .cloned()
}

/// PULL model for the OS-opened file. The old design pushed an event after a
/// fixed 500 ms sleep, which raced the webview: on slow cold starts the event
/// fired before the JS listener existed and was silently lost, so the
/// last-session restore won and the app showed the previous file instead of
/// the one the user double-clicked. Now the frontend asks for the path when
/// it is actually ready, before deciding whether to restore the last session.
/// `take()` so a webview reload doesn't re-open it.
#[tauri::command]
fn get_cli_file(state: tauri::State<CliFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli_file = md_arg(&std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        // Must be the first plugin so it wins the instance lock race.
        // A second launch (double-clicking another .md while MarkLite runs)
        // forwards its argv here and exits; we surface the window and hand
        // the path to the existing frontend listener.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
                if let Some(path) = md_arg(&argv) {
                    let _ = window.emit("file-open-from-cli", path);
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(CliFile(Mutex::new(cli_file)))
        .invoke_handler(tauri::generate_handler![
            read_file,
            save_file,
            get_file_info,
            list_directory_files,
            save_image,
            read_image_file,
            get_ai_key,
            set_ai_key,
            get_cli_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::md_arg;

    fn v(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn md_arg_skips_argv0_and_finds_markdown() {
        assert_eq!(md_arg(&v(&["marklite.exe", "C:\\notes\\a.md"])), Some("C:\\notes\\a.md".into()));
        assert_eq!(md_arg(&v(&["marklite.exe", "C:\\notes\\b.markdown"])), Some("C:\\notes\\b.markdown".into()));
    }

    #[test]
    fn md_arg_ignores_non_markdown_and_flags() {
        assert_eq!(md_arg(&v(&["marklite.exe"])), None);
        assert_eq!(md_arg(&v(&["marklite.exe", "--flag", "notes.txt"])), None);
        // argv[0] itself never matches, even if the exe path looked odd
        assert_eq!(md_arg(&v(&["weird.md"])), None);
    }

    #[test]
    fn md_arg_takes_first_markdown_among_args() {
        assert_eq!(
            md_arg(&v(&["marklite.exe", "--verbose", "x.md", "y.md"])),
            Some("x.md".into())
        );
    }
}
