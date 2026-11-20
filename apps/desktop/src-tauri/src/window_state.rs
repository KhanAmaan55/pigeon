//! Remembers the main window's size, position and maximized state across launches (PIGN-041),
//! in `<app-data>/window-state.json`. A saved position that is no longer on any monitor (a
//! display was unplugged) is ignored, so the window never opens off-screen.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{LogicalSize, Manager, PhysicalPosition, Runtime, Window, WindowEvent};

const FILE: &str = "window-state.json";
const MIN_WIDTH: f64 = 900.0;
const MIN_HEIGHT: f64 = 600.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WindowState {
    /// Logical (scale-independent) inner size.
    pub width: f64,
    pub height: f64,
    /// Physical outer position.
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
}

/// A monitor's physical bounds: `(x, y, width, height)`.
pub type Bounds = (i32, i32, u32, u32);

pub fn read(file: &Path) -> Option<WindowState> {
    let state: WindowState = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
    (state.width.is_finite() && state.height.is_finite()).then_some(state)
}

pub fn write(file: &Path, state: &WindowState) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(state).map_err(std::io::Error::other)?;
    crate::files::write_file_atomic(file, &json)
}

/// Whether a window whose top-left corner is at `(x, y)` is visible on one of `monitors`
/// (its title bar area must be on screen).
pub fn on_screen(x: i32, y: i32, monitors: &[Bounds]) -> bool {
    monitors.iter().any(|&(mx, my, mw, mh)| {
        let (right, bottom) = (mx + mw as i32, my + mh as i32);
        x + 50 >= mx && x + 50 < right && y >= my && y + 20 < bottom
    })
}

fn file<R: Runtime, M: Manager<R>>(manager: &M) -> Option<PathBuf> {
    crate::data_dir::app_data_dir(manager)
        .ok()
        .map(|dir| dir.join(FILE))
}

/// Restores the saved state onto the main window.
pub fn setup<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let (Some(window), Some(path)) = (app.get_webview_window("main"), file(app)) else {
        return Ok(());
    };
    let Some(state) = read(&path) else {
        return Ok(());
    };
    let _ = window.set_size(LogicalSize::new(
        state.width.max(MIN_WIDTH),
        state.height.max(MIN_HEIGHT),
    ));
    let monitors: Vec<Bounds> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let (p, s) = (m.position(), m.size());
            (p.x, p.y, s.width, s.height)
        })
        .collect();
    if on_screen(state.x, state.y, &monitors) {
        let _ = window.set_position(PhysicalPosition::new(state.x, state.y));
    }
    if state.maximized {
        let _ = window.maximize();
    }
    Ok(())
}

/// Saves the state when the main window is about to close.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != "main" || !matches!(event, WindowEvent::CloseRequested { .. }) {
        return;
    }
    let Some(path) = file(window) else {
        return;
    };
    let maximized = window.is_maximized().unwrap_or(false);
    // A maximized window keeps the size and position it had before, so un-maximizing works.
    let previous = read(&path);
    let state = match (maximized, previous) {
        (true, Some(previous)) => WindowState {
            maximized: true,
            ..previous
        },
        _ => {
            let scale = window.scale_factor().unwrap_or(1.0);
            let (Ok(size), Ok(position)) = (window.inner_size(), window.outer_position()) else {
                return;
            };
            let size = size.to_logical::<f64>(scale);
            WindowState {
                width: size.width,
                height: size.height,
                x: position.x,
                y: position.y,
                maximized,
            }
        }
    };
    let _ = write(&path, &state);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_the_state_file() {
        let dir = std::env::temp_dir().join(format!("pigeon-window-{}", std::process::id()));
        let path = dir.join(FILE);
        let state = WindowState {
            width: 1400.0,
            height: 900.0,
            x: 120,
            y: 80,
            maximized: false,
        };
        write(&path, &state).unwrap();
        assert_eq!(read(&path), Some(state));
        std::fs::write(&path, b"{ not json").unwrap();
        assert_eq!(read(&path), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn positions_off_every_monitor_are_ignored() {
        let monitors = [(0, 0, 1920, 1080), (1920, 0, 1280, 1024)];
        assert!(on_screen(100, 100, &monitors));
        assert!(on_screen(2000, 50, &monitors), "second monitor");
        assert!(!on_screen(5000, 100, &monitors), "unplugged monitor");
        assert!(
            !on_screen(100, 1075, &monitors),
            "title bar below the screen"
        );
        assert!(!on_screen(-500, 100, &monitors));
    }
}
