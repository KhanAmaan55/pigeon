//! `@pigeon/test-server` for `cargo test`. Uses `PIGEON_TEST_SERVER_URL` (and
//! `PIGEON_TEST_SERVER_HTTPS_URL` for [`https_url`]) when set, e.g. a server started by a CI step;
//! otherwise starts one with Node on free ports, once per test binary, serving both HTTP and the
//! self-signed HTTPS endpoint. The child exits when this process does: it stops when its stdin
//! pipe closes.

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

const READY: &str = "Pigeon test server listening on ";

struct Spawned {
    http: String,
    https: String,
}

/// Base URL without a trailing slash, e.g. `http://127.0.0.1:51234`.
pub fn url() -> &'static str {
    static URL: OnceLock<String> = OnceLock::new();
    URL.get_or_init(|| from_env("PIGEON_TEST_SERVER_URL").unwrap_or_else(|| spawned().http.clone()))
}

/// Base URL of the HTTPS server with the untrusted self-signed certificate, e.g.
/// `https://127.0.0.1:51235`.
pub fn https_url() -> &'static str {
    static URL: OnceLock<String> = OnceLock::new();
    URL.get_or_init(|| {
        from_env("PIGEON_TEST_SERVER_HTTPS_URL").unwrap_or_else(|| spawned().https.clone())
    })
}

fn from_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|url| url.trim_end_matches('/').to_owned())
}

fn spawned() -> &'static Spawned {
    static SPAWNED: OnceLock<Spawned> = OnceLock::new();
    SPAWNED.get_or_init(spawn)
}

fn spawn() -> Spawned {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let mut child = Command::new("node")
        .args([
            "--experimental-strip-types",
            "--no-warnings",
            "packages/test-server/src/cli.ts",
        ])
        .current_dir(&root)
        .env("PIGEON_TEST_SERVER_PORT", "0")
        .env("PIGEON_TEST_SERVER_HTTPS_PORT", "0")
        .env("PIGEON_TEST_SERVER_EXIT_ON_STDIN_END", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("could not start the test server: install Node and run `pnpm install`");

    let mut stdout = BufReader::new(child.stdout.take().expect("piped stdout"));
    let mut next_url = || {
        let mut line = String::new();
        stdout.read_line(&mut line).expect("test server stdout");
        line.trim()
            .strip_prefix(READY)
            .unwrap_or_else(|| panic!("unexpected test server output: {line:?}"))
            .to_owned()
    };
    let http = next_url();
    let https = next_url();

    // Keep the stdin pipe open for the life of the test binary; the OS closes it on exit.
    std::mem::forget(child);
    Spawned { http, https }
}
