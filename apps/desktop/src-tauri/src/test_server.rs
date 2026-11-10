//! `@pigeon/test-server` for `cargo test`. Uses `PIGEON_TEST_SERVER_URL` when set (e.g. a server
//! started by a CI step); otherwise starts one with Node on a free port, once per test binary.
//! The child exits when this process does: it stops when its stdin pipe closes.

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

const READY: &str = "Pigeon test server listening on ";

/// Base URL without a trailing slash, e.g. `http://127.0.0.1:51234`.
pub fn url() -> &'static str {
    static URL: OnceLock<String> = OnceLock::new();
    URL.get_or_init(|| {
        std::env::var("PIGEON_TEST_SERVER_URL")
            .map(|url| url.trim_end_matches('/').to_owned())
            .unwrap_or_else(|_| spawn())
    })
}

fn spawn() -> String {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let mut child = Command::new("node")
        .args([
            "--experimental-strip-types",
            "--no-warnings",
            "packages/test-server/src/cli.ts",
        ])
        .current_dir(&root)
        .env("PIGEON_TEST_SERVER_PORT", "0")
        .env("PIGEON_TEST_SERVER_EXIT_ON_STDIN_END", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("could not start the test server: install Node and run `pnpm install`");

    let mut line = String::new();
    BufReader::new(child.stdout.take().expect("piped stdout"))
        .read_line(&mut line)
        .expect("test server stdout");
    let url = line
        .trim()
        .strip_prefix(READY)
        .unwrap_or_else(|| panic!("unexpected test server output: {line:?}"))
        .to_owned();

    // Keep the stdin pipe open for the life of the test binary; the OS closes it on exit.
    std::mem::forget(child);
    url
}
