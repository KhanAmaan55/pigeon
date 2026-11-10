//! `cargo test` cases mirroring `transportConformance` (packages/platform/src/conformance), run
//! against `@pigeon/test-server` (see `test_server.rs`).

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use serde_json::{json, Value};

use super::*;
use crate::test_server;

fn next_id() -> String {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    format!("exec-{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

fn request(method: &str, path: &str) -> PreparedRequest {
    let url = if path.starts_with("http") {
        path.to_owned()
    } else {
        format!("{}{path}", test_server::url())
    };
    PreparedRequest {
        id: next_id(),
        method: method.to_owned(),
        url,
        headers: Vec::new(),
        body: None,
        settings: RequestSettings {
            timeout_ms: 30_000,
            follow_redirects: true,
            max_redirects: 10,
            strict_ssl: true,
        },
        meta: RequestMeta::default(),
    }
}

fn with_headers(mut req: PreparedRequest, headers: &[(&str, &str)]) -> PreparedRequest {
    req.headers = headers
        .iter()
        .map(|(n, v)| (n.to_string(), v.to_string()))
        .collect();
    req
}

async fn send(req: PreparedRequest) -> RawResponse {
    send_body(req, None).await
}

async fn send_body(mut req: PreparedRequest, body: Option<&str>) -> RawResponse {
    if body.is_some() {
        req.body = Some(PreparedBody::Bytes);
    }
    let bytes = Bytes::copy_from_slice(body.unwrap_or_default().as_bytes());
    HttpState::default()
        .send(req, bytes)
        .await
        .expect("request succeeds")
}

async fn fail(req: PreparedRequest) -> TransportFailure {
    HttpState::default()
        .send(req, Bytes::new())
        .await
        .expect_err("request fails")
}

fn json_body(res: &RawResponse) -> Value {
    serde_json::from_slice(&res.body).expect("JSON body")
}

fn header_values<'a>(res: &'a RawResponse, name: &str) -> Vec<&'a str> {
    res.headers
        .iter()
        .filter(|(n, _)| n.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.as_str())
        .collect()
}

/// `/echo`'s `rawHeaders`, values for `name` in order.
fn echoed(echo: &Value, name: &str) -> Vec<String> {
    echo["rawHeaders"]
        .as_array()
        .expect("rawHeaders")
        .iter()
        .filter(|pair| {
            pair[0]
                .as_str()
                .is_some_and(|n| n.eq_ignore_ascii_case(name))
        })
        .map(|pair| pair[1].as_str().unwrap_or_default().to_owned())
        .collect()
}

// --- send ------------------------------------------------------------------------------------

#[tokio::test]
async fn get_returns_status_headers_body_and_timings() {
    let res = send(request("GET", "/json/user")).await;
    assert_eq!(res.status, 200);
    assert_eq!(res.status_text, "OK");
    assert_eq!(
        header_values(&res, "content-type"),
        ["application/json; charset=utf-8"]
    );
    assert_eq!(json_body(&res)["name"], "Ada Lovelace");
    assert_eq!(res.url, format!("{}/json/user", test_server::url()));
    assert!(res.redirects.is_empty());
    assert_eq!(res.http_version, "HTTP/1.1");
    assert!(!res.headers_restricted);
    assert!(res.warnings.is_empty());
    assert!(res.timings.started_at > 1_600_000_000_000);
    assert!(res.timings.ttfb_ms > 0.0 && res.timings.ttfb_ms <= res.timings.total_ms);
}

#[tokio::test]
async fn non_2xx_statuses_are_responses_not_errors() {
    let res = send(request("GET", "/status/404")).await;
    assert_eq!((res.status, res.status_text.as_str()), (404, "Not Found"));
    let res = send(request("GET", "/status/204")).await;
    assert_eq!(res.status, 204);
    assert!(res.body.is_empty());
}

#[tokio::test]
async fn post_sends_the_body_bytes() {
    let req = with_headers(request("POST", "/echo"), &[("Content-Type", "text/plain")]);
    let echo = json_body(&send_body(req, Some("héllo pigeon")).await);
    assert_eq!(echo["method"], "POST");
    assert_eq!(echo["body"]["text"], "héllo pigeon");
    assert_eq!(echo["body"]["size"], "héllo pigeon".len());
}

#[tokio::test]
async fn get_and_head_can_have_a_body() {
    let echo = json_body(&send_body(request("GET", "/echo"), Some("on a GET")).await);
    assert_eq!(echo["body"]["text"], "on a GET");
}

#[tokio::test]
async fn head_has_headers_and_no_body() {
    let res = send(request("HEAD", "/json/user")).await;
    assert_eq!(res.status, 200);
    assert!(res.body.is_empty());
    assert_eq!(header_values(&res, "content-type").len(), 1);
}

#[tokio::test]
async fn requests_bypass_cors() {
    let res = send(request("GET", "/cors/none")).await;
    assert_eq!(res.status, 200);
    assert_eq!(json_body(&res), json!({ "cors": "none", "method": "GET" }));
    assert!(header_values(&res, "access-control-allow-origin").is_empty());
}

// --- headers ---------------------------------------------------------------------------------

#[tokio::test]
async fn forbidden_browser_headers_reach_the_server_unchanged() {
    let req = with_headers(
        request("GET", "/echo"),
        &[
            ("Host", "api.example.test"),
            ("Cookie", "a=1; b=two"),
            ("Origin", "https://app.example.test"),
            ("Referer", "https://app.example.test/page"),
            ("User-Agent", "Pigeon/test"),
        ],
    );
    let echo = json_body(&send(req).await);
    assert_eq!(echoed(&echo, "host"), ["api.example.test"]);
    assert_eq!(echoed(&echo, "cookie"), ["a=1; b=two"]);
    assert_eq!(echoed(&echo, "origin"), ["https://app.example.test"]);
    assert_eq!(echoed(&echo, "referer"), ["https://app.example.test/page"]);
    assert_eq!(echoed(&echo, "user-agent"), ["Pigeon/test"]);
}

#[tokio::test]
async fn duplicate_request_headers_are_sent_separately_in_order() {
    let req = with_headers(
        request("GET", "/echo"),
        &[("X-Dup", "1"), ("X-Other", "x"), ("X-Dup", "2")],
    );
    let echo = json_body(&send(req).await);
    assert_eq!(echoed(&echo, "x-dup"), ["1", "2"]);
}

#[tokio::test]
async fn utf8_header_values_pass_through() {
    let req = with_headers(request("GET", "/echo"), &[("X-Name", "Zoë")]);
    let echo = json_body(&send(req).await);
    // Node decodes header bytes as latin1; compare the raw UTF-8 bytes.
    let latin1: String = "Zoë".bytes().map(char::from).collect();
    assert_eq!(echoed(&echo, "x-name"), [latin1]);
}

#[tokio::test]
async fn duplicate_response_headers_are_all_visible() {
    let res = send(request("GET", "/cookies/set?a=1&b=2")).await;
    assert_eq!(
        header_values(&res, "set-cookie"),
        ["a=1; Path=/", "b=2; Path=/"]
    );
}

#[tokio::test]
async fn invalid_header_names_are_rejected_before_sending() {
    let failure = fail(with_headers(request("GET", "/echo"), &[("Bad Name", "x")])).await;
    assert_eq!(failure.kind, ErrorKind::InvalidRequest);
    assert!(failure.message.contains("Bad Name"));
}

// --- redirects -------------------------------------------------------------------------------

#[tokio::test]
async fn follows_redirects_and_records_every_hop() {
    let base = test_server::url();
    let res = send(request("GET", "/redirect/3")).await;
    assert_eq!(res.status, 200);
    assert_eq!(res.url, format!("{base}/echo"));
    assert_eq!(
        res.redirects,
        [
            RedirectHop {
                status: 302,
                url: format!("{base}/redirect/3"),
                location: "/redirect/2".into()
            },
            RedirectHop {
                status: 302,
                url: format!("{base}/redirect/2"),
                location: "/redirect/1".into()
            },
            RedirectHop {
                status: 302,
                url: format!("{base}/redirect/1"),
                location: "/echo".into()
            },
        ]
    );
}

#[tokio::test]
async fn redirects_301_302_303_switch_to_get_without_body() {
    for status in [301, 302, 303] {
        let req = with_headers(
            request("POST", &format!("/redirect/1?status={status}")),
            &[("Content-Type", "text/plain")],
        );
        let echo = json_body(&send_body(req, Some("payload")).await);
        assert_eq!(echo["method"], "GET", "{status}");
        assert_eq!(echo["body"]["size"], 0, "{status}");
        assert!(echoed(&echo, "content-type").is_empty(), "{status}");
    }
}

#[tokio::test]
async fn redirects_307_308_keep_method_and_body() {
    for status in [307, 308] {
        let req = request("PUT", &format!("/redirect/1?status={status}"));
        let echo = json_body(&send_body(req, Some("payload")).await);
        assert_eq!(echo["method"], "PUT", "{status}");
        assert_eq!(echo["body"]["text"], "payload", "{status}");
    }
}

#[tokio::test]
async fn head_stays_head_across_a_303() {
    let res = send(request("HEAD", "/redirect/1?status=303")).await;
    assert_eq!(res.status, 200);
    assert_eq!(res.redirects.len(), 1);
}

#[tokio::test]
async fn follow_redirects_off_returns_the_redirect_itself() {
    let mut req = request("GET", "/redirect/1");
    req.settings.follow_redirects = false;
    let res = send(req).await;
    assert_eq!(res.status, 302);
    assert_eq!(header_values(&res, "location"), ["/echo"]);
    assert!(res.redirects.is_empty());
}

#[tokio::test]
async fn too_many_redirects_fail() {
    let mut req = request("GET", "/redirect/5");
    req.settings.max_redirects = 2;
    let failure = fail(req).await;
    assert_eq!(failure.kind, ErrorKind::Network);
    assert!(
        failure.message.contains("Too many redirects"),
        "{}",
        failure.message
    );

    let mut req = request("GET", "/redirect/2");
    req.settings.max_redirects = 2;
    assert_eq!(send(req).await.redirects.len(), 2);
}

#[tokio::test]
async fn credentials_are_dropped_on_cross_origin_redirects_only() {
    let base = test_server::url();
    let other_origin = base.replace("127.0.0.1", "localhost");
    let headers = [
        ("Authorization", "Bearer secret"),
        ("Cookie", "a=1"),
        ("X-Keep", "yes"),
    ];

    let same = format!("/redirect-to?url={base}/echo");
    let echo = json_body(&send(with_headers(request("GET", &same), &headers)).await);
    assert_eq!(echoed(&echo, "authorization"), ["Bearer secret"]);
    assert_eq!(echoed(&echo, "cookie"), ["a=1"]);

    let cross = format!("/redirect-to?url={other_origin}/echo");
    let echo = json_body(&send(with_headers(request("GET", &cross), &headers)).await);
    assert!(echoed(&echo, "authorization").is_empty());
    assert!(echoed(&echo, "cookie").is_empty());
    assert_eq!(echoed(&echo, "x-keep"), ["yes"]);
}

// --- bodies ----------------------------------------------------------------------------------

#[tokio::test]
async fn gzip_bodies_are_decoded_and_sized_decoded() {
    let res = send(request("GET", "/gzip")).await;
    let body = json_body(&res);
    assert_eq!(body["gzipped"], true);
    assert_eq!(body["method"], "GET");
    assert!(res.body.ends_with(b"}\n"));
    // Headers stay as the server sent them; `RawResponse.body` is the decoded size.
    assert_eq!(header_values(&res, "content-encoding"), ["gzip"]);
}

#[tokio::test]
async fn accept_encoding_is_sent_unless_the_request_sets_one() {
    let echo = json_body(&send(request("GET", "/echo")).await);
    assert_eq!(echoed(&echo, "accept-encoding"), [ACCEPT_ENCODING]);
    let echo = json_body(
        &send(with_headers(
            request("GET", "/echo"),
            &[("Accept-Encoding", "identity")],
        ))
        .await,
    );
    assert_eq!(echoed(&echo, "accept-encoding"), ["identity"]);
}

#[test]
fn every_accepted_encoding_decodes_and_chains_undo_in_reverse() {
    use std::io::Write;
    let text = b"{\"hello\": \"pigeon\"}\n".repeat(50);
    let gzip = {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&text).unwrap();
        encoder.finish().unwrap()
    };
    let zlib = {
        let mut encoder =
            flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&text).unwrap();
        encoder.finish().unwrap()
    };
    let raw_deflate = {
        let mut encoder =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&text).unwrap();
        encoder.finish().unwrap()
    };
    let zstd = zstd::encode_all(&text[..], 3).unwrap();
    let br = brotli_compressed(&text);
    let gzip_then_zstd = zstd::encode_all(&gzip[..], 3).unwrap();

    for (codings, input) in [
        (vec!["gzip"], gzip.clone()),
        (vec!["x-gzip"], gzip),
        (vec!["deflate"], zlib),
        (vec!["deflate"], raw_deflate),
        (vec!["br"], br),
        (vec!["zstd"], zstd),
        (vec!["gzip", "zstd"], gzip_then_zstd),
    ] {
        let codings: Vec<String> = codings.into_iter().map(str::to_owned).collect();
        let decoded = decode_body(input, &codings, usize::MAX - 1);
        assert_eq!(decoded.body, text, "{codings:?}");
        assert!(
            decoded.warning.is_none() && !decoded.truncated,
            "{codings:?}"
        );
    }
}

/// Brotli test vector: the decompressor crate has no encoder, so use a stored (uncompressed)
/// meta-block, which every decoder must accept.
fn brotli_compressed(data: &[u8]) -> Vec<u8> {
    assert!(data.len() <= 1 << 16);
    let mlen = data.len() - 1;
    // WBITS=16 (bit 0 = 0), ISLAST=0, MNIBBLES=4 (0b00), MLEN-1 (16 bits), ISUNCOMPRESSED=1.
    let bits: u64 = (mlen as u64) << 4 | 1 << 20;
    let mut out = vec![
        (bits & 0xff) as u8,
        (bits >> 8 & 0xff) as u8,
        (bits >> 16 & 0xff) as u8,
    ];
    out.extend_from_slice(data);
    out.push(0b11); // ISLAST=1, ISLASTEMPTY=1
    out
}

#[test]
fn undecodable_bodies_are_kept_with_a_warning() {
    let decoded = decode_body(b"not gzip".to_vec(), &["gzip".to_owned()], 100);
    assert_eq!(decoded.body, b"not gzip");
    assert!(decoded.warning.unwrap().contains("could not be decoded"));
    let decoded = decode_body(b"abc".to_vec(), &["compress".to_owned()], 100);
    assert_eq!(decoded.body, b"abc");
    assert!(decoded
        .warning
        .unwrap()
        .contains("unsupported Content-Encoding \"compress\""));
}

#[test]
fn decoding_stops_at_the_body_limit() {
    let gzip = {
        use std::io::Write;
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&[7u8; 10_000]).unwrap();
        encoder.finish().unwrap()
    };
    let decoded = decode_body(gzip, &["gzip".to_owned()], 1000);
    assert_eq!(decoded.body, [7u8; 1000]);
    assert!(decoded.truncated);
}

#[tokio::test]
async fn binary_bodies_arrive_byte_for_byte() {
    let res = send(request("GET", "/bytes/1000")).await;
    assert_eq!(
        res.body,
        (0..1000).map(|i| (i % 256) as u8).collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn large_bodies_complete() {
    let res = send(request("GET", "/large/50")).await;
    assert_eq!(res.status, 200);
    assert!(res.body.len() >= 50 * 1024 * 1024);
    assert!(res.warnings.is_empty());
}

#[tokio::test]
async fn bodies_over_the_limit_are_truncated_with_a_warning() {
    let state = HttpState::with_max_body(100);
    let res = state
        .send(request("GET", "/bytes/1000"), Bytes::new())
        .await
        .unwrap();
    assert_eq!(res.body.len(), 100);
    assert_eq!(res.warnings.len(), 1);
    assert!(res.warnings[0].contains("truncated"));
}

// --- timeout & cancellation ------------------------------------------------------------------

// --- bodies (PIGN-009) -----------------------------------------------------------------------

/// `(0..len).map(i % 256)`; SHA-256 of 1024 and 300 bytes below.
fn payload(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i % 256) as u8).collect()
}
const SHA256_1024: &str = "785b0751fc2c53dc14a4ce3d800e69ef9ce1009eb327ccf458afe09c242c26c9";
const SHA256_300: &str = "7728ae2f2c36e2aaafbe79ca14c87ae2f89e7c88c4390ecbbf82dce88706958d";

/// A file in the OS temp dir, removed when dropped.
struct TempFile(std::path::PathBuf);

impl TempFile {
    fn new(name: &str, bytes: &[u8]) -> Self {
        let dir = std::env::temp_dir().join(format!("pigeon-http-{}", next_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        Self(path)
    }

    fn path(&self) -> String {
        self.0.to_string_lossy().into_owned()
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        if let Some(dir) = self.0.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

async fn send_spec(mut req: PreparedRequest, spec: PreparedBody, tail: Vec<u8>) -> RawResponse {
    req.body = Some(spec);
    HttpState::default()
        .send(req, Bytes::from(tail))
        .await
        .expect("request succeeds")
}

fn text_part(name: &str, value: &str) -> MultipartPart {
    MultipartPart::Text {
        name: name.into(),
        value: value.into(),
        content_type: None,
    }
}

fn file_part(name: &str, file: FileRef, filename: &str, content_type: &str) -> MultipartPart {
    MultipartPart::File {
        name: name.into(),
        file,
        filename: filename.into(),
        content_type: Some(content_type.into()),
    }
}

#[tokio::test]
async fn multipart_text_fields_and_a_picked_file_arrive_parsed() {
    let parts = vec![
        text_part("greeting", "héllo wörld"),
        text_part("quote", "say \"hi\"\r\nbye"),
        file_part(
            "upload",
            FileRef::Inline {
                offset: 3,
                length: 1024,
            },
            "pixel.png",
            "image/png",
        ),
    ];
    let mut tail = vec![9, 9, 9];
    tail.extend(payload(1024));
    let res = send_spec(
        request("POST", "/echo"),
        PreparedBody::Multipart { parts },
        tail,
    )
    .await;
    let echo = json_body(&res);
    let content_type = &echoed(&echo, "content-type")[0];
    assert!(
        content_type.starts_with("multipart/form-data; boundary=----PigeonFormBoundary"),
        "{content_type}"
    );
    assert_eq!(
        echo["parsed"],
        json!({ "kind": "multipart", "parts": [
            { "name": "greeting", "kind": "text", "value": "héllo wörld" },
            { "name": "quote", "kind": "text", "value": "say \"hi\"\r\nbye" },
            { "name": "upload", "kind": "file", "filename": "pixel.png", "contentType": "image/png",
              "size": 1024, "sha256": SHA256_1024 },
        ]})
    );
}

#[tokio::test]
async fn multipart_files_are_read_from_disk_by_absolute_path() {
    let file = TempFile::new("report.csv", &payload(300));
    let parts = vec![
        text_part("a", "1"),
        file_part(
            "doc",
            FileRef::Absolute { path: file.path() },
            "report.csv",
            "text/csv",
        ),
    ];
    let echo = json_body(
        &send_spec(
            request("POST", "/echo"),
            PreparedBody::Multipart { parts },
            Vec::new(),
        )
        .await,
    );
    assert_eq!(echo["parsed"]["parts"][1]["filename"], "report.csv");
    assert_eq!(echo["parsed"]["parts"][1]["contentType"], "text/csv");
    assert_eq!(echo["parsed"]["parts"][1]["size"], 300);
    assert_eq!(echo["parsed"]["parts"][1]["sha256"], SHA256_300);
}

#[tokio::test]
async fn a_multipart_content_type_without_boundary_gets_one_and_a_boundary_is_kept() {
    let parts = || vec![text_part("a", "1")];
    let req = with_headers(
        request("POST", "/echo"),
        &[("Content-Type", "multipart/form-data")],
    );
    let echo = json_body(&send_spec(req, PreparedBody::Multipart { parts: parts() }, vec![]).await);
    assert!(echoed(&echo, "content-type")[0].starts_with("multipart/form-data; boundary="));
    assert_eq!(echo["parsed"]["parts"][0]["value"], "1");

    let req = with_headers(
        request("POST", "/echo"),
        &[(
            "Content-Type",
            "multipart/form-data; boundary=\"my-boundary\"",
        )],
    );
    let echo = json_body(&send_spec(req, PreparedBody::Multipart { parts: parts() }, vec![]).await);
    assert_eq!(echo["parsed"]["parts"][0]["value"], "1");
    assert!(echo["body"]["text"]
        .as_str()
        .unwrap()
        .starts_with("--my-boundary\r\n"));
}

#[tokio::test]
async fn multipart_bodies_survive_a_307() {
    let parts = vec![text_part("a", "1")];
    let echo = json_body(
        &send_spec(
            request("POST", "/redirect/1?status=307"),
            PreparedBody::Multipart { parts },
            vec![],
        )
        .await,
    );
    assert_eq!(echo["method"], "POST");
    assert_eq!(echo["parsed"]["parts"][0]["value"], "1");
}

#[tokio::test]
async fn file_bodies_are_read_from_disk_byte_for_byte() {
    let file = TempFile::new("blob.bin", &payload(1024));
    let req = with_headers(
        request("POST", "/echo"),
        &[("Content-Type", "application/octet-stream")],
    );
    let spec = PreparedBody::File {
        file: FileRef::Absolute { path: file.path() },
    };
    let echo = json_body(&send_spec(req, spec, Vec::new()).await);
    assert_eq!(echo["body"]["size"], 1024);
    assert_eq!(echo["body"]["sha256"], SHA256_1024);
    assert_eq!(echoed(&echo, "content-length"), ["1024"]);
}

#[tokio::test]
async fn missing_files_fail_as_file_unavailable() {
    let missing = std::env::temp_dir()
        .join("pigeon-definitely-missing-file.bin")
        .to_string_lossy()
        .into_owned();
    for spec in [
        PreparedBody::File {
            file: FileRef::Absolute {
                path: missing.clone(),
            },
        },
        PreparedBody::Multipart {
            parts: vec![file_part(
                "f",
                FileRef::Absolute {
                    path: missing.clone(),
                },
                "x.bin",
                "application/octet-stream",
            )],
        },
    ] {
        let mut req = request("POST", "/echo");
        req.body = Some(spec);
        let failure = HttpState::default()
            .send(req, Bytes::new())
            .await
            .expect_err("request fails");
        assert_eq!(failure.kind, ErrorKind::FileUnavailable);
        assert!(failure.detail.unwrap().contains(&missing));
    }
}

#[tokio::test]
async fn inline_files_outside_the_body_bytes_are_invalid_requests() {
    let mut req = request("POST", "/echo");
    req.body = Some(PreparedBody::Multipart {
        parts: vec![file_part(
            "f",
            FileRef::Inline {
                offset: 2,
                length: 10,
            },
            "x",
            "text/plain",
        )],
    });
    let failure = HttpState::default()
        .send(req, Bytes::from_static(b"short"))
        .await
        .expect_err("request fails");
    assert_eq!(failure.kind, ErrorKind::InvalidRequest);
}

#[test]
fn multipart_names_are_escaped_like_browsers() {
    let part = MultipartPart::File {
        name: "a\"b".into(),
        file: FileRef::Inline {
            offset: 0,
            length: 0,
        },
        filename: "x\r\n.txt".into(),
        content_type: None,
    };
    let body = encode_multipart(&[(&part, Bytes::from_static(b"hi"))], "B");
    assert_eq!(
        &body[..],
        b"--B\r\nContent-Disposition: form-data; name=\"a%22b\"; filename=\"x%0D%0A.txt\"\r\nContent-Type: application/octet-stream\r\n\r\nhi\r\n--B--\r\n"
    );
}

#[test]
fn boundaries_are_unique_and_read_from_content_types() {
    assert_ne!(new_boundary(), new_boundary());
    assert_eq!(
        boundary_param("multipart/form-data; charset=utf-8; Boundary=\"abc\""),
        Some("abc".to_owned())
    );
    assert_eq!(boundary_param("multipart/form-data"), None);
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain"));
    multipart_boundary(&mut headers);
    assert_eq!(headers[header::CONTENT_TYPE], "text/plain");
}

#[tokio::test]
async fn timeout_fails_with_timeout() {
    let mut req = request("GET", "/delay/3000");
    req.settings.timeout_ms = 200;
    let started = Instant::now();
    let failure = fail(req).await;
    assert_eq!(failure.kind, ErrorKind::Timeout);
    assert!(failure.message.contains("200 ms"));
    assert!(started.elapsed() < Duration::from_millis(2000));
}

#[tokio::test]
async fn zero_timeout_means_no_timeout() {
    let mut req = request("GET", "/delay/300");
    req.settings.timeout_ms = 0;
    assert_eq!(send(req).await.status, 200);
}

#[tokio::test]
async fn cancel_aborts_an_in_flight_request() {
    let state = Arc::new(HttpState::default());
    let req = request("GET", "/delay/5000");
    let id = req.id.clone();
    let started = Instant::now();
    let task = tokio::spawn({
        let state = Arc::clone(&state);
        async move { state.send(req, Bytes::new()).await }
    });
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(state.cancel(&id));
    let failure = task.await.unwrap().expect_err("cancelled");
    assert_eq!(failure.kind, ErrorKind::Aborted);
    assert!(started.elapsed() < Duration::from_millis(2000));
    assert!(state.inflight.lock().unwrap().is_empty());
}

#[tokio::test]
async fn cancel_that_arrives_before_send_still_aborts_it() {
    let state = HttpState::default();
    let req = request("GET", "/json/user");
    assert!(!state.cancel(&req.id));
    let failure = state.send(req, Bytes::new()).await.expect_err("cancelled");
    assert_eq!(failure.kind, ErrorKind::Aborted);
    assert!(state.inflight.lock().unwrap().is_empty());
}

#[tokio::test]
async fn finished_requests_leave_no_abort_handles() {
    let state = HttpState::default();
    state
        .send(request("GET", "/status/200"), Bytes::new())
        .await
        .unwrap();
    state
        .send(request("GET", "http://pigeon-test.invalid/"), Bytes::new())
        .await
        .ok();
    assert!(state.inflight.lock().unwrap().is_empty());
}

// --- errors ----------------------------------------------------------------------------------

#[tokio::test]
async fn connection_refused_is_classified() {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let failure = fail(request("GET", &format!("http://127.0.0.1:{port}/"))).await;
    assert_eq!(failure.kind, ErrorKind::ConnectionRefused);
    assert!(failure.detail.is_some());
}

#[tokio::test]
async fn unresolvable_hosts_are_dns_errors() {
    let failure = fail(request("GET", "http://pigeon-test.invalid/")).await;
    assert_eq!(failure.kind, ErrorKind::Dns, "{failure:?}");
}

#[tokio::test]
async fn invalid_urls_are_rejected() {
    assert_eq!(
        fail(request("GET", "not a url")).await.kind,
        ErrorKind::InvalidUrl
    );
    assert_eq!(
        fail(request("GET", "ftp://example.test/")).await.kind,
        ErrorKind::InvalidUrl
    );
}

// --- clients & IPC frames --------------------------------------------------------------------

#[tokio::test]
async fn one_client_per_project_and_tls_mode() {
    let state = HttpState::default();
    for (project, strict) in [
        (None, true),
        (Some("a"), true),
        (Some("a"), true),
        (Some("b"), true),
        (Some("a"), false),
    ] {
        let mut req = request("GET", "/status/200");
        req.meta.project_id = project.map(str::to_owned);
        req.settings.strict_ssl = strict;
        state.send(req, Bytes::new()).await.unwrap();
    }
    assert_eq!(state.clients.lock().unwrap().len(), 4);
}

#[test]
fn frames_decode_the_typescript_request_shape() {
    let meta = json!({
        "id": "exec-1",
        "method": "POST",
        "url": "http://127.0.0.1/echo",
        "headers": [["X-A", "1"], ["X-A", "2"]],
        "body": { "kind": "bytes" },
        "settings": { "timeoutMs": 0, "followRedirects": false, "maxRedirects": 3, "strictSSL": false },
        "meta": { "projectId": "p1", "protocol": "http", "unresolved": [], "secretValues": [] }
    });
    let json = serde_json::to_vec(&meta).unwrap();
    let mut frame = (json.len() as u32).to_le_bytes().to_vec();
    frame.extend_from_slice(&json);
    frame.extend_from_slice(&[0, 159, 146, 150]);

    let (req, body) = decode_frame(&frame).unwrap();
    assert_eq!(req.id, "exec-1");
    assert_eq!(
        req.headers,
        [
            ("X-A".to_owned(), "1".to_owned()),
            ("X-A".to_owned(), "2".to_owned())
        ]
    );
    assert_eq!(req.body, Some(PreparedBody::Bytes));
    assert_eq!(req.settings.timeout_ms, 0);
    assert!(!req.settings.follow_redirects && !req.settings.strict_ssl);
    assert_eq!(req.meta.project_id.as_deref(), Some("p1"));
    assert_eq!(&body[..], [0, 159, 146, 150]);
}

#[test]
fn frames_decode_multipart_and_file_bodies() {
    let decode = |body: Value| {
        let meta = json!({
            "id": "exec-1",
            "method": "POST",
            "url": "http://127.0.0.1/echo",
            "headers": [],
            "body": body,
            "settings": { "timeoutMs": 0, "followRedirects": true, "maxRedirects": 3, "strictSSL": true },
            "meta": { "protocol": "http", "unresolved": [], "secretValues": [], "warnings": ["x"] }
        });
        let json = serde_json::to_vec(&meta).unwrap();
        let mut frame = (json.len() as u32).to_le_bytes().to_vec();
        frame.extend_from_slice(&json);
        decode_frame(&frame).unwrap().0.body
    };
    assert_eq!(
        decode(json!({ "kind": "file", "ref": { "kind": "absolute", "path": "/tmp/a.bin" } })),
        Some(PreparedBody::File {
            file: FileRef::Absolute {
                path: "/tmp/a.bin".into()
            }
        })
    );
    assert_eq!(
        decode(json!({ "kind": "multipart", "parts": [
            { "name": "t", "kind": "text", "value": "v", "contentType": "text/plain" },
            { "name": "f", "kind": "file", "filename": "a.png", "contentType": "image/png",
              "file": { "kind": "inline", "offset": 0, "length": 4 } },
        ]})),
        Some(PreparedBody::Multipart {
            parts: vec![
                MultipartPart::Text {
                    name: "t".into(),
                    value: "v".into(),
                    content_type: Some("text/plain".into()),
                },
                file_part(
                    "f",
                    FileRef::Inline {
                        offset: 0,
                        length: 4
                    },
                    "a.png",
                    "image/png"
                ),
            ]
        })
    );
}

#[test]
fn malformed_frames_are_invalid_requests() {
    for frame in [
        &[1u8, 0][..],
        &[9, 0, 0, 0, b'{'][..],
        &[1, 0, 0, 0, b'{'][..],
    ] {
        assert_eq!(
            decode_frame(frame).unwrap_err().kind,
            ErrorKind::InvalidRequest
        );
    }
}

#[test]
fn response_frames_carry_camel_case_json_then_raw_body() {
    let response = RawResponse {
        status: 201,
        status_text: "Created".into(),
        headers: vec![
            ("set-cookie".into(), "a=1".into()),
            ("set-cookie".into(), "b=2".into()),
        ],
        body: vec![0, 255, 1],
        url: "http://x/".into(),
        redirects: vec![RedirectHop {
            status: 302,
            url: "http://x/r".into(),
            location: "/".into(),
        }],
        http_version: "HTTP/1.1".into(),
        timings: Timings {
            started_at: 1,
            total_ms: 2.5,
            ttfb_ms: 1.5,
        },
        headers_restricted: false,
        warnings: vec![],
    };
    let frame = encode_frame(&response);
    let len = u32::from_le_bytes(frame[..4].try_into().unwrap()) as usize;
    let meta: Value = serde_json::from_slice(&frame[4..4 + len]).unwrap();
    assert_eq!(
        meta,
        json!({
            "status": 201,
            "statusText": "Created",
            "headers": [["set-cookie", "a=1"], ["set-cookie", "b=2"]],
            "url": "http://x/",
            "redirects": [{ "status": 302, "url": "http://x/r", "location": "/" }],
            "httpVersion": "HTTP/1.1",
            "timings": { "startedAt": 1, "totalMs": 2.5, "ttfbMs": 1.5 },
            "headersRestricted": false,
            "warnings": []
        })
    );
    assert_eq!(&frame[4 + len..], [0, 255, 1]);
}

#[test]
fn failures_serialize_like_transport_errors() {
    let failure =
        TransportFailure::new(ErrorKind::ConnectionRefused, "Refused").with_detail("os error 61");
    assert_eq!(
        serde_json::to_value(&failure).unwrap(),
        json!({ "kind": "connection-refused", "message": "Refused", "detail": "os error 61" })
    );
    assert_eq!(
        serde_json::to_value(TransportFailure::new(ErrorKind::FileUnavailable, "Gone")).unwrap(),
        json!({ "kind": "file-unavailable", "message": "Gone" })
    );
    assert_eq!(
        serde_json::to_value(TransportFailure::aborted()).unwrap(),
        json!({ "kind": "aborted", "message": "The request was cancelled." })
    );
}
