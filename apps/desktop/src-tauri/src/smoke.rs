//! `--smoke`: start the app, wait until the UI shell has rendered with its bundled assets and a
//! request has gone through the native transport, print `smoke-ok` to stdout and exit 0. Any
//! failure exits non-zero. CI runs this on every OS.

use std::io::{self, BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;
use std::{process, thread};

use tauri::{plugin, Builder, Wry};

const FLAG: &str = "--smoke";
/// With `--smoke`: also print `cold-start-ms: N`, process start → app shell rendered (PIGN-042).
const TIMING_FLAG: &str = "--timing";

/// When this process started, for `--timing` (set first thing in `install`).
static STARTED: std::sync::OnceLock<(std::time::SystemTime, bool)> = std::sync::OnceLock::new();
const OK: &str = "smoke-ok";
const TIMEOUT: Duration = Duration::from_secs(60);

/// Runs before the page's own scripts on every load: records errors, then reports once the
/// shell has rendered.
const PROBE: &str = include_str!("smoke.js");
/// Replaced in [`PROBE`] with the URL of [`serve_probe_target`].
const URL_PLACEHOLDER: &str = "__SMOKE_HTTP_URL__";
const ROOT_PLACEHOLDER: &str = "__SMOKE_PROJECT_ROOT__";
/// First line of every probe target answer; the request head it received follows.
const PROBE_MARKER: &str = "native-ok";

pub fn requested(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().skip(1).any(|arg| arg == FLAG)
}

/// Adds the probe and the timeout. `main` registers [`smoke_report`] with the other commands.
pub fn install(builder: Builder<Wry>) -> Builder<Wry> {
    let _ = STARTED.set((
        std::time::SystemTime::now(),
        std::env::args().any(|arg| arg == TIMING_FLAG),
    ));
    // Never the user's app data: a fresh directory, removed when the run ends.
    let data = std::env::temp_dir().join(format!("pigeon-smoke-{}", process::id()));
    let _ = std::fs::remove_dir_all(&data);
    if let Err(error) = std::fs::create_dir_all(&data) {
        finish(Err(format!("smoke data directory: {error}")));
    }
    let url = serve_probe_target()
        .unwrap_or_else(|error| finish(Err(format!("probe target server: {error}"))));
    let root = seed_project(&data, &url)
        .unwrap_or_else(|error| finish(Err(format!("smoke project: {error}"))));
    crate::data_dir::use_isolated(data);
    // A plain thread, not `Builder::setup`: Tauri keeps only the last setup hook, and main's
    // registers app state.
    thread::spawn(|| {
        thread::sleep(TIMEOUT);
        finish(Err(format!("timed out after {}s", TIMEOUT.as_secs())));
    });
    builder.plugin(
        plugin::Builder::<Wry>::new("smoke")
            .js_init_script(PROBE.replace(URL_PLACEHOLDER, &url).replace(
                ROOT_PLACEHOLDER,
                &serde_json::to_string(&root).unwrap_or_default(),
            ))
            .build(),
    )
}

/// A Pigeon project in the smoke data directory, already granted and listed as a recent project,
/// so the probe can open it without the folder picker (PIGN-040: open → edit → Save for Commit →
/// external change → reload on every OS). Returns the project root as the app stores it.
fn seed_project(data: &std::path::Path, url: &str) -> io::Result<String> {
    let dir = data.join("Smoke project");
    let files = [
        (
            "pigeon.json",
            r#"{"pigeon":{"formatVersion":1},"id":"smoke-project","name":"Smoke project","collections":["smoke"]}"#.to_owned(),
        ),
        (
            "collections/smoke/collection.json",
            r#"{"info":{"_postman_id":"smoke-collection","name":"Smoke","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"_pigeon":{"order":["ping"]}}"#.to_owned(),
        ),
        (
            "collections/smoke/ping.request.json",
            serde_json::json!({
                "id": "smoke-ping",
                "name": "Ping",
                "request": { "method": "GET", "header": [], "url": { "raw": format!("{url}/ping") } },
                // Runs in the QuickJS sandbox in a Worker (PIGN-043).
                "event": [{
                    "listen": "prerequest",
                    "script": { "exec": ["pm.request.headers.add({ key: 'X-Script', value: 'desktop' });"] }
                }]
            })
            .to_string(),
        ),
    ];
    for (path, text) in files {
        let file = dir.join(path);
        std::fs::create_dir_all(file.parent().unwrap_or(&dir))?;
        std::fs::write(file, text)?;
    }
    let root = dir.display().to_string();
    std::fs::write(
        data.join("project-roots.json"),
        serde_json::to_vec(&[&root]).map_err(io::Error::other)?,
    )?;
    let app = serde_json::json!({
        "recentProjects": [{
            "projectId": "smoke-project",
            "name": "Smoke project",
            "location": { "kind": "native", "absolutePath": root },
            "lastOpenedAt": "2026-01-01T00:00:00.000Z"
        }]
    });
    std::fs::write(data.join("app.json"), app.to_string())?;
    Ok(root)
}

/// A tiny HTTP server for the probe's request. It answers `native-ok` followed by the request
/// line and headers exactly as received (so the probe can check path variables and duplicate
/// headers end to end), and sends no CORS headers, so only the native transport (not the
/// webview's fetch) can read the answer.
fn serve_probe_target() -> io::Result<String> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let url = format!("http://{}/smoke", listener.local_addr()?);
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let _ = answer(stream);
        }
    });
    Ok(url)
}

fn answer(mut stream: TcpStream) -> io::Result<()> {
    // Read the request head; the probe sends no body.
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut body = format!("{PROBE_MARKER}\n");
    let mut line = String::new();
    while reader.read_line(&mut line)? > 2 {
        body.push_str(line.trim_end());
        body.push('\n');
        line.clear();
    }
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\n\
         Connection: close\r\n\r\n{body}",
        body.len()
    )
}

/// `shell_at_ms`: wall-clock time (ms since the epoch) when the app shell had rendered.
#[tauri::command]
pub fn smoke_report(error: Option<String>, shell_at_ms: Option<f64>) {
    if let (Some(&(started, true)), Some(shell_at)) = (STARTED.get(), shell_at_ms) {
        if let Some(ms) = cold_start_ms(started, shell_at) {
            println!("cold-start-ms: {ms}");
        }
    }
    finish(error.map_or(Ok(()), Err));
}

/// Milliseconds from `started` to `shell_at_ms` (epoch ms), if that is after `started`.
pub fn cold_start_ms(started: std::time::SystemTime, shell_at_ms: f64) -> Option<u64> {
    let started_ms = started
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as f64;
    (shell_at_ms >= started_ms).then(|| (shell_at_ms - started_ms).round() as u64)
}

fn finish(result: Result<(), String>) -> ! {
    if let Some(dir) = crate::data_dir::isolated() {
        let _ = std::fs::remove_dir_all(dir);
    }
    match result {
        Ok(()) => {
            println!("{OK}");
            let _ = std::io::stdout().flush();
            process::exit(0)
        }
        Err(error) => {
            eprintln!("smoke-failed: {error}");
            process::exit(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn cold_start_is_measured_from_process_start() {
        let started = std::time::UNIX_EPOCH + std::time::Duration::from_millis(1_000);
        assert_eq!(cold_start_ms(started, 2_234.4), Some(1_234));
        assert_eq!(cold_start_ms(started, 900.0), None);
    }

    #[test]
    fn smoke_flag_is_detected_after_the_binary_name() {
        assert!(requested(args(&["pigeon", "--smoke"])));
        assert!(requested(args(&["pigeon", "--other", "--smoke"])));
    }

    #[test]
    fn normal_launch_is_not_a_smoke_run() {
        assert!(!requested(args(&["pigeon"])));
        assert!(!requested(args(&["--smoke"])));
        assert!(!requested(args(&["pigeon", "--smoke-test"])));
    }

    #[test]
    fn probe_reports_through_the_registered_command() {
        assert!(PROBE.contains("'smoke_report'"));
    }

    #[test]
    fn probe_target_answers_without_cors_headers() {
        use std::io::Read;
        let url = serve_probe_target().unwrap();
        assert!(PROBE.contains(URL_PLACEHOLDER));
        let address = url.trim_start_matches("http://").trim_end_matches("/smoke");
        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .write_all(b"GET /smoke/42 HTTP/1.1\r\nHost: x\r\nX-Dup: a\r\nX-Dup: b\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response
            .ends_with("\r\n\r\nnative-ok\nGET /smoke/42 HTTP/1.1\nHost: x\nX-Dup: a\nX-Dup: b\n"));
        assert!(!response.to_lowercase().contains("access-control"));
    }
}
