//! Where Pigeon keeps its local app data (`app.json`, project local state, secrets, project
//! roots). `--smoke` runs use a fresh temporary directory instead, so a smoke test never reads
//! or changes the user's own state (open projects, preferences, secrets).

use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::{Manager, Runtime};

static ISOLATED: OnceLock<PathBuf> = OnceLock::new();

/// Uses `dir` instead of the platform app data directory for the rest of the process.
pub fn use_isolated(dir: PathBuf) {
    let _ = ISOLATED.set(dir);
}

/// The isolated directory, when one is in use.
pub fn isolated() -> Option<&'static PathBuf> {
    ISOLATED.get()
}

pub fn app_data_dir<R: Runtime, M: Manager<R>>(manager: &M) -> Result<PathBuf, String> {
    match ISOLATED.get() {
        Some(dir) => Ok(dir.clone()),
        None => manager
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string()),
    }
}
