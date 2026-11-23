//! OAuth 2.0 authorization-code redirects on desktop (PIGN-047, RFC 8252): a loopback listener on
//! `http://127.0.0.1:<port>/callback` receives the provider's redirect after the user approved in
//! the system browser. `oauth_begin` binds the port (a preferred loopback URI's port is honoured),
//! `oauth_complete` opens the authorization URL and waits for the redirect's query parameters.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;

const TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Default)]
pub struct OAuthListeners(Mutex<HashMap<String, TcpListener>>);

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Begun {
    pub redirect_uri: String,
    pub session: String,
}

static NEXT: AtomicU64 = AtomicU64::new(1);

/// Host, port and path of a loopback redirect URI (`http://127.0.0.1:8765/cb`), if it is one.
pub fn loopback(uri: &str) -> Option<(String, u16, String)> {
    let parsed = url::Url::parse(uri).ok()?;
    let host = parsed.host_str()?.to_owned();
    if parsed.scheme() != "http" || !matches!(host.as_str(), "127.0.0.1" | "localhost") {
        return None;
    }
    let path = if parsed.path().is_empty() {
        "/"
    } else {
        parsed.path()
    };
    Some((host, parsed.port().unwrap_or(80), path.to_owned()))
}

pub fn begin(listeners: &OAuthListeners, preferred: Option<&str>) -> Result<Begun, String> {
    let (host, port, path) =
        preferred
            .and_then(loopback)
            .unwrap_or(("127.0.0.1".into(), 0, "/callback".into()));
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("Cannot listen on 127.0.0.1:{port} for the OAuth redirect: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let session = format!("oauth-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    listeners
        .0
        .lock()
        .expect("oauth lock")
        .insert(session.clone(), listener);
    Ok(Begun {
        redirect_uri: format!("http://{host}:{port}{path}"),
        session,
    })
}

/// The query parameters of the first request that carries `code` or `error`.
pub fn wait(listener: TcpListener, deadline: Instant) -> Result<HashMap<String, String>, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(params) = answer(stream) {
                    return Ok(params);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Sign-in took too long (5 minutes).".into())
}

fn answer(mut stream: TcpStream) -> Option<HashMap<String, String>> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut line = String::new();
    BufReader::new(stream.try_clone().ok()?)
        .read_line(&mut line)
        .ok()?;
    let target = line.split_whitespace().nth(1)?;
    let parsed = url::Url::parse(&format!("http://loopback{target}")).ok()?;
    let params: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
    let done = params.contains_key("code") || params.contains_key("error");
    let body = if done {
        "<!doctype html><title>Pigeon</title><p style=\"font:14px system-ui;padding:2rem\">Signed in. You can close this window and return to Pigeon.</p>"
    } else {
        "Not found"
    };
    let status = if done { "200 OK" } else { "404 Not Found" };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    done.then_some(params)
}

#[tauri::command]
pub fn oauth_begin(
    listeners: State<'_, OAuthListeners>,
    preferred: Option<String>,
) -> Result<Begun, String> {
    begin(&listeners, preferred.as_deref())
}

#[tauri::command]
pub async fn oauth_complete(
    listeners: State<'_, OAuthListeners>,
    session: String,
    url: String,
) -> Result<HashMap<String, String>, String> {
    let listener = listeners
        .0
        .lock()
        .expect("oauth lock")
        .remove(&session)
        .ok_or("This sign-in attempt has expired; start again.")?;
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("The authorization URL must be http or https.".into());
    }
    let waiting =
        tauri::async_runtime::spawn_blocking(move || wait(listener, Instant::now() + TIMEOUT));
    if crate::smoke::active() {
        // Smoke runs have no user: follow the (auto-approving) page like a browser would.
        let _ = reqwest::get(parsed.as_str()).await;
    } else {
        crate::menu::open_in_browser(parsed.as_str());
    }
    waiting.await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_uris_keep_their_port_and_path() {
        assert_eq!(
            loopback("http://127.0.0.1:8765/cb"),
            Some(("127.0.0.1".into(), 8765, "/cb".into()))
        );
        assert_eq!(
            loopback("http://localhost:9000/"),
            Some(("localhost".into(), 9000, "/".into()))
        );
        assert_eq!(loopback("https://127.0.0.1:1/cb"), None);
        assert_eq!(loopback("http://example.com/cb"), None);
    }

    #[test]
    fn the_listener_returns_the_redirect_parameters() {
        let listeners = OAuthListeners::default();
        let begun = begin(&listeners, None).unwrap();
        assert!(begun.redirect_uri.starts_with("http://127.0.0.1:"));
        assert!(begun.redirect_uri.ends_with("/callback"));
        let listener = listeners.0.lock().unwrap().remove(&begun.session).unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || {
            // A stray request first (e.g. a favicon), then the redirect.
            for target in ["/favicon.ico", "/callback?code=abc&state=xyz"] {
                let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
                write!(stream, "GET {target} HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
                let mut reply = String::new();
                let _ = std::io::Read::read_to_string(&mut stream, &mut reply);
            }
        });
        let params = wait(listener, Instant::now() + Duration::from_secs(5)).unwrap();
        browser.join().unwrap();
        assert_eq!(params.get("code").map(String::as_str), Some("abc"));
        assert_eq!(params.get("state").map(String::as_str), Some("xyz"));
    }
}
