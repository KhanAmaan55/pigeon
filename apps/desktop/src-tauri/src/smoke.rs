//! `--smoke`: start the app, wait until the UI shell has rendered with its bundled assets and a
//! request has gone through the native transport, print `smoke-ok` to stdout and exit 0. Any
//! failure exits non-zero. CI runs this on every OS.

use std::io::{self, BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;
use std::{process, thread};

use tauri::{plugin, Builder, Wry};

const FLAG: &str = "--smoke";
const OK: &str = "smoke-ok";
const TIMEOUT: Duration = Duration::from_secs(60);

/// Runs before the page's own scripts on every load: records errors, then reports once the
/// shell has rendered.
const PROBE: &str = include_str!("smoke.js");
/// Replaced in [`PROBE`] with the URL of [`serve_probe_target`].
const URL_PLACEHOLDER: &str = "__SMOKE_HTTP_URL__";
const PROBE_BODY: &str = "{\"smoke\":\"native-ok\"}\n";

pub fn requested(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().skip(1).any(|arg| arg == FLAG)
}

/// Adds the probe and the timeout. `main` registers [`smoke_report`] with the other commands.
pub fn install(builder: Builder<Wry>) -> Builder<Wry> {
    let url = serve_probe_target()
        .unwrap_or_else(|error| finish(Err(format!("probe target server: {error}"))));
    builder
        .plugin(
            plugin::Builder::<Wry>::new("smoke")
                .js_init_script(PROBE.replace(URL_PLACEHOLDER, &url))
                .build(),
        )
        .setup(|_| {
            thread::spawn(|| {
                thread::sleep(TIMEOUT);
                finish(Err(format!("timed out after {}s", TIMEOUT.as_secs())));
            });
            Ok(())
        })
}

/// A one-route HTTP server for the probe's request. It sends no CORS headers, so only the native
/// transport (not the webview's fetch) can read the answer.
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
    let mut line = String::new();
    while reader.read_line(&mut line)? > 2 {
        line.clear();
    }
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\
         Connection: close\r\n\r\n{PROBE_BODY}",
        PROBE_BODY.len()
    )
}

#[tauri::command]
pub fn smoke_report(error: Option<String>) {
    finish(error.map_or(Ok(()), Err));
}

fn finish(result: Result<(), String>) -> ! {
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
            .write_all(b"GET /smoke HTTP/1.1\r\nHost: x\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.ends_with(PROBE_BODY));
        assert!(!response.to_lowercase().contains("access-control"));
    }
}
