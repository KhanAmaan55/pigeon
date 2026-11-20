// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_state;
mod files;
mod http;
#[cfg(target_os = "macos")]
mod menu;
mod project_fs;
mod smoke;
#[cfg(test)]
mod test_server;

fn main() {
    // plugin-os injects the OS name into the webview; reading it needs no IPC permission.
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        // Used from Rust only (`save_file`, project pickers); the webview gets no dialog permissions.
        .plugin(tauri_plugin_dialog::init())
        .manage(http::HttpState::default())
        .setup(|app| project_fs::setup(app));

    // Windows and Linux get no native menu: shortcuts must not depend on one (docs/platform.md §5).
    #[cfg(target_os = "macos")]
    {
        builder = builder.menu(menu::build);
    }

    // Tauri keeps only the last `invoke_handler`, so every command is registered here at once.
    builder = if smoke::requested(std::env::args()) {
        smoke::install(builder).invoke_handler(tauri::generate_handler![
            http::http_send,
            http::http_cancel,
            files::save_file,
            project_fs::project_pick_folder,
            project_fs::project_create,
            project_fs::project_reopen,
            project_fs::project_fs_read,
            project_fs::project_fs_write,
            project_fs::project_fs_stat,
            project_fs::project_fs_list,
            project_fs::project_fs_mkdirp,
            project_fs::project_fs_remove,
            project_fs::project_fs_rename,
            app_state::app_state_read,
            app_state::app_state_write,
            smoke::smoke_report
        ])
    } else {
        builder.invoke_handler(tauri::generate_handler![
            http::http_send,
            http::http_cancel,
            files::save_file,
            project_fs::project_pick_folder,
            project_fs::project_create,
            project_fs::project_reopen,
            project_fs::project_fs_read,
            project_fs::project_fs_write,
            project_fs::project_fs_stat,
            project_fs::project_fs_list,
            project_fs::project_fs_mkdirp,
            project_fs::project_fs_remove,
            project_fs::project_fs_rename,
            app_state::app_state_read,
            app_state::app_state_write
        ])
    };

    builder
        .run(tauri::generate_context!())
        .expect("error while running Pigeon");
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    fn config() -> Value {
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json is JSON")
    }

    fn sources<'a>(csp: &'a Value, directive: &str) -> Vec<&'a str> {
        csp[directive]
            .as_str()
            .unwrap_or_else(|| panic!("CSP is missing {directive}"))
            .split_whitespace()
            .collect()
    }

    /// The webview never talks to the network directly (requests go through Rust, PIGN-007)
    /// and never runs inline or remote scripts.
    #[test]
    fn csp_stays_strict() {
        let config = config();
        for key in ["csp", "devCsp"] {
            let csp = &config["app"]["security"][key];
            assert_eq!(sources(csp, "default-src"), ["'self'"], "{key}");
            for source in sources(csp, "script-src") {
                assert!(
                    ["'self'", "'wasm-unsafe-eval'"].contains(&source),
                    "{key} script-src allows {source}"
                );
            }
            for source in sources(csp, "connect-src") {
                assert!(
                    source == "ipc:" || source.contains("localhost"),
                    "{key} connect-src allows {source}"
                );
            }
        }
    }

    #[test]
    fn main_window_has_the_specified_size() {
        let window = &config()["app"]["windows"][0];
        assert_eq!(window["label"], "main");
        assert_eq!(window["width"], 1280);
        assert_eq!(window["height"], 800);
        assert_eq!(window["minWidth"], 900);
        assert_eq!(window["minHeight"], 600);
    }
}
