//! Local request history on desktop (PIGN-051, docs/file-format.md §6): under the app-data dir,
//! never in a project folder.
//!
//! - `<app-data>/projects/<key>/history/index.jsonl`: one `{"id","summary"}` line per entry,
//!   appended on every batch (rewritten only when entries are removed).
//! - `<app-data>/projects/<key>/history/entries/<id>.json`: the full entry.
//!
//! The webview batches writes and enforces the limits (core `ProjectHistory`); this side only
//! stores. One lock serializes history operations so appends and rewrites never interleave.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Runtime;

static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Deserialize)]
pub struct Record {
    pub id: String,
    /// JSON text.
    pub summary: String,
    /// JSON text.
    pub entry: String,
}

#[derive(Serialize, Deserialize)]
struct IndexLine {
    id: String,
    summary: serde_json::Value,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

/// `<app-data>/projects/<key>/history`, validated like the app-state namespace.
pub fn history_dir(app_data: &Path, project_key: &str) -> Result<PathBuf, String> {
    let state = crate::app_state::namespace_file(app_data, &format!("project:{project_key}"))?;
    Ok(state.with_file_name("history"))
}

fn entry_file(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("Invalid history entry id \"{id}\""));
    }
    Ok(dir.join("entries").join(format!("{id}.json")))
}

pub fn append(app_data: &Path, project_key: &str, records: &[Record]) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    let dir = history_dir(app_data, project_key)?;
    std::fs::create_dir_all(dir.join("entries")).map_err(|e| e.to_string())?;
    let mut lines = String::new();
    for record in records {
        let file = entry_file(&dir, &record.id)?;
        serde_json::from_str::<serde_json::Value>(&record.entry).map_err(|e| e.to_string())?;
        let summary: serde_json::Value =
            serde_json::from_str(&record.summary).map_err(|e| e.to_string())?;
        crate::files::write_file_atomic(&file, record.entry.as_bytes())
            .map_err(|e| format!("Could not write history: {e}"))?;
        let line = IndexLine {
            id: record.id.clone(),
            summary,
        };
        lines.push_str(&serde_json::to_string(&line).map_err(|e| e.to_string())?);
        lines.push('\n');
    }
    let mut index = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("index.jsonl"))
        .map_err(|e| format!("Could not write history: {e}"))?;
    index
        .write_all(lines.as_bytes())
        .map_err(|e| format!("Could not write history: {e}"))
}

fn read_index(dir: &Path) -> Result<Vec<IndexLine>, String> {
    let text = match std::fs::read_to_string(dir.join("index.jsonl")) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Could not read history: {e}")),
    };
    // A torn last line (crash mid-append) or a bad line is skipped, not fatal.
    Ok(text
        .lines()
        .filter_map(|line| serde_json::from_str::<IndexLine>(line).ok())
        .collect())
}

/// Summaries in append order; a re-appended id keeps only its latest line.
pub fn list(app_data: &Path, project_key: &str) -> Result<Vec<serde_json::Value>, String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    let dir = history_dir(app_data, project_key)?;
    let lines = read_index(&dir)?;
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<serde_json::Value> = Vec::with_capacity(lines.len());
    for line in lines.into_iter().rev() {
        if seen.insert(line.id) {
            out.push(line.summary);
        }
    }
    out.reverse();
    Ok(out)
}

pub fn get(app_data: &Path, project_key: &str, id: &str) -> Result<Option<String>, String> {
    let dir = history_dir(app_data, project_key)?;
    match std::fs::read_to_string(entry_file(&dir, id)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read history: {e}")),
    }
}

pub fn remove(app_data: &Path, project_key: &str, ids: &[String]) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    let dir = history_dir(app_data, project_key)?;
    let removed: std::collections::HashSet<&str> = ids.iter().map(String::as_str).collect();
    let kept: Vec<IndexLine> = read_index(&dir)?
        .into_iter()
        .filter(|line| !removed.contains(line.id.as_str()))
        .collect();
    let mut text = String::new();
    for line in &kept {
        text.push_str(&serde_json::to_string(line).map_err(|e| e.to_string())?);
        text.push('\n');
    }
    if dir.exists() {
        crate::files::write_file_atomic(&dir.join("index.jsonl"), text.as_bytes())
            .map_err(|e| format!("Could not write history: {e}"))?;
    }
    for id in ids {
        match std::fs::remove_file(entry_file(&dir, id)?) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => {}
        }
    }
    Ok(())
}

pub fn clear(app_data: &Path, project_key: &str) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    let dir = history_dir(app_data, project_key)?;
    match std::fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

fn app_data<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    crate::data_dir::app_data_dir(app)
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn history_append<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_key: String,
    records: Vec<Record>,
) -> Result<(), String> {
    let dir = app_data(&app)?;
    blocking(move || append(&dir, &project_key, &records)).await
}

#[tauri::command]
pub async fn history_list<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_key: String,
) -> Result<Vec<serde_json::Value>, String> {
    let dir = app_data(&app)?;
    blocking(move || list(&dir, &project_key)).await
}

#[tauri::command]
pub async fn history_get<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_key: String,
    id: String,
) -> Result<Option<String>, String> {
    let dir = app_data(&app)?;
    blocking(move || get(&dir, &project_key, &id)).await
}

#[tauri::command]
pub async fn history_remove<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_key: String,
    ids: Vec<String>,
) -> Result<(), String> {
    let dir = app_data(&app)?;
    blocking(move || remove(&dir, &project_key, &ids)).await
}

#[tauri::command]
pub async fn history_clear<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_key: String,
) -> Result<(), String> {
    let dir = app_data(&app)?;
    blocking(move || clear(&dir, &project_key)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str, n: u32) -> Record {
        Record {
            id: id.into(),
            summary: format!("{{\"id\":\"{id}\",\"n\":{n}}}"),
            entry: format!(
                "{{\"id\":\"{id}\",\"body\":\"{}\"}}",
                "x".repeat(n as usize)
            ),
        }
    }

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pigeon-history-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn appends_lists_gets_removes_and_clears() {
        let data = temp();
        append(&data, "p1", &[record("a", 1), record("b", 2)]).unwrap();
        append(&data, "p1", &[record("c", 3)]).unwrap();
        append(&data, "p2", &[record("z", 9)]).unwrap();
        let ids = |v: Vec<serde_json::Value>| -> Vec<String> {
            v.iter()
                .map(|s| s["id"].as_str().unwrap().to_owned())
                .collect()
        };
        assert_eq!(ids(list(&data, "p1").unwrap()), ["a", "b", "c"]);
        assert!(get(&data, "p1", "b").unwrap().unwrap().contains("\"xx\""));
        assert_eq!(get(&data, "p1", "z").unwrap(), None);

        remove(&data, "p1", &["a".into(), "c".into()]).unwrap();
        assert_eq!(ids(list(&data, "p1").unwrap()), ["b"]);
        assert_eq!(get(&data, "p1", "a").unwrap(), None);

        clear(&data, "p1").unwrap();
        assert!(list(&data, "p1").unwrap().is_empty());
        assert_eq!(ids(list(&data, "p2").unwrap()), ["z"]);
        assert!(!data.join("projects/p1/history").exists());
        std::fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn a_torn_index_line_is_skipped() {
        let data = temp();
        append(&data, "p", &[record("a", 1)]).unwrap();
        let index = history_dir(&data, "p").unwrap().join("index.jsonl");
        let mut file = OpenOptions::new().append(true).open(&index).unwrap();
        file.write_all(b"{\"id\":\"b\",\"summ").unwrap();
        assert_eq!(list(&data, "p").unwrap().len(), 1);
        std::fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn rejects_ids_and_keys_that_could_escape() {
        let data = temp();
        assert!(append(&data, "p", &[record("../x", 1)]).is_err());
        assert!(append(&data, "../p", &[record("a", 1)]).is_err());
        assert!(get(&data, "p", "a/b").is_err());
        assert!(history_dir(&data, "p@1")
            .unwrap()
            .ends_with("projects/p@1/history"));
        std::fs::remove_dir_all(data).unwrap();
    }
}
