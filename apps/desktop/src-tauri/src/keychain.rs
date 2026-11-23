//! Secret values in the OS credential store (PIGN-053, docs/file-format.md §7): macOS Keychain,
//! Windows Credential Manager, Linux Secret Service, through the `keyring` crate.
//!
//! - One credential per secret: service `pigeon:<projectKey>`, account `<scope>/<key>`.
//! - The credential stores cannot list a service's entries portably, so the account *names* (never
//!   values) are kept in `<app-data>/projects/<key>/keychain.json`; `keychain_get_all` reads every
//!   listed account in one call when a project opens.
//! - When the store is unavailable (Linux without Secret Service, a locked or denied keychain), the
//!   commands fail and the webview falls back to `secrets.json` with a notice.
//! - `--smoke` runs (isolated app data) use an in-memory store, so they never touch the user's
//!   keychain.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::Runtime;

/// Serializes index rewrites (set/delete/clear may race from the webview).
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, PartialEq, Eq)]
pub enum KeyError {
    NoEntry,
    Unavailable(String),
}

/// The credential store seam: the OS store in the app, a map in tests and smoke runs.
pub trait KeyStore: Send + Sync {
    fn get(&self, service: &str, account: &str) -> Result<String, KeyError>;
    fn set(&self, service: &str, account: &str, value: &str) -> Result<(), KeyError>;
    /// `NoEntry` when there was nothing to delete.
    fn delete(&self, service: &str, account: &str) -> Result<(), KeyError>;
}

/// The platform credential store.
pub struct OsKeyStore;

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
impl OsKeyStore {
    fn entry(service: &str, account: &str) -> Result<keyring::Entry, KeyError> {
        keyring::Entry::new(service, account).map_err(Self::error)
    }

    fn error(error: keyring::Error) -> KeyError {
        match error {
            keyring::Error::NoEntry => KeyError::NoEntry,
            other => KeyError::Unavailable(other.to_string()),
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
impl KeyStore for OsKeyStore {
    fn get(&self, service: &str, account: &str) -> Result<String, KeyError> {
        Self::entry(service, account)?
            .get_password()
            .map_err(Self::error)
    }

    fn set(&self, service: &str, account: &str, value: &str) -> Result<(), KeyError> {
        Self::entry(service, account)?
            .set_password(value)
            .map_err(Self::error)
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), KeyError> {
        Self::entry(service, account)?
            .delete_credential()
            .map_err(Self::error)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
impl KeyStore for OsKeyStore {
    fn get(&self, _: &str, _: &str) -> Result<String, KeyError> {
        Err(KeyError::Unavailable(
            "No OS credential store on this platform".into(),
        ))
    }
    fn set(&self, _: &str, _: &str, _: &str) -> Result<(), KeyError> {
        Err(KeyError::Unavailable(
            "No OS credential store on this platform".into(),
        ))
    }
    fn delete(&self, _: &str, _: &str) -> Result<(), KeyError> {
        Err(KeyError::Unavailable(
            "No OS credential store on this platform".into(),
        ))
    }
}

/// In-memory store for tests and `--smoke`; `unavailable` simulates a missing Secret Service.
#[derive(Default)]
pub struct MemoryKeyStore {
    values: Mutex<HashMap<(String, String), String>>,
    pub unavailable: Option<String>,
}

impl MemoryKeyStore {
    fn check(&self) -> Result<(), KeyError> {
        match &self.unavailable {
            Some(reason) => Err(KeyError::Unavailable(reason.clone())),
            None => Ok(()),
        }
    }

    fn values(&self) -> std::sync::MutexGuard<'_, HashMap<(String, String), String>> {
        self.values
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl KeyStore for MemoryKeyStore {
    fn get(&self, service: &str, account: &str) -> Result<String, KeyError> {
        self.check()?;
        self.values()
            .get(&(service.into(), account.into()))
            .cloned()
            .ok_or(KeyError::NoEntry)
    }

    fn set(&self, service: &str, account: &str, value: &str) -> Result<(), KeyError> {
        self.check()?;
        self.values()
            .insert((service.into(), account.into()), value.into());
        Ok(())
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), KeyError> {
        self.check()?;
        self.values()
            .remove(&(service.into(), account.into()))
            .map(|_| ())
            .ok_or(KeyError::NoEntry)
    }
}

/// The OS store, or the in-memory one for isolated (`--smoke`) runs.
pub fn key_store() -> &'static dyn KeyStore {
    static MEMORY: OnceLock<MemoryKeyStore> = OnceLock::new();
    if crate::data_dir::isolated().is_some() {
        MEMORY.get_or_init(MemoryKeyStore::default)
    } else {
        &OsKeyStore
    }
}

pub fn service(project_key: &str) -> String {
    format!("pigeon:{project_key}")
}

#[derive(Default, Serialize, Deserialize)]
struct Index {
    accounts: BTreeSet<String>,
}

/// `<app-data>/projects/<key>/keychain.json`, validated like the app-state namespace.
pub fn index_file(app_data: &Path, project_key: &str) -> Result<PathBuf, String> {
    Ok(crate::app_state::secrets_file(app_data, project_key)?.with_file_name("keychain.json"))
}

fn read_index(file: &Path) -> Index {
    std::fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_index(file: &Path, index: &Index) -> Result<(), String> {
    if index.accounts.is_empty() {
        return match std::fs::remove_file(file) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        };
    }
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_string(index).map_err(|error| error.to_string())?;
    crate::files::write_file_atomic(file, json.as_bytes())
        .map_err(|error| format!("Could not write the keychain index: {error}"))
}

fn valid_account(account: &str) -> Result<(), String> {
    if account.is_empty() || account.len() > 1000 || account.contains('\0') {
        return Err("Invalid secret name".into());
    }
    Ok(())
}

fn unavailable(error: KeyError) -> String {
    match error {
        KeyError::NoEntry => "The secret is not in the OS credential store".into(),
        KeyError::Unavailable(reason) => reason,
    }
}

/// `Ok` when the credential store answers (looking up an entry that does not exist).
pub fn status(store: &dyn KeyStore) -> Result<(), String> {
    match store.get("pigeon:probe", "availability") {
        Ok(_) | Err(KeyError::NoEntry) => Ok(()),
        Err(KeyError::Unavailable(reason)) => Err(reason),
    }
}

/// Every listed secret of a project. Accounts whose entry is gone are dropped from the index.
pub fn get_all(
    store: &dyn KeyStore,
    app_data: &Path,
    project_key: &str,
) -> Result<HashMap<String, String>, String> {
    let _guard = LOCK.lock().map_err(|error| error.to_string())?;
    let file = index_file(app_data, project_key)?;
    let mut index = read_index(&file);
    let service = service(project_key);
    let mut values = HashMap::new();
    let mut gone = Vec::new();
    for account in &index.accounts {
        match store.get(&service, account) {
            Ok(value) => {
                values.insert(account.clone(), value);
            }
            Err(KeyError::NoEntry) => gone.push(account.clone()),
            Err(error) => return Err(unavailable(error)),
        }
    }
    if !gone.is_empty() {
        for account in gone {
            index.accounts.remove(&account);
        }
        write_index(&file, &index)?;
    }
    Ok(values)
}

pub fn set(
    store: &dyn KeyStore,
    app_data: &Path,
    project_key: &str,
    account: &str,
    value: &str,
) -> Result<(), String> {
    valid_account(account)?;
    let _guard = LOCK.lock().map_err(|error| error.to_string())?;
    let file = index_file(app_data, project_key)?;
    store
        .set(&service(project_key), account, value)
        .map_err(unavailable)?;
    let mut index = read_index(&file);
    if index.accounts.insert(account.to_owned()) {
        write_index(&file, &index)?;
    }
    Ok(())
}

pub fn delete(
    store: &dyn KeyStore,
    app_data: &Path,
    project_key: &str,
    account: &str,
) -> Result<(), String> {
    valid_account(account)?;
    let _guard = LOCK.lock().map_err(|error| error.to_string())?;
    let file = index_file(app_data, project_key)?;
    match store.delete(&service(project_key), account) {
        Ok(()) | Err(KeyError::NoEntry) => {}
        Err(error) => return Err(unavailable(error)),
    }
    let mut index = read_index(&file);
    if index.accounts.remove(account) {
        write_index(&file, &index)?;
    }
    Ok(())
}

/// "Forget all secrets for this project": every listed credential, the index and any
/// `secrets.json` left from before the keychain (or from the fallback).
pub fn clear(store: &dyn KeyStore, app_data: &Path, project_key: &str) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|error| error.to_string())?;
    let file = index_file(app_data, project_key)?;
    let mut index = read_index(&file);
    let service = service(project_key);
    let mut failure = None;
    for account in std::mem::take(&mut index.accounts) {
        match store.delete(&service, &account) {
            Ok(()) | Err(KeyError::NoEntry) => {}
            Err(error) => {
                failure = Some(unavailable(error));
                index.accounts.insert(account);
            }
        }
    }
    write_index(&file, &index)?;
    remove_secrets_file(app_data, project_key)?;
    match failure {
        Some(reason) => Err(reason),
        None => Ok(()),
    }
}

/// Deletes `secrets.json` (after a verified migration, or when forgetting all secrets).
pub fn remove_secrets_file(app_data: &Path, project_key: &str) -> Result<(), String> {
    let file = crate::app_state::secrets_file(app_data, project_key)?;
    match std::fs::remove_file(&file) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("Could not delete secrets.json: {error}"))
        }
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
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn keychain_status() -> Result<(), String> {
    blocking(|| status(key_store())).await
}

#[tauri::command]
pub async fn keychain_get_all<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
) -> Result<HashMap<String, String>, String> {
    let dir = app_data(&app)?;
    blocking(move || get_all(key_store(), &dir, &project_id)).await
}

#[tauri::command]
pub async fn keychain_set<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
    account: String,
    value: String,
) -> Result<(), String> {
    let dir = app_data(&app)?;
    blocking(move || set(key_store(), &dir, &project_id, &account, &value)).await
}

#[tauri::command]
pub async fn keychain_delete<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
    account: String,
) -> Result<(), String> {
    let dir = app_data(&app)?;
    blocking(move || delete(key_store(), &dir, &project_id, &account)).await
}

#[tauri::command]
pub async fn keychain_clear<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
) -> Result<(), String> {
    let dir = app_data(&app)?;
    blocking(move || clear(key_store(), &dir, &project_id)).await
}

#[tauri::command]
pub async fn secrets_remove<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
) -> Result<(), String> {
    let dir = app_data(&app)?;
    blocking(move || remove_secrets_file(&dir, &project_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("pigeon-keychain-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn set_get_all_delete_round_trip_with_an_index_of_names_only() {
        let store = MemoryKeyStore::default();
        let dir = temp_dir("roundtrip");
        set(&store, &dir, "p1", "env:a/token", "s3cret").unwrap();
        set(&store, &dir, "p1", "globals/key", "k").unwrap();
        set(&store, &dir, "p2", "env:a/token", "other").unwrap();

        let all = get_all(&store, &dir, "p1").unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all["env:a/token"], "s3cret");
        assert_eq!(store.get("pigeon:p1", "globals/key").unwrap(), "k");

        let index = std::fs::read_to_string(index_file(&dir, "p1").unwrap()).unwrap();
        assert!(index.contains("env:a/token"));
        assert!(!index.contains("s3cret"), "the index never holds values");

        delete(&store, &dir, "p1", "env:a/token").unwrap();
        delete(&store, &dir, "p1", "env:a/token").unwrap(); // idempotent
        assert_eq!(get_all(&store, &dir, "p1").unwrap().len(), 1);
        assert_eq!(get_all(&store, &dir, "p2").unwrap()["env:a/token"], "other");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn entries_removed_outside_pigeon_are_dropped_from_the_index() {
        let store = MemoryKeyStore::default();
        let dir = temp_dir("stale");
        set(&store, &dir, "p1", "globals/a", "1").unwrap();
        set(&store, &dir, "p1", "globals/b", "2").unwrap();
        store.delete("pigeon:p1", "globals/a").unwrap();
        assert_eq!(get_all(&store, &dir, "p1").unwrap().len(), 1);
        let index = std::fs::read_to_string(index_file(&dir, "p1").unwrap()).unwrap();
        assert!(!index.contains("globals/a"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clear_forgets_every_entry_the_index_and_secrets_json() {
        let store = MemoryKeyStore::default();
        let dir = temp_dir("clear");
        set(&store, &dir, "p1", "globals/a", "1").unwrap();
        crate::app_state::write_secrets(&dir, "p1", r#"{"x":"y"}"#).unwrap();
        clear(&store, &dir, "p1").unwrap();
        assert_eq!(store.get("pigeon:p1", "globals/a"), Err(KeyError::NoEntry));
        assert!(!index_file(&dir, "p1").unwrap().exists());
        assert_eq!(crate::app_state::read_secrets(&dir, "p1").unwrap(), None);
        clear(&store, &dir, "p1").unwrap(); // nothing left: still fine
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unavailable_store_reports_errors_instead_of_values() {
        let store = MemoryKeyStore {
            unavailable: Some("org.freedesktop.secrets was not provided".into()),
            ..MemoryKeyStore::default()
        };
        let dir = temp_dir("unavailable");
        assert!(status(&store).unwrap_err().contains("freedesktop"));
        assert!(set(&store, &dir, "p1", "globals/a", "1").is_err());
        assert!(
            !index_file(&dir, "p1").unwrap().exists(),
            "nothing indexed on failure"
        );
        assert_eq!(status(&MemoryKeyStore::default()), Ok(()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_project_keys_and_accounts_are_refused() {
        let store = MemoryKeyStore::default();
        let dir = temp_dir("invalid");
        assert!(set(&store, &dir, "../x", "globals/a", "1").is_err());
        assert!(set(&store, &dir, "p1", "", "1").is_err());
        assert!(get_all(&store, &dir, "a/b").is_err());
    }

    /// Real OS store round trip; run by hand per OS (release checklist):
    /// `cargo test keychain::tests::os_store_round_trip -- --ignored`.
    #[test]
    #[ignore = "touches the real OS credential store"]
    fn os_store_round_trip() {
        let store = OsKeyStore;
        let service = format!("pigeon:cargo-test-{}", std::process::id());
        status(&store).expect("credential store available");
        store.set(&service, "globals/token", "s3cret").unwrap();
        assert_eq!(store.get(&service, "globals/token").unwrap(), "s3cret");
        store.delete(&service, "globals/token").unwrap();
        assert_eq!(store.get(&service, "globals/token"), Err(KeyError::NoEntry));
    }
}
