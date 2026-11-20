//! Native menus (PIGN-041): File, Edit, View, Window and Help on macOS; File, View and Help on
//! Windows and Linux (the webview handles editing keys there, and every shortcut also works
//! without a menu, docs/platform.md §5). App commands go to the web UI as `pigeon:menu` events
//! (the UI turns them into `pigeon:command` DOM events); zoom and Help → Documentation are
//! handled here.

use std::sync::Mutex;

use tauri::menu::{
    AboutMetadata, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu,
    HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The event the web UI listens to; its payload is a command id below.
pub const MENU_EVENT: &str = "pigeon:menu";

/// Commands the web UI runs (`pigeon:command` in `@pigeon/ui`).
pub const UI_COMMANDS: &[(&str, &str)] = &[
    ("new-request", "New Request"),
    ("open-project", "Open Project…"),
    ("import", "Import…"),
    ("export-project", "Export Project…"),
    ("close-project", "Close Project"),
    ("toggle-sidebar", "Toggle Sidebar"),
    ("toggle-response-layout", "Toggle Response Layout"),
    ("web-limitations", "Web Limitations"),
];

pub const DOCS_URL: &str = "https://github.com/KhanAmaan55/pigeon#readme";

/// Zoom factor of the main webview (View → Zoom In / Out / Actual Size).
#[derive(Default)]
pub struct Zoom(Mutex<Option<f64>>);

const ZOOM_STEP: f64 = 0.1;
const ZOOM_MIN: f64 = 0.5;
const ZOOM_MAX: f64 = 2.0;

/// The next zoom factor for a zoom command, clamped and rounded to one decimal.
pub fn next_zoom(current: f64, command: &str) -> f64 {
    let next = match command {
        "zoom-in" => current + ZOOM_STEP,
        "zoom-out" => current - ZOOM_STEP,
        _ => 1.0,
    };
    (next.clamp(ZOOM_MIN, ZOOM_MAX) * 10.0).round() / 10.0
}

fn label<'a>(id: &str) -> &'a str {
    UI_COMMANDS
        .iter()
        .find(|(command, _)| *command == id)
        .map_or("", |(_, label)| label)
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let info = app.package_info();
    let separator = || PredefinedMenuItem::separator(app);
    let command = |id: &str| MenuItem::with_id(app, id, label(id), true, None::<&str>);
    let accelerated =
        |id: &str, text: &str, keys: &str| MenuItem::with_id(app, id, text, true, Some(keys));
    let about = PredefinedMenuItem::about(
        app,
        Some(&format!("About {}", info.name)),
        Some(AboutMetadata {
            name: Some(info.name.clone()),
            version: Some(info.version.to_string()),
            copyright: app.config().bundle.copyright.clone(),
            comments: Some("Git-friendly API client".into()),
            ..AboutMetadata::default()
        }),
    )?;

    let new_request = command("new-request")?;
    let open_project = command("open-project")?;
    let import = command("import")?;
    let export_project = command("export-project")?;
    let close_project = command("close-project")?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    let (sep1, sep2, sep3) = (separator()?, separator()?, separator()?);
    let mut file_items: Vec<&dyn IsMenuItem<R>> = vec![
        &new_request,
        &sep1,
        &open_project,
        &import,
        &export_project,
        &sep2,
        &close_project,
    ];
    if !cfg!(target_os = "macos") {
        file_items.extend([&sep3 as &dyn IsMenuItem<R>, &quit]);
    }
    let file_menu = Submenu::with_items(app, "File", true, &file_items)?;

    let toggle_sidebar = command("toggle-sidebar")?;
    let toggle_layout = command("toggle-response-layout")?;
    let zoom_in = accelerated("zoom-in", "Zoom In", "CmdOrCtrl+=")?;
    let zoom_out = accelerated("zoom-out", "Zoom Out", "CmdOrCtrl+-")?;
    let zoom_reset = accelerated("zoom-reset", "Actual Size", "CmdOrCtrl+0")?;
    let fullscreen = PredefinedMenuItem::fullscreen(app, None)?;
    let (sep4, sep5) = (separator()?, separator()?);
    let mut view_items: Vec<&dyn IsMenuItem<R>> = vec![
        &toggle_sidebar,
        &toggle_layout,
        &sep4,
        &zoom_in,
        &zoom_out,
        &zoom_reset,
    ];
    if cfg!(target_os = "macos") {
        view_items.extend([&sep5 as &dyn IsMenuItem<R>, &fullscreen]);
    }
    let view_menu = Submenu::with_items(app, "View", true, &view_items)?;

    let docs = MenuItem::with_id(app, "docs", "Documentation", true, None::<&str>)?;
    let web_limitations = command("web-limitations")?;
    let sep6 = separator()?;
    let mut help_items: Vec<&dyn IsMenuItem<R>> = vec![&docs, &web_limitations];
    if !cfg!(target_os = "macos") {
        help_items.extend([&sep6 as &dyn IsMenuItem<R>, &about]);
    }
    let help_menu = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &help_items)?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            &info.name,
            true,
            &[
                &about,
                &separator()?,
                &PredefinedMenuItem::services(app, None)?,
                &separator()?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &separator()?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        // The predefined Edit items route Cmd+C / Cmd+V / Cmd+Z / Cmd+A to the webview's inputs.
        let edit_menu = Submenu::with_items(
            app,
            "Edit",
            true,
            &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &separator()?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ],
        )?;
        // This id makes macOS treat it as the Window menu (adds the open-window list).
        let window_menu = Submenu::with_id_and_items(
            app,
            WINDOW_SUBMENU_ID,
            "Window",
            true,
            &[
                &PredefinedMenuItem::minimize(app, None)?,
                &PredefinedMenuItem::maximize(app, None)?,
                &separator()?,
                &PredefinedMenuItem::close_window(app, None)?,
            ],
        )?;
        Menu::with_items(
            app,
            &[
                &app_menu,
                &file_menu,
                &edit_menu,
                &view_menu,
                &window_menu,
                &help_menu,
            ],
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = WINDOW_SUBMENU_ID;
        Menu::with_items(app, &[&file_menu, &view_menu, &help_menu])
    }
}

/// Runs a menu command.
pub fn handle<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    match id {
        "zoom-in" | "zoom-out" | "zoom-reset" => {
            let zoom = app.state::<Zoom>();
            let mut current = zoom.0.lock().expect("zoom lock");
            let next = next_zoom(current.unwrap_or(1.0), id);
            if let Some(window) = app.get_webview_window("main") {
                if window.set_zoom(next).is_ok() {
                    *current = Some(next);
                }
            }
        }
        "docs" => open_in_browser(DOCS_URL),
        _ if UI_COMMANDS.iter().any(|(command, _)| *command == id) => {
            let _ = app.emit(MENU_EVENT, id);
        }
        _ => {}
    }
}

/// Opens `url` in the default browser (no shell plugin: a fixed URL, never user input).
fn open_in_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(url).spawn();
    if let Err(error) = result {
        eprintln!("Could not open {url}: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_steps_are_clamped_and_rounded() {
        assert_eq!(next_zoom(1.0, "zoom-in"), 1.1);
        assert_eq!(next_zoom(1.1, "zoom-out"), 1.0);
        assert_eq!(next_zoom(2.0, "zoom-in"), 2.0);
        assert_eq!(next_zoom(0.5, "zoom-out"), 0.5);
        assert_eq!(next_zoom(1.7, "zoom-reset"), 1.0);
    }

    #[test]
    fn every_ui_command_has_a_label() {
        for (id, text) in UI_COMMANDS {
            assert!(!id.is_empty() && !text.is_empty());
            assert_eq!(label(id), *text);
        }
    }
}
