//! `ProjectFileSystem.watch` on desktop (PIGN-020; docs/platform.md §5.1): a recursive `notify`
//! watcher per open project root. Events are coalesced for 250 ms (a `git checkout` produces
//! hundreds) and emitted to the webview as `project-fs-change` with project paths. They are hints
//! only: the session re-checks file hashes, so missed or extra events are harmless.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

use notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{Emitter, Runtime, State};

use crate::project_fs::ProjectRoots;

pub const EVENT: &str = "project-fs-change";
const DEBOUNCE: Duration = Duration::from_millis(250);

#[derive(Default)]
pub struct Watchers(Mutex<HashMap<String, notify::RecommendedWatcher>>);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ChangeEvent {
    pub kind: &'static str,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChangeBatch {
    pub root: String,
    pub events: Vec<ChangeEvent>,
}

/// The project path of `native` below `root`, if it is one (temporary files are skipped).
pub fn project_path(root: &Path, native: &Path) -> Option<String> {
    let relative = native.strip_prefix(root).ok()?;
    let segments: Vec<String> = relative
        .components()
        .map(|c| c.as_os_str().to_str().map(str::to_owned))
        .collect::<Option<_>>()?;
    if segments.is_empty() {
        return None;
    }
    let name = segments.last()?;
    if name.contains(".pigeon-") && name.ends_with(".tmp") || name.ends_with(".crswap") {
        return None;
    }
    Some(segments.join("/"))
}

/// Like [`project_path`], for a root that may be reached through a symlink: watchers report
/// resolved paths (macOS reports `/private/var/…` for a root under `/var/…`), so the canonical
/// root is tried too (PIGN-040).
pub fn project_path_in(roots: &[PathBuf], native: &Path) -> Option<String> {
    roots.iter().find_map(|root| project_path(root, native))
}

fn kind_of(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("created"),
        EventKind::Modify(_) => Some("modified"),
        EventKind::Remove(_) => Some("removed"),
        EventKind::Any | EventKind::Other => Some("modified"),
        EventKind::Access(_) => None,
    }
}

/// Starts watching `root`; a second call for the same root replaces the first watcher.
#[tauri::command]
pub fn project_watch<R: Runtime>(
    app: tauri::AppHandle<R>,
    roots: State<'_, ProjectRoots>,
    watchers: State<'_, Watchers>,
    root: String,
) -> Result<(), String> {
    let root_path: PathBuf = roots.check(&root).map_err(|e| e.message)?;
    let (tx, rx) = channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    watcher
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Cannot watch {}: {e}", root_path.display()))?;

    let mut match_roots = vec![root_path.clone()];
    if let Ok(canonical) = std::fs::canonicalize(&root_path) {
        if canonical != root_path {
            match_roots.push(canonical);
        }
    }
    let batch_root = root.clone();
    std::thread::spawn(move || {
        // Ends when the watcher (the sender) is dropped by `project_unwatch`.
        while let Ok(first) = rx.recv() {
            let mut pending = BTreeMap::new();
            let mut add = |event: notify::Result<notify::Event>| {
                if let Ok(event) = event {
                    if let Some(kind) = kind_of(&event.kind) {
                        for path in &event.paths {
                            if let Some(project) = project_path_in(&match_roots, path) {
                                pending.insert(project, kind);
                            }
                        }
                    }
                }
            };
            add(first);
            loop {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(event) => add(event),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            if pending.is_empty() {
                continue;
            }
            let events = pending
                .into_iter()
                .map(|(path, kind)| ChangeEvent { kind, path })
                .collect();
            let _ = app.emit(
                EVENT,
                ChangeBatch {
                    root: batch_root.clone(),
                    events,
                },
            );
        }
    });
    watchers
        .0
        .lock()
        .expect("watchers lock")
        .insert(root, watcher);
    Ok(())
}

#[tauri::command]
pub fn project_unwatch(watchers: State<'_, Watchers>, root: String) {
    watchers.0.lock().expect("watchers lock").remove(&root);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_paths_become_project_paths() {
        let root = Path::new("/repo/api");
        assert_eq!(
            project_path(
                root,
                Path::new("/repo/api/collections/users/a.request.json")
            )
            .as_deref(),
            Some("collections/users/a.request.json")
        );
        assert_eq!(project_path(root, Path::new("/repo/api")), None);
        assert_eq!(project_path(root, Path::new("/elsewhere/x")), None);
        assert_eq!(
            project_path(root, Path::new("/repo/api/.a.json.pigeon-1-2.tmp")),
            None
        );
        assert_eq!(
            project_path(root, Path::new("/repo/api/a.json.crswap")),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_watcher_on_a_symlinked_root_reports_writes() {
        let dir = std::env::temp_dir().join(format!("pigeon-watch-link-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("real").join("collections")).unwrap();
        let link = dir.join("link");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(dir.join("real"), &link).unwrap();
        let roots = vec![link.clone(), link.canonicalize().unwrap()];
        let (tx, rx) = channel::<notify::Result<notify::Event>>();
        let mut watcher = notify::recommended_watcher(tx).unwrap();
        watcher.watch(&link, RecursiveMode::Recursive).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        std::fs::write(link.join("collections").join("a.json"), b"{}").unwrap();
        let mut seen = Vec::new();
        while let Ok(Ok(event)) = rx.recv_timeout(Duration::from_secs(5)) {
            seen.extend(
                event
                    .paths
                    .iter()
                    .filter_map(|p| project_path_in(&roots, p)),
            );
            if seen.iter().any(|p| p == "collections/a.json") {
                break;
            }
        }
        drop(watcher);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(seen.iter().any(|p| p == "collections/a.json"), "{seen:?}");
    }

    #[test]
    fn access_events_are_ignored() {
        assert_eq!(
            kind_of(&EventKind::Access(notify::event::AccessKind::Any)),
            None
        );
        assert_eq!(
            kind_of(&EventKind::Create(notify::event::CreateKind::File)),
            Some("created")
        );
        assert_eq!(
            kind_of(&EventKind::Remove(notify::event::RemoveKind::Any)),
            Some("removed")
        );
    }

    #[test]
    fn a_real_watcher_reports_writes_below_the_root() {
        let dir = std::env::temp_dir().join(format!("pigeon-watch-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("collections")).unwrap();
        let root = dir.canonicalize().unwrap();
        let (tx, rx) = channel::<notify::Result<notify::Event>>();
        let mut watcher = notify::recommended_watcher(tx).unwrap();
        watcher.watch(&root, RecursiveMode::Recursive).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        std::fs::write(root.join("collections").join("a.json"), b"{}").unwrap();
        let mut seen = Vec::new();
        while let Ok(Ok(event)) = rx.recv_timeout(Duration::from_secs(5)) {
            seen.extend(event.paths.iter().filter_map(|p| project_path(&root, p)));
            if seen.iter().any(|p| p == "collections/a.json") {
                break;
            }
        }
        drop(watcher);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(seen.iter().any(|p| p == "collections/a.json"), "{seen:?}");
    }
}
