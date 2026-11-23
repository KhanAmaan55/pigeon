// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_state;
mod data_dir;
mod files;
mod http;
mod menu;
mod oauth;
mod project_fs;
mod smoke;
#[cfg(test)]
mod test_server;
mod watch;
mod window_state;

fn main() {
    // plugin-os injects the OS name into the webview; reading it needs no IPC permission.
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        // Used from Rust only (`save_file`, project pickers); the webview gets no dialog permissions.
        .plugin(tauri_plugin_dialog::init())
        .manage(http::HttpState::default())
        .manage(watch::Watchers::default())
        .manage(menu::Zoom::default())
        .manage(oauth::OAuthListeners::default())
        .setup(|app| {
            project_fs::setup(app)?;
            window_state::setup(app)
        })
        .on_window_event(window_state::on_window_event)
        // Shortcuts never depend on the menu (docs/platform.md §5): the UI handles its own keys.
        .menu(menu::build)
        .on_menu_event(menu::handle);

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
            watch::project_watch,
            watch::project_unwatch,
            app_state::app_state_read,
            app_state::app_state_write,
            app_state::app_state_backup,
            app_state::secrets_read,
            app_state::secrets_write,
            oauth::oauth_begin,
            oauth::oauth_complete,
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
            watch::project_watch,
            watch::project_unwatch,
            app_state::app_state_read,
            app_state::app_state_write,
            app_state::app_state_backup,
            app_state::secrets_read,
            app_state::secrets_write,
            oauth::oauth_begin,
            oauth::oauth_complete
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
    /// and never runs inline or remote scripts. `'self'` lets the script sandbox's Worker load
    /// its bundled QuickJS wasm (PIGN-043); it is the app's own assets, not the network.
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
                    source == "'self'" || source == "ipc:" || source.contains("localhost"),
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
