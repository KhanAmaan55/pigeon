//! `save_file`: `FileExchange.saveFile` on desktop (docs/platform.md §2). Rust shows the native
//! Save dialog (tauri-plugin-dialog) and writes the bytes itself, so the webview needs no
//! filesystem permission: it can only write where the user just chose.
//!
//! The argument is one binary frame like `http_send`'s: `[u32 LE JSON length][JSON][bytes]`,
//! with JSON `{ "suggestedName": "...", "mime": "..." }`, so the bytes never go through JSON.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Runtime;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub suggested_name: String,
    #[serde(default)]
    pub mime: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SaveOutcome {
    Saved,
    Cancelled,
}

pub fn decode_save_frame(frame: &[u8]) -> Result<(SaveRequest, &[u8]), String> {
    let (len, rest) = frame
        .split_first_chunk::<4>()
        .ok_or("save_file: frame shorter than its length prefix")?;
    let len = u32::from_le_bytes(*len) as usize;
    if len > rest.len() {
        return Err(format!("save_file: JSON length {len} exceeds the frame"));
    }
    let (json, bytes) = rest.split_at(len);
    let request = serde_json::from_slice(json).map_err(|error| format!("save_file: {error}"))?;
    Ok((request, bytes))
}

/// Writes `bytes` to a temporary file next to `path`, then renames it into place, so `path`
/// never holds a partial file.
pub fn write_file_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().filter(|dir| !dir.as_os_str().is_empty());
    let name = path
        .file_name()
        .map_or_else(|| "file".into(), |name| name.to_string_lossy().into_owned());
    let temp: PathBuf = dir
        .unwrap_or_else(|| Path::new("."))
        .join(format!(".{name}.pigeon-{}.tmp", std::process::id()));
    let result = (|| {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Resolves `"saved"` or `"cancelled"`; rejects with a message when the file can't be written.
#[tauri::command]
pub async fn save_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<SaveOutcome, String> {
    let tauri::ipc::InvokeBody::Raw(frame) = request.body() else {
        return Err("save_file expects a binary frame.".into());
    };
    let (meta, bytes) = decode_save_frame(frame)?;
    let bytes = bytes.to_vec();
    let dialog = app.dialog().file().set_file_name(&meta.suggested_name);
    let chosen = tokio::task::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|error| error.to_string())?;
    let Some(chosen) = chosen else {
        return Ok(SaveOutcome::Cancelled);
    };
    let path = chosen.into_path().map_err(|error| error.to_string())?;
    let shown = path.display().to_string();
    tokio::task::spawn_blocking(move || write_file_atomic(&path, &bytes))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("Could not write {shown}: {error}"))?;
    Ok(SaveOutcome::Saved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(json: &str, bytes: &[u8]) -> Vec<u8> {
        let mut frame = (json.len() as u32).to_le_bytes().to_vec();
        frame.extend_from_slice(json.as_bytes());
        frame.extend_from_slice(bytes);
        frame
    }

    #[test]
    fn frames_carry_the_name_then_the_exact_bytes() {
        let bytes = [0u8, 255, 13, 10, 0xf0, 0x9f, 0x90, 0xa6];
        let frame = frame(
            r#"{"suggestedName":"🐦-ünï.json","mime":"application/json"}"#,
            &bytes,
        );
        let (meta, body) = decode_save_frame(&frame).unwrap();
        assert_eq!(
            meta,
            SaveRequest {
                suggested_name: "🐦-ünï.json".into(),
                mime: Some("application/json".into())
            }
        );
        assert_eq!(body, bytes);
    }

    #[test]
    fn malformed_frames_are_rejected() {
        assert!(decode_save_frame(&[1, 0]).is_err());
        assert!(decode_save_frame(&[9, 0, 0, 0, b'{']).is_err());
        assert!(decode_save_frame(&frame("{}", &[])).is_err());
    }

    #[test]
    fn writes_replace_files_atomically_with_the_exact_bytes() {
        let dir = std::env::temp_dir().join(format!("pigeon-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("body.bin");
        std::fs::write(&path, b"old contents that are longer").unwrap();
        let bytes: Vec<u8> = (0..=255).collect();

        write_file_atomic(&path, &bytes).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name())
            .collect();
        assert_eq!(leftovers, [std::ffi::OsString::from("body.bin")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn outcomes_serialize_as_the_typescript_strings() {
        assert_eq!(
            serde_json::to_value(SaveOutcome::Saved).unwrap(),
            serde_json::json!("saved")
        );
        assert_eq!(
            serde_json::to_value(SaveOutcome::Cancelled).unwrap(),
            serde_json::json!("cancelled")
        );
    }
}
