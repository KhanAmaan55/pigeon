//! Native HTTP transport (docs/api-execution.md §7.1): the `http_send` and `http_cancel` commands
//! behind `NativeTransport` in `@pigeon/platform-desktop`.
//!
//! Requests bypass the webview, so CORS and forbidden-header rules don't apply. Redirects are
//! followed by hand so every hop is recorded. Bodies cross the IPC bridge as raw bytes in both
//! directions (see [`decode_frame`] / [`encode_frame`]), never as base64 or JSON number arrays.

use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use flate2::read::{DeflateDecoder, MultiGzDecoder, ZlibDecoder};
use futures_util::future::{AbortHandle, Abortable};
use reqwest::header::{self, HeaderMap, HeaderName, HeaderValue};
use reqwest::{Client, Method, StatusCode, Version};
use serde::{Deserialize, Serialize};
use url::Url;

/// Default cap on a decoded response body; the rest is dropped with a warning.
pub const MAX_RESPONSE_BYTES: usize = 100 * 1024 * 1024;

/// Sent unless the request sets its own `Accept-Encoding`; [`decode_body`] handles all of them.
const ACCEPT_ENCODING: &str = "gzip, deflate, br, zstd";

/// Request headers that must not follow a redirect to another origin (same set as browsers and
/// reqwest's own redirect policy), plus `Host`, which names the original server.
const CROSS_ORIGIN_STRIPPED: [HeaderName; 4] = [
    header::AUTHORIZATION,
    header::COOKIE,
    header::PROXY_AUTHORIZATION,
    header::HOST,
];

/// Headers that describe a body; dropped when a redirect turns the request into a bodyless GET.
const BODY_HEADERS: [HeaderName; 4] = [
    header::CONTENT_TYPE,
    header::CONTENT_LENGTH,
    header::CONTENT_ENCODING,
    header::TRANSFER_ENCODING,
];

// ---------------------------------------------------------------------------------------------
// Wire types. Field names match the TypeScript types in `@pigeon/platform` (transport.ts).
// ---------------------------------------------------------------------------------------------

/// `PreparedRequest` without its body bytes, which follow the JSON in the IPC frame.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedRequest {
    pub id: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<PreparedBody>,
    pub settings: RequestSettings,
    #[serde(default)]
    pub meta: RequestMeta,
}

/// Only `bytes` for now; multipart and file bodies arrive with PIGN-009.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PreparedBody {
    Bytes,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestSettings {
    /// `0` = no timeout.
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub max_redirects: u32,
    #[serde(rename = "strictSSL")]
    pub strict_ssl: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestMeta {
    /// Selects the connection pool; absent for scratch requests.
    #[serde(default)]
    pub project_id: Option<String>,
}

/// `RawResponse` without its body bytes, which follow the JSON in the IPC frame.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawResponse {
    pub status: u16,
    pub status_text: String,
    /// Raw order per name, duplicates kept (`Set-Cookie`).
    pub headers: Vec<(String, String)>,
    /// Decoded (content-encoding removed).
    #[serde(skip)]
    pub body: Vec<u8>,
    /// Final URL after redirects.
    pub url: String,
    pub redirects: Vec<RedirectHop>,
    pub http_version: String,
    pub timings: Timings,
    pub headers_restricted: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RedirectHop {
    pub status: u16,
    /// The URL that answered with the redirect.
    pub url: String,
    /// The `Location` header as sent (may be relative).
    pub location: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
    /// Unix epoch milliseconds.
    pub started_at: u64,
    pub total_ms: f64,
    /// Until the final response's headers arrived (redirect hops included).
    pub ttfb_ms: f64,
}

/// `TransportErrorKind` values this transport produces.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorKind {
    Network,
    Timeout,
    Aborted,
    Tls,
    Dns,
    ConnectionRefused,
    InvalidUrl,
    InvalidRequest,
}

/// Rejection value of `http_send`; `NativeTransport` turns it into a `TransportError`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TransportFailure {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl TransportFailure {
    fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            detail: None,
        }
    }

    fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    fn aborted() -> Self {
        Self::new(ErrorKind::Aborted, "The request was cancelled.")
    }
}

// ---------------------------------------------------------------------------------------------
// IPC frames: `[u32 little-endian JSON length][JSON][body bytes]`, both directions.
// ---------------------------------------------------------------------------------------------

pub fn decode_frame(frame: &[u8]) -> Result<(PreparedRequest, Bytes), TransportFailure> {
    let malformed = |detail: String| {
        TransportFailure::new(ErrorKind::InvalidRequest, "The request could not be read.")
            .with_detail(detail)
    };
    let (len, rest) = frame
        .split_first_chunk::<4>()
        .ok_or_else(|| malformed("frame shorter than its length prefix".into()))?;
    let len = u32::from_le_bytes(*len) as usize;
    if len > rest.len() {
        return Err(malformed(format!("JSON length {len} exceeds frame")));
    }
    let (json, body) = rest.split_at(len);
    let request: PreparedRequest =
        serde_json::from_slice(json).map_err(|error| malformed(error.to_string()))?;
    Ok((request, Bytes::copy_from_slice(body)))
}

pub fn encode_frame(response: &RawResponse) -> Vec<u8> {
    let json = serde_json::to_vec(response).expect("RawResponse serializes");
    let mut frame = Vec::with_capacity(4 + json.len() + response.body.len());
    frame.extend_from_slice(&(json.len() as u32).to_le_bytes());
    frame.extend_from_slice(&json);
    frame.extend_from_slice(&response.body);
    frame
}

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------

/// One pool per project, split by TLS strictness (a client-level setting in reqwest).
type ClientKey = (Option<String>, bool);

enum Inflight {
    Running(AbortHandle),
    /// `http_cancel` arrived before `http_send` registered (IPC calls may be reordered).
    CancelledEarly,
}

/// Managed Tauri state: connection pools and the abort handles of in-flight requests.
pub struct HttpState {
    clients: Mutex<HashMap<ClientKey, Client>>,
    inflight: Mutex<HashMap<String, Inflight>>,
    max_body: usize,
}

impl Default for HttpState {
    fn default() -> Self {
        Self::with_max_body(MAX_RESPONSE_BYTES)
    }
}

impl HttpState {
    pub fn with_max_body(max_body: usize) -> Self {
        Self {
            clients: Mutex::default(),
            inflight: Mutex::default(),
            max_body,
        }
    }

    /// Sends `req`; rejects with `aborted` when [`HttpState::cancel`] is called with its id.
    pub async fn send(
        &self,
        req: PreparedRequest,
        body: Bytes,
    ) -> Result<RawResponse, TransportFailure> {
        let (handle, registration) = AbortHandle::new_pair();
        let _guard = self.register(&req.id, handle)?;
        Abortable::new(self.execute(req, body), registration)
            .await
            .unwrap_or_else(|_| Err(TransportFailure::aborted()))
    }

    /// Aborts an in-flight request. Returns whether it was running.
    pub fn cancel(&self, id: &str) -> bool {
        let mut inflight = self.inflight.lock().unwrap();
        match inflight.remove(id) {
            Some(Inflight::Running(handle)) => {
                handle.abort();
                true
            }
            _ => {
                inflight.insert(id.to_owned(), Inflight::CancelledEarly);
                false
            }
        }
    }

    fn register(
        &self,
        id: &str,
        handle: AbortHandle,
    ) -> Result<InflightGuard<'_>, TransportFailure> {
        let mut inflight = self.inflight.lock().unwrap();
        if let Some(Inflight::CancelledEarly) = inflight.remove(id) {
            return Err(TransportFailure::aborted());
        }
        inflight.insert(id.to_owned(), Inflight::Running(handle));
        Ok(InflightGuard {
            state: self,
            id: id.to_owned(),
        })
    }

    fn client(
        &self,
        project_id: Option<&str>,
        strict_ssl: bool,
    ) -> Result<Client, TransportFailure> {
        let key = (project_id.map(str::to_owned), strict_ssl);
        let mut clients = self.clients.lock().unwrap();
        if let Some(client) = clients.get(&key) {
            return Ok(client.clone()); // cheap: an Arc around the pool
        }
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .tls_danger_accept_invalid_certs(!strict_ssl)
            .tls_danger_accept_invalid_hostnames(!strict_ssl)
            .build()
            .map_err(|error| {
                TransportFailure::new(ErrorKind::Network, "The HTTP client could not be created.")
                    .with_detail(error_chain(&error))
            })?;
        clients.insert(key, client.clone());
        Ok(client)
    }

    async fn execute(
        &self,
        req: PreparedRequest,
        body: Bytes,
    ) -> Result<RawResponse, TransportFailure> {
        let started_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as u64);
        let start = Instant::now();
        let timeout_ms = req.settings.timeout_ms;
        let exchange = self.exchange(req, body, start, started_at);
        if timeout_ms == 0 {
            return exchange.await;
        }
        tokio::time::timeout(Duration::from_millis(timeout_ms), exchange)
            .await
            .unwrap_or_else(|_| {
                Err(TransportFailure::new(
                    ErrorKind::Timeout,
                    format!("The request timed out after {timeout_ms} ms."),
                ))
            })
    }

    /// Request → manual redirect loop → body. Covered as a whole by the timeout.
    async fn exchange(
        &self,
        req: PreparedRequest,
        body: Bytes,
        start: Instant,
        started_at: u64,
    ) -> Result<RawResponse, TransportFailure> {
        let settings = &req.settings;
        let client = self.client(req.meta.project_id.as_deref(), settings.strict_ssl)?;
        let mut method = parse_method(&req.method)?;
        let mut url = parse_url(&req.url)?;
        let mut headers = build_headers(&req.headers)?;
        if !headers.contains_key(header::ACCEPT_ENCODING) {
            headers.insert(
                header::ACCEPT_ENCODING,
                HeaderValue::from_static(ACCEPT_ENCODING),
            );
        }
        let mut body = req.body.map(|_| body);
        let mut redirects = Vec::new();

        let mut response = loop {
            let mut request = client
                .request(method.clone(), url.clone())
                .headers(headers.clone());
            if let Some(bytes) = &body {
                request = request.body(bytes.clone());
            }
            let response = request.send().await.map_err(classify)?;
            let status = response.status();

            let location = match response.headers().get(header::LOCATION) {
                Some(location) if settings.follow_redirects && is_redirect(status) => {
                    String::from_utf8_lossy(location.as_bytes()).into_owned()
                }
                _ => break response,
            };
            if redirects.len() >= settings.max_redirects as usize {
                return Err(TransportFailure::new(
                    ErrorKind::Network,
                    format!("Too many redirects (more than {}).", settings.max_redirects),
                ));
            }
            let next = url.join(&location).map_err(|error| {
                TransportFailure::new(
                    ErrorKind::Network,
                    "The redirect location is not a valid URL.",
                )
                .with_detail(format!("Location: {location} ({error})"))
            })?;

            // 301/302/303 → GET without body (Postman and browsers); 307/308 keep both.
            let to_get = match status {
                StatusCode::SEE_OTHER => method != Method::HEAD,
                StatusCode::MOVED_PERMANENTLY | StatusCode::FOUND => {
                    method != Method::GET && method != Method::HEAD
                }
                _ => false,
            };
            if to_get {
                method = Method::GET;
                body = None;
                for name in &BODY_HEADERS {
                    headers.remove(name);
                }
            }
            if next.origin() != url.origin() {
                for name in &CROSS_ORIGIN_STRIPPED {
                    headers.remove(name);
                }
            }

            redirects.push(RedirectHop {
                status: status.as_u16(),
                url: url.to_string(),
                location,
            });
            url = next;
        };

        let ttfb_ms = elapsed_ms(start);
        let status = response.status();
        let status_text = response
            .extensions()
            .get::<hyper::ext::ReasonPhrase>()
            .map(|reason| String::from_utf8_lossy(reason.as_bytes()).into_owned())
            .or_else(|| status.canonical_reason().map(str::to_owned))
            .unwrap_or_default();
        let response_headers = response
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.as_str().to_owned(),
                    String::from_utf8_lossy(value.as_bytes()).into_owned(),
                )
            })
            .collect();
        let http_version = version_label(response.version()).to_owned();
        let final_url = response.url().to_string();

        let encodings = content_encodings(response.headers());
        let mut warnings = Vec::new();
        let mut bytes = Vec::new();
        let mut truncated = false;
        while let Some(chunk) = response.chunk().await.map_err(classify)? {
            let room = self.max_body - bytes.len();
            if chunk.len() > room {
                bytes.extend_from_slice(&chunk[..room]);
                truncated = true;
                break;
            }
            bytes.extend_from_slice(&chunk);
        }
        if !encodings.is_empty() && !bytes.is_empty() {
            let max_body = self.max_body;
            let decoded =
                tokio::task::spawn_blocking(move || decode_body(bytes, &encodings, max_body))
                    .await
                    .expect("body decoder panicked");
            bytes = decoded.body;
            truncated |= decoded.truncated;
            warnings.extend(decoded.warning);
        }
        if truncated {
            warnings.push(format!(
                "The response body was truncated to {} MB.",
                self.max_body as f64 / (1024.0 * 1024.0)
            ));
        }

        Ok(RawResponse {
            status: status.as_u16(),
            status_text,
            headers: response_headers,
            body: bytes,
            url: final_url,
            redirects,
            http_version,
            timings: Timings {
                started_at,
                total_ms: elapsed_ms(start),
                ttfb_ms,
            },
            headers_restricted: false,
            warnings,
        })
    }
}

/// Removes the abort handle when a send finishes or its future is dropped.
struct InflightGuard<'a> {
    state: &'a HttpState,
    id: String,
}

impl Drop for InflightGuard<'_> {
    fn drop(&mut self) {
        let mut inflight = self.state.inflight.lock().unwrap();
        if let Some(Inflight::Running(_)) = inflight.get(&self.id) {
            inflight.remove(&self.id);
        }
    }
}

/// `Content-Encoding` codings in the order they were applied, lowercased, without `identity`.
fn content_encodings(headers: &HeaderMap) -> Vec<String> {
    headers
        .get_all(header::CONTENT_ENCODING)
        .iter()
        .flat_map(|value| {
            String::from_utf8_lossy(value.as_bytes())
                .split(',')
                .map(|coding| coding.trim().to_ascii_lowercase())
                .collect::<Vec<_>>()
        })
        .filter(|coding| !coding.is_empty() && coding != "identity")
        .collect()
}

struct DecodedBody {
    body: Vec<u8>,
    truncated: bool,
    warning: Option<String>,
}

/// Undoes `encodings` (last applied first), stopping at `max_body` decoded bytes. A body that
/// can't be decoded is returned as far as it got, with a warning.
fn decode_body(body: Vec<u8>, encodings: &[String], max_body: usize) -> DecodedBody {
    let mut body = body;
    let mut truncated = false;
    for coding in encodings.iter().rev() {
        let step = {
            let input = &body[..];
            let reader: Result<Box<dyn Read + '_>, String> = match coding.as_str() {
                "gzip" | "x-gzip" => Ok(Box::new(MultiGzDecoder::new(input))),
                // RFC 9110 says zlib-wrapped, but some servers send raw deflate (browsers accept both).
                "deflate" if is_zlib(input) => Ok(Box::new(ZlibDecoder::new(input))),
                "deflate" => Ok(Box::new(DeflateDecoder::new(input))),
                "br" => Ok(Box::new(brotli_decompressor::Decompressor::new(
                    input,
                    64 * 1024,
                ))),
                "zstd" => zstd::stream::read::Decoder::with_buffer(input)
                    .map(|decoder| Box::new(decoder) as Box<dyn Read>)
                    .map_err(|error| error.to_string()),
                other => Err(format!("unsupported Content-Encoding \"{other}\"")),
            };
            reader.and_then(|reader| {
                let mut decoded = Vec::new();
                reader
                    .take(max_body as u64 + 1)
                    .read_to_end(&mut decoded)
                    .map(|_| decoded)
                    .map_err(|error| format!("{coding}: {error}"))
            })
        };
        match step {
            Ok(mut decoded) => {
                if decoded.len() > max_body {
                    decoded.truncate(max_body);
                    truncated = true;
                }
                body = decoded;
            }
            Err(error) => {
                let warning = format!(
                    "The response body could not be decoded ({error}); it is shown as received."
                );
                return DecodedBody {
                    body,
                    truncated,
                    warning: Some(warning),
                };
            }
        }
    }
    DecodedBody {
        body,
        truncated,
        warning: None,
    }
}

/// A zlib header: CM = 8 (deflate) and the check bits make the first two bytes a multiple of 31.
fn is_zlib(data: &[u8]) -> bool {
    matches!(data, [cmf, flg, ..] if cmf & 0x0f == 8 && (u16::from(*cmf) << 8 | u16::from(*flg)) % 31 == 0)
}

fn is_redirect(status: StatusCode) -> bool {
    matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308)
}

fn parse_method(method: &str) -> Result<Method, TransportFailure> {
    Method::from_bytes(method.as_bytes()).map_err(|_| {
        TransportFailure::new(
            ErrorKind::InvalidRequest,
            format!("\"{method}\" is not a valid HTTP method."),
        )
    })
}

fn parse_url(raw: &str) -> Result<Url, TransportFailure> {
    let url = Url::parse(raw).map_err(|error| {
        TransportFailure::new(
            ErrorKind::InvalidUrl,
            format!("\"{raw}\" is not a valid URL."),
        )
        .with_detail(error.to_string())
    })?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        scheme => Err(TransportFailure::new(
            ErrorKind::InvalidUrl,
            format!("Unsupported protocol \"{scheme}:\". Use http:// or https://."),
        )),
    }
}

/// Keeps duplicates. Values are sent as raw bytes, so UTF-8 passes through like in Postman.
fn build_headers(pairs: &[(String, String)]) -> Result<HeaderMap, TransportFailure> {
    let mut headers = HeaderMap::with_capacity(pairs.len());
    for (name, value) in pairs {
        let invalid = |what: &str| {
            TransportFailure::new(
                ErrorKind::InvalidRequest,
                format!("Header \"{name}\" has an invalid {what}."),
            )
        };
        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| invalid("name"))?;
        let header_value =
            HeaderValue::from_bytes(value.as_bytes()).map_err(|_| invalid("value"))?;
        headers.append(header_name, header_value);
    }
    Ok(headers)
}

fn version_label(version: Version) -> &'static str {
    match version {
        Version::HTTP_09 => "HTTP/0.9",
        Version::HTTP_10 => "HTTP/1.0",
        Version::HTTP_11 => "HTTP/1.1",
        Version::HTTP_2 => "HTTP/2",
        Version::HTTP_3 => "HTTP/3",
        _ => "HTTP",
    }
}

fn elapsed_ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

/// The error and all its sources, e.g. `error sending request: client error (Connect): …`.
fn error_chain(error: &dyn std::error::Error) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        let cause_text = cause.to_string();
        if !text.contains(&cause_text) {
            text.push_str(": ");
            text.push_str(&cause_text);
        }
        source = cause.source();
    }
    text
}

fn has_io_error(error: &(dyn std::error::Error + 'static), kind: std::io::ErrorKind) -> bool {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(cause) = source {
        if cause
            .downcast_ref::<std::io::Error>()
            .is_some_and(|io| io.kind() == kind)
        {
            return true;
        }
        source = cause.source();
    }
    false
}

/// Coarse reqwest error → kind mapping; PIGN-011 refines the wording and hints.
fn classify(error: reqwest::Error) -> TransportFailure {
    let detail = error_chain(&error);
    let lower = detail.to_lowercase();
    let (kind, message) = if error.is_timeout() {
        (ErrorKind::Timeout, "The request timed out.")
    } else if error.is_builder() {
        (ErrorKind::InvalidRequest, "The request could not be built.")
    } else if has_io_error(&error, std::io::ErrorKind::ConnectionRefused) {
        (
            ErrorKind::ConnectionRefused,
            "The server refused the connection.",
        )
    } else if lower.contains("dns error") || lower.contains("failed to lookup address") {
        (ErrorKind::Dns, "The host name could not be resolved.")
    } else if lower.contains("certificate") || lower.contains("tls") || lower.contains("handshake")
    {
        (
            ErrorKind::Tls,
            "The TLS connection could not be established.",
        )
    } else {
        (ErrorKind::Network, "The request failed.")
    };
    TransportFailure::new(kind, message).with_detail(detail)
}

// ---------------------------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------------------------

/// Body: an IPC frame (see [`decode_frame`]). Resolves to a response frame (`ArrayBuffer` in JS).
#[tauri::command]
pub async fn http_send(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, HttpState>,
) -> Result<tauri::ipc::Response, TransportFailure> {
    let tauri::ipc::InvokeBody::Raw(frame) = request.body() else {
        return Err(TransportFailure::new(
            ErrorKind::InvalidRequest,
            "http_send expects a binary request frame.",
        ));
    };
    let (req, body) = decode_frame(frame)?;
    let response = state.send(req, body).await?;
    Ok(tauri::ipc::Response::new(encode_frame(&response)))
}

#[tauri::command]
pub fn http_cancel(id: String, state: tauri::State<'_, HttpState>) -> bool {
    state.cancel(&id)
}

#[cfg(test)]
mod tests;
