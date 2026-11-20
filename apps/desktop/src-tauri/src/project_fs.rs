//! Project folders on desktop (docs/platform.md §2, §5.1): the `ProjectFileSystem` operations,
//! folder picking and project creation, as app commands.
//!
//! The webview gets no general filesystem permission. A folder becomes reachable only after the
//! user picked it in a native dialog (or created a project in it); such *project roots* are
//! remembered in `<app-data>/project-roots.json`, so recent projects reopen without re-picking.
//! Every operation names its root and a POSIX project path; both are checked here before any
//! native path is built.

use std::collections::BTreeSet;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

/// Mirrors `FsError` in `@pigeon/platform`: `code` is one of its `FsErrorCode`s, or `io` for
/// unexpected failures (permissions, disk full).
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct FsErr {
    pub code: &'static str,
    pub path: String,
    pub message: String,
}

impl FsErr {
    fn new(code: &'static str, path: &str) -> Self {
        let shown = if path.is_empty() {
            "<project root>"
        } else {
            path
        };
        Self {
            code,
            path: path.to_owned(),
            message: format!("{code}: {shown}"),
        }
    }

    fn io(path: &str, error: &std::io::Error) -> Self {
        match error.kind() {
            ErrorKind::NotFound => Self::new("not-found", path),
            ErrorKind::AlreadyExists => Self::new("already-exists", path),
            _ => Self {
                code: "io",
                path: path.to_owned(),
                message: format!("{path}: {error}"),
            },
        }
    }
}

type FsResult<T> = Result<T, FsErr>;

// --- Project roots -------------------------------------------------------------------------------

/// Folders the user granted access to, persisted across restarts.
pub struct ProjectRoots {
    file: Option<PathBuf>,
    roots: Mutex<BTreeSet<String>>,
}

impl ProjectRoots {
    pub fn load(file: PathBuf) -> Self {
        let roots = fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<BTreeSet<String>>(&bytes).ok())
            .unwrap_or_default();
        Self {
            file: Some(file),
            roots: Mutex::new(roots),
        }
    }

    #[cfg(test)]
    pub fn in_memory() -> Self {
        Self {
            file: None,
            roots: Mutex::new(BTreeSet::new()),
        }
    }

    pub fn grant(&self, root: &Path) -> String {
        let root = root.display().to_string();
        let mut roots = self.roots.lock().expect("project roots lock");
        if roots.insert(root.clone()) {
            if let Some(file) = &self.file {
                if let Some(dir) = file.parent() {
                    let _ = fs::create_dir_all(dir);
                }
                if let Ok(json) = serde_json::to_vec_pretty(&*roots) {
                    let _ = crate::files::write_file_atomic(file, &json);
                }
            }
        }
        root
    }

    pub fn is_granted(&self, root: &str) -> bool {
        self.roots
            .lock()
            .expect("project roots lock")
            .contains(root)
    }

    /// The root as a native path, if the user granted it.
    pub fn check(&self, root: &str) -> FsResult<PathBuf> {
        if self.is_granted(root) {
            Ok(PathBuf::from(root))
        } else {
            Err(FsErr {
                code: "io",
                path: String::new(),
                message: format!("Pigeon has no access to {root}. Open the folder again."),
            })
        }
    }
}

// --- Paths -----------------------------------------------------------------------------------------

/// Same rules as `assertProjectPath` in `@pigeon/platform`.
pub fn validate(path: &str) -> FsResult<()> {
    if path.is_empty() {
        return Ok(());
    }
    let bytes = path.as_bytes();
    let drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    let invalid = path.starts_with('/')
        || drive
        || path.contains('\\')
        || path.contains('\0')
        || path
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..");
    if invalid {
        Err(FsErr {
            code: "invalid-path",
            path: path.to_owned(),
            message: format!("Invalid project path \"{path}\""),
        })
    } else {
        Ok(())
    }
}

/// Native path of a project path below `root` (segments joined with the OS separator).
pub fn resolve(root: &Path, path: &str) -> FsResult<PathBuf> {
    validate(path)?;
    let mut native = root.to_path_buf();
    if !path.is_empty() {
        native.extend(path.split('/'));
    }
    Ok(native)
}

fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_owned()
    } else {
        format!("{dir}/{name}")
    }
}

fn parent(path: &str) -> &str {
    path.rfind('/').map_or("", |slash| &path[..slash])
}

/// `not-a-directory` when a file sits where a directory of `path`'s ancestry should be.
fn check_ancestors(root: &Path, path: &str) -> FsResult<()> {
    let mut current = String::new();
    let segments: Vec<&str> = path.split('/').collect();
    for segment in &segments[..segments.len().saturating_sub(1)] {
        current = join(&current, segment);
        match fs::metadata(resolve(root, &current)?) {
            Ok(meta) if !meta.is_dir() => return Err(FsErr::new("not-a-directory", &current)),
            Ok(_) => {}
            Err(_) => return Ok(()),
        }
    }
    Ok(())
}

// --- Operations (pure, tested below) ------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stat {
    pub kind: &'static str,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtime_ms: Option<f64>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Entry {
    pub path: String,
    pub kind: &'static str,
}

pub fn read(root: &Path, path: &str) -> FsResult<Vec<u8>> {
    let native = resolve(root, path)?;
    match fs::metadata(&native) {
        Ok(meta) if meta.is_dir() => Err(FsErr::new("is-a-directory", path)),
        Ok(_) => fs::read(&native).map_err(|e| FsErr::io(path, &e)),
        Err(e) => Err(FsErr::io(path, &e)),
    }
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn write_atomic(root: &Path, path: &str, bytes: &[u8]) -> FsResult<()> {
    if path.is_empty() {
        return Err(FsErr::new("is-a-directory", path));
    }
    let native = resolve(root, path)?;
    check_ancestors(root, path)?;
    if fs::metadata(&native).is_ok_and(|meta| meta.is_dir()) {
        return Err(FsErr::new("is-a-directory", path));
    }
    let dir = native.parent().unwrap_or(root);
    fs::create_dir_all(dir).map_err(|e| FsErr::io(parent(path), &e))?;
    let name = native
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    let temp = dir.join(format!(
        ".{name}.pigeon-{}-{}.tmp",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        rename_with_retry(&temp, &native)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temp);
        return Err(FsErr::io(path, &error));
    }
    Ok(())
}

/// Windows: editors and virus scanners briefly lock files; retry 3 times with backoff
/// (50, 100, 150 ms) before reporting the error (platform.md §5.3).
fn with_retry<T>(mut operation: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    let mut attempt = 0;
    loop {
        match operation() {
            Err(error) if is_transient(&error) && attempt < 3 => {
                attempt += 1;
                std::thread::sleep(Duration::from_millis(50 * attempt));
            }
            result => return result,
        }
    }
}

/// A sharing violation (Windows error 32/33) or access denied while another program holds the file.
fn is_transient(error: &std::io::Error) -> bool {
    error.kind() == ErrorKind::PermissionDenied || matches!(error.raw_os_error(), Some(32 | 33))
}

fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    with_retry(|| fs::rename(from, to))
}

pub fn stat(root: &Path, path: &str) -> FsResult<Option<Stat>> {
    let native = resolve(root, path)?;
    match fs::metadata(&native) {
        Ok(meta) => Ok(Some(Stat {
            kind: if meta.is_dir() { "dir" } else { "file" },
            size: if meta.is_dir() { 0 } else { meta.len() },
            mtime_ms: meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as f64),
        })),
        Err(_) => Ok(None),
    }
}

pub fn list(root: &Path, dir: &str, recursive: bool) -> FsResult<Vec<Entry>> {
    let native = resolve(root, dir)?;
    match fs::metadata(&native) {
        Ok(meta) if !meta.is_dir() => return Err(FsErr::new("not-a-directory", dir)),
        Ok(_) => {}
        Err(e) => return Err(FsErr::io(dir, &e)),
    }
    let mut entries = Vec::new();
    collect(&native, dir, recursive, &mut entries)?;
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

fn collect(native: &Path, dir: &str, recursive: bool, out: &mut Vec<Entry>) -> FsResult<()> {
    let read_dir = fs::read_dir(native).map_err(|e| FsErr::io(dir, &e))?;
    for item in read_dir {
        let item = item.map_err(|e| FsErr::io(dir, &e))?;
        let Some(name) = item.file_name().to_str().map(str::to_owned) else {
            continue; // not valid Unicode: cannot be a project path
        };
        let path = join(dir, &name);
        let Ok(meta) = fs::metadata(item.path()) else {
            continue;
        };
        // Symlinked files read like files; symlinked directories are left out, so nothing (scans,
        // deletes) ever reaches outside the project through them (PIGN-040).
        let is_link = item.file_type().is_ok_and(|t| t.is_symlink());
        if is_link && meta.is_dir() {
            continue;
        }
        if meta.is_dir() {
            out.push(Entry {
                path: path.clone(),
                kind: "dir",
            });
            if recursive {
                collect(&item.path(), &path, true, out)?;
            }
        } else {
            out.push(Entry { path, kind: "file" });
        }
    }
    Ok(())
}

pub fn mkdirp(root: &Path, dir: &str) -> FsResult<()> {
    let native = resolve(root, dir)?;
    if !dir.is_empty() {
        check_ancestors(root, &format!("{dir}/x"))?;
    }
    fs::create_dir_all(&native).map_err(|e| FsErr::io(dir, &e))
}

pub fn remove(root: &Path, path: &str, recursive: bool) -> FsResult<()> {
    if path.is_empty() {
        return Err(FsErr::new("invalid-path", path));
    }
    let native = resolve(root, path)?;
    if fs::symlink_metadata(&native).is_ok_and(|meta| meta.file_type().is_symlink()) {
        // The link itself, never its target (a directory link is a directory on Windows).
        return with_retry(|| fs::remove_file(&native).or_else(|_| fs::remove_dir(&native)))
            .map_err(|e| FsErr::io(path, &e));
    }
    let meta = fs::metadata(&native).map_err(|e| FsErr::io(path, &e))?;
    if !meta.is_dir() {
        return with_retry(|| fs::remove_file(&native)).map_err(|e| FsErr::io(path, &e));
    }
    if recursive {
        // Does not follow symlinks inside the tree.
        return with_retry(|| fs::remove_dir_all(&native)).map_err(|e| FsErr::io(path, &e));
    }
    let empty = fs::read_dir(&native)
        .map_err(|e| FsErr::io(path, &e))?
        .next()
        .is_none();
    if !empty {
        return Err(FsErr::new("not-empty", path));
    }
    fs::remove_dir(&native).map_err(|e| FsErr::io(path, &e))
}

pub fn rename(root: &Path, from: &str, to: &str) -> FsResult<()> {
    if from.is_empty() || to.is_empty() {
        return Err(FsErr::new(
            "invalid-path",
            if from.is_empty() { from } else { to },
        ));
    }
    let source = resolve(root, from)?;
    let target = resolve(root, to)?;
    if fs::metadata(&source).is_err() {
        return Err(FsErr::new("not-found", from));
    }
    if to.starts_with(&format!("{from}/")) {
        return Err(FsErr::new("invalid-path", to));
    }
    // A case-only rename sees its own source as the "existing" target on macOS and Windows.
    let case_only = from.to_lowercase() == to.to_lowercase();
    if !case_only && fs::metadata(&target).is_ok_and(|meta| meta.is_dir()) {
        return Err(FsErr::new("already-exists", to));
    }
    check_ancestors(root, to)?;
    if let Some(dir) = target.parent() {
        fs::create_dir_all(dir).map_err(|e| FsErr::io(parent(to), &e))?;
    }
    rename_with_retry(&source, &target).map_err(|e| FsErr::io(from, &e))
}

/// `<parent>/<name>`; `name` must be a single, non-empty folder name.
pub fn create_project_dir(parent_dir: &Path, name: &str) -> Result<PathBuf, String> {
    let name = name.trim();
    let invalid = name.is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', '\0', ':', '*', '?', '"', '<', '>', '|']);
    if invalid {
        return Err(format!("\"{name}\" is not a valid folder name."));
    }
    let dir = parent_dir.join(name);
    if dir.exists() && fs::read_dir(&dir).map_or(true, |mut entries| entries.next().is_some()) {
        return Err(format!(
            "{} already exists and is not empty.",
            dir.display()
        ));
    }
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create {}: {error}", dir.display()))?;
    Ok(dir)
}

// --- Commands --------------------------------------------------------------------------------------

async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())
}

/// Shows the folder picker; grants and returns the chosen folder, or `None` when cancelled.
#[tauri::command]
pub async fn project_pick_folder<R: Runtime>(
    app: tauri::AppHandle<R>,
    roots: State<'_, ProjectRoots>,
) -> Result<Option<String>, String> {
    let dialog = app.dialog().file().set_title("Open Pigeon project folder");
    let Some(chosen) = blocking(move || dialog.blocking_pick_folder()).await? else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|error| error.to_string())?;
    Ok(Some(roots.grant(&path)))
}

/// Asks for a parent folder, creates `<parent>/<name>` and grants it.
#[tauri::command]
pub async fn project_create<R: Runtime>(
    app: tauri::AppHandle<R>,
    roots: State<'_, ProjectRoots>,
    name: String,
) -> Result<Option<String>, String> {
    let dialog = app
        .dialog()
        .file()
        .set_title(format!("Choose where to create \"{name}\""));
    let Some(chosen) = blocking(move || dialog.blocking_pick_folder()).await? else {
        return Ok(None);
    };
    let parent_dir = chosen.into_path().map_err(|error| error.to_string())?;
    let dir = create_project_dir(&parent_dir, &name)?;
    Ok(Some(roots.grant(&dir)))
}

/// `"ok"`, `"needs-permission"` (never granted) or `"missing"` (deleted or moved).
#[tauri::command]
pub fn project_reopen(roots: State<'_, ProjectRoots>, root: String) -> &'static str {
    if !roots.is_granted(&root) {
        "needs-permission"
    } else if Path::new(&root).is_dir() {
        "ok"
    } else {
        "missing"
    }
}

#[tauri::command]
pub async fn project_fs_read(
    roots: State<'_, ProjectRoots>,
    root: String,
    path: String,
) -> Result<tauri::ipc::Response, FsErr> {
    let root = roots.check(&root)?;
    let bytes = blocking(move || read(&root, &path))
        .await
        .map_err(|message| FsErr {
            code: "io",
            path: String::new(),
            message,
        })??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[derive(Deserialize)]
struct WriteMeta {
    root: String,
    path: String,
}

/// Binary frame `[u32 LE JSON length][{ root, path }][bytes]`, like `save_file`.
#[tauri::command]
pub async fn project_fs_write(
    roots: State<'_, ProjectRoots>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), FsErr> {
    let bad = |message: String| FsErr {
        code: "io",
        path: String::new(),
        message,
    };
    let tauri::ipc::InvokeBody::Raw(frame) = request.body() else {
        return Err(bad("project_fs_write expects a binary frame.".into()));
    };
    let (len, rest) = frame
        .split_first_chunk::<4>()
        .ok_or_else(|| bad("frame shorter than its length prefix".into()))?;
    let len = u32::from_le_bytes(*len) as usize;
    if len > rest.len() {
        return Err(bad(format!("JSON length {len} exceeds the frame")));
    }
    let (json, bytes) = rest.split_at(len);
    let meta: WriteMeta = serde_json::from_slice(json).map_err(|e| bad(e.to_string()))?;
    let root = roots.check(&meta.root)?;
    let bytes = bytes.to_vec();
    blocking(move || write_atomic(&root, &meta.path, &bytes))
        .await
        .map_err(bad)?
}

/// Checks `root`, then runs `job` on the blocking pool.
async fn with_root<T: Send + 'static>(
    roots: &ProjectRoots,
    root: &str,
    job: impl FnOnce(&Path) -> FsResult<T> + Send + 'static,
) -> FsResult<T> {
    let root = roots.check(root)?;
    blocking(move || job(&root))
        .await
        .map_err(|message| FsErr {
            code: "io",
            path: String::new(),
            message,
        })?
}

#[tauri::command]
pub async fn project_fs_stat(
    roots: State<'_, ProjectRoots>,
    root: String,
    path: String,
) -> Result<Option<Stat>, FsErr> {
    with_root(&roots, &root, move |root| stat(root, &path)).await
}

#[tauri::command]
pub async fn project_fs_list(
    roots: State<'_, ProjectRoots>,
    root: String,
    dir: String,
    recursive: bool,
) -> Result<Vec<Entry>, FsErr> {
    with_root(&roots, &root, move |root| list(root, &dir, recursive)).await
}

#[tauri::command]
pub async fn project_fs_mkdirp(
    roots: State<'_, ProjectRoots>,
    root: String,
    dir: String,
) -> Result<(), FsErr> {
    with_root(&roots, &root, move |root| mkdirp(root, &dir)).await
}

#[tauri::command]
pub async fn project_fs_remove(
    roots: State<'_, ProjectRoots>,
    root: String,
    path: String,
    recursive: bool,
) -> Result<(), FsErr> {
    with_root(&roots, &root, move |root| remove(root, &path, recursive)).await
}

#[tauri::command]
pub async fn project_fs_rename(
    roots: State<'_, ProjectRoots>,
    root: String,
    from: String,
    to: String,
) -> Result<(), FsErr> {
    with_root(&roots, &root, move |root| rename(root, &from, &to)).await
}

/// Registers `ProjectRoots` from `<app-data>/project-roots.json`.
pub fn setup<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let dir = crate::data_dir::app_data_dir(app)?;
    app.manage(ProjectRoots::load(dir.join("project-roots.json")));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "pigeon-fs-{label}-{}-{}",
                std::process::id(),
                TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn code<T: std::fmt::Debug>(result: FsResult<T>) -> &'static str {
        result.unwrap_err().code
    }

    #[test]
    fn validates_project_paths_like_the_typescript_rules() {
        for ok in ["", "a", "a/b.json", "ünï/🐦", "a..b"] {
            assert!(validate(ok).is_ok(), "{ok}");
        }
        for bad in [
            "/a", "C:/a", "c:", "a\\b", "a//b", "a/", "./a", "a/../b", "a\0b",
        ] {
            assert_eq!(code(validate(bad)), "invalid-path", "{bad}");
        }
    }

    #[test]
    fn resolves_segments_with_the_native_separator() {
        let root = Path::new("root");
        assert_eq!(resolve(root, "").unwrap(), PathBuf::from("root"));
        assert_eq!(
            resolve(root, "collections/users api/a.json").unwrap(),
            Path::new("root")
                .join("collections")
                .join("users api")
                .join("a.json")
        );
    }

    #[test]
    fn writes_reads_and_stats_files() {
        let tmp = TempDir::new("rw");
        let root = tmp.0.as_path();
        let bytes: Vec<u8> = vec![0, 255, 13, 10, 0xf0, 0x9f];
        write_atomic(root, "a/b/c.bin", &bytes).unwrap();
        assert_eq!(read(root, "a/b/c.bin").unwrap(), bytes);
        write_atomic(root, "a/b/c.bin", b"x").unwrap();
        assert_eq!(read(root, "a/b/c.bin").unwrap(), b"x");
        assert_eq!(stat(root, "a/b/c.bin").unwrap().unwrap().size, 1);
        assert_eq!(stat(root, "a").unwrap().unwrap().kind, "dir");
        assert_eq!(stat(root, "missing").unwrap(), None);
        assert_eq!(code(read(root, "missing")), "not-found");
        assert_eq!(code(read(root, "a")), "is-a-directory");
        assert_eq!(code(write_atomic(root, "a", b"")), "is-a-directory");
        assert_eq!(
            code(write_atomic(root, "a/b/c.bin/d", b"")),
            "not-a-directory"
        );
        let names: Vec<_> = fs::read_dir(root.join("a").join("b"))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, ["c.bin"], "no temporary files left behind");
    }

    #[test]
    fn lists_sorted_project_paths() {
        let tmp = TempDir::new("list");
        let root = tmp.0.as_path();
        for path in ["b.txt", "a/z.txt", "a/b/c.txt", "A.txt"] {
            write_atomic(root, path, b"").unwrap();
        }
        let shallow: Vec<_> = list(root, "", false)
            .unwrap()
            .into_iter()
            .map(|e| (e.path, e.kind))
            .collect();
        assert_eq!(
            shallow,
            [
                ("A.txt".into(), "file"),
                ("a".into(), "dir"),
                ("b.txt".into(), "file")
            ]
        );
        let deep: Vec<_> = list(root, "a", true)
            .unwrap()
            .into_iter()
            .map(|e| e.path)
            .collect();
        assert_eq!(deep, ["a/b", "a/b/c.txt", "a/z.txt"]);
        assert_eq!(code(list(root, "missing", false)), "not-found");
        assert_eq!(code(list(root, "b.txt", false)), "not-a-directory");
    }

    #[test]
    fn mkdirp_and_remove_follow_the_contract() {
        let tmp = TempDir::new("rm");
        let root = tmp.0.as_path();
        mkdirp(root, "x/y/z").unwrap();
        mkdirp(root, "x/y/z").unwrap();
        write_atomic(root, "f", b"").unwrap();
        assert_eq!(code(mkdirp(root, "f/g")), "not-a-directory");
        assert_eq!(code(remove(root, "x", false)), "not-empty");
        remove(root, "x/y/z", false).unwrap();
        remove(root, "x", true).unwrap();
        remove(root, "f", false).unwrap();
        assert_eq!(code(remove(root, "f", false)), "not-found");
        assert_eq!(code(remove(root, "", true)), "invalid-path");
    }

    #[test]
    fn renames_files_and_directories() {
        let tmp = TempDir::new("mv");
        let root = tmp.0.as_path();
        write_atomic(root, "a.txt", b"a").unwrap();
        write_atomic(root, "b.txt", b"b").unwrap();
        rename(root, "a.txt", "b.txt").unwrap();
        assert_eq!(read(root, "b.txt").unwrap(), b"a");
        rename(root, "b.txt", "B.txt").unwrap();
        let names: Vec<_> = list(root, "", false)
            .unwrap()
            .into_iter()
            .map(|e| e.path)
            .collect();
        assert_eq!(names, ["B.txt"], "case-only rename");
        rename(root, "B.txt", "dir/new/c.txt").unwrap();
        mkdirp(root, "other").unwrap();
        assert_eq!(code(rename(root, "dir", "other")), "already-exists");
        assert_eq!(code(rename(root, "dir", "dir/inside")), "invalid-path");
        assert_eq!(code(rename(root, "nope", "x")), "not-found");
        rename(root, "dir", "moved").unwrap();
        assert_eq!(read(root, "moved/new/c.txt").unwrap(), b"a");
    }

    #[test]
    fn renames_over_an_existing_file_on_every_os() {
        let tmp = TempDir::new("over");
        let root = tmp.0.as_path();
        write_atomic(root, "dir/a.json", b"new").unwrap();
        write_atomic(root, "dir/b.json", b"old").unwrap();
        rename(root, "dir/a.json", "dir/b.json").unwrap();
        assert_eq!(read(root, "dir/b.json").unwrap(), b"new");
        // Atomic writes replace existing files the same way.
        write_atomic(root, "dir/b.json", b"newer").unwrap();
        assert_eq!(read(root, "dir/b.json").unwrap(), b"newer");
        let names: Vec<_> = list(root, "dir", false)
            .unwrap()
            .into_iter()
            .map(|e| e.path)
            .collect();
        assert_eq!(names, ["dir/b.json"], "no temporary files left");
    }

    #[test]
    fn retries_transient_errors_then_gives_up() {
        let mut calls = 0;
        let result: std::io::Result<()> = with_retry(|| {
            calls += 1;
            Err(std::io::Error::from(ErrorKind::PermissionDenied))
        });
        assert!(result.is_err());
        assert_eq!(calls, 4, "first try plus 3 retries");
        let mut calls = 0;
        let result = with_retry(|| {
            calls += 1;
            if calls < 3 {
                Err(std::io::Error::from(ErrorKind::PermissionDenied))
            } else {
                Ok(calls)
            }
        });
        assert_eq!(result.unwrap(), 3);
        let mut calls = 0;
        let _ = with_retry(|| -> std::io::Result<()> {
            calls += 1;
            Err(std::io::Error::from(ErrorKind::NotFound))
        });
        assert_eq!(calls, 1, "not-found is not retried");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_directories_are_not_listed_or_deleted_through() {
        let tmp = TempDir::new("links");
        let root = tmp.0.as_path();
        let outside = TempDir::new("outside");
        fs::write(outside.0.join("keep.json"), b"{}").unwrap();
        write_atomic(root, "collections/c/a.json", b"{}").unwrap();
        std::os::unix::fs::symlink(&outside.0, root.join("collections/c/linked")).unwrap();
        std::os::unix::fs::symlink(
            outside.0.join("keep.json"),
            root.join("collections/c/file-link.json"),
        )
        .unwrap();
        let names: Vec<_> = list(root, "collections", true)
            .unwrap()
            .into_iter()
            .map(|e| e.path)
            .collect();
        assert_eq!(
            names,
            [
                "collections/c",
                "collections/c/a.json",
                "collections/c/file-link.json"
            ]
        );
        remove(root, "collections/c/linked", false).unwrap();
        remove(root, "collections/c/file-link.json", false).unwrap();
        remove(root, "collections", true).unwrap();
        assert_eq!(fs::read(outside.0.join("keep.json")).unwrap(), b"{}");
    }

    #[test]
    fn creates_project_folders_only_where_empty() {
        let tmp = TempDir::new("create");
        let dir = create_project_dir(&tmp.0, " My API ").unwrap();
        assert!(dir.ends_with("My API"));
        assert!(
            create_project_dir(&tmp.0, "My API").is_ok(),
            "empty folder is fine"
        );
        fs::write(dir.join("x"), b"").unwrap();
        assert!(create_project_dir(&tmp.0, "My API").is_err());
        for bad in ["", "a/b", "..", "a:b"] {
            assert!(create_project_dir(&tmp.0, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn roots_are_granted_persisted_and_checked() {
        let tmp = TempDir::new("roots");
        let file = tmp.0.join("state").join("project-roots.json");
        let roots = ProjectRoots::load(file.clone());
        assert!(roots.check("/somewhere").is_err());
        let granted = roots.grant(Path::new("/somewhere"));
        assert!(roots.check(&granted).is_ok());
        assert!(
            ProjectRoots::load(file).is_granted("/somewhere"),
            "survives a restart"
        );
        assert!(!ProjectRoots::in_memory().is_granted("/somewhere"));
    }
}
