//! Local app state on desktop (docs/file-format.md §6): one JSON document per `AppStateStore`
//! namespace under the app-data directory, never inside a project folder.
//!
//! - `app` → `<app-data>/app.json`
//! - `project:<id>` → `<app-data>/projects/<id>/state.json`

use std::path::{Path, PathBuf};

use tauri::{Manager, Runtime};

/// The file for a namespace, or an error for anything that could escape the app-data dir.
pub fn namespace_file(app_data: &Path, namespace: &str) -> Result<PathBuf, String> {
    if namespace == "app" {
        return Ok(app_data.join("app.json"));
    }
    let id = namespace
        .strip_prefix("project:")
        .ok_or_else(|| format!("Unknown app-state namespace \"{namespace}\""))?;
    let valid = !id.is_empty()
        && id != "."
        && id != ".."
        && id.len() <= 200
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '@'));
    if !valid {
        return Err(format!(
            "Invalid project id in app-state namespace \"{namespace}\""
        ));
    }
    Ok(app_data.join("projects").join(id).join("state.json"))
}

pub fn read(app_data: &Path, namespace: &str) -> Result<Option<String>, String> {
    let file = namespace_file(app_data, namespace)?;
    match std::fs::read_to_string(&file) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read {}: {error}", file.display())),
    }
}

/// `None` deletes the namespace file.
pub fn write(app_data: &Path, namespace: &str, json: Option<&str>) -> Result<(), String> {
    let file = namespace_file(app_data, namespace)?;
    let Some(json) = json else {
        return match std::fs::remove_file(&file) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        };
    };
    serde_json::from_str::<serde_json::Value>(json).map_err(|error| error.to_string())?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    crate::files::write_file_atomic(&file, json.as_bytes())
        .map_err(|error| format!("Could not write {}: {error}", file.display()))
}

fn app_data<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn app_state_read<R: Runtime>(
    app: tauri::AppHandle<R>,
    namespace: String,
) -> Result<Option<String>, String> {
    let dir = app_data(&app)?;
    tokio::task::spawn_blocking(move || read(&dir, &namespace))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn app_state_write<R: Runtime>(
    app: tauri::AppHandle<R>,
    namespace: String,
    json: Option<String>,
) -> Result<(), String> {
    let dir = app_data(&app)?;
    tokio::task::spawn_blocking(move || write(&dir, &namespace, json.as_deref()))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn namespaces_map_to_files_inside_app_data() {
        let base = Path::new("data");
        assert_eq!(namespace_file(base, "app").unwrap(), base.join("app.json"));
        assert_eq!(
            namespace_file(base, "project:6f1c-ab@1a2b").unwrap(),
            base.join("projects")
                .join("6f1c-ab@1a2b")
                .join("state.json")
        );
        for bad in [
            "other",
            "project:",
            "project:..",
            "project:a/b",
            "project:a\\b",
            "project:é",
        ] {
            assert!(namespace_file(base, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn writes_reads_and_deletes_documents() {
        let dir = std::env::temp_dir().join(format!("pigeon-state-{}", std::process::id()));
        assert_eq!(read(&dir, "project:p1").unwrap(), None);
        write(&dir, "project:p1", Some(r#"{"a":1}"#)).unwrap();
        assert_eq!(
            read(&dir, "project:p1").unwrap().as_deref(),
            Some(r#"{"a":1}"#)
        );
        assert!(write(&dir, "app", Some("not json")).is_err());
        write(&dir, "project:p1", None).unwrap();
        write(&dir, "project:p1", None).unwrap();
        assert_eq!(read(&dir, "project:p1").unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
