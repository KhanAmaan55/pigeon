//! `--smoke`: start the app, wait until the UI shell has rendered with its bundled assets,
//! print `smoke-ok` to stdout and exit 0. Any failure exits non-zero. CI runs this on every OS.

use std::io::Write;
use std::time::Duration;
use std::{process, thread};

use tauri::{plugin, Builder, Wry};

const FLAG: &str = "--smoke";
const OK: &str = "smoke-ok";
const TIMEOUT: Duration = Duration::from_secs(60);

/// Runs before the page's own scripts on every load: records errors, then reports once the
/// shell has rendered.
const PROBE: &str = include_str!("smoke.js");

pub fn requested(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().skip(1).any(|arg| arg == FLAG)
}

pub fn install(builder: Builder<Wry>) -> Builder<Wry> {
    builder
        .plugin(
            plugin::Builder::<Wry>::new("smoke")
                .js_init_script(PROBE.to_string())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![smoke_report])
        .setup(|_| {
            thread::spawn(|| {
                thread::sleep(TIMEOUT);
                finish(Err(format!("timed out after {}s", TIMEOUT.as_secs())));
            });
            Ok(())
        })
}

#[tauri::command]
fn smoke_report(error: Option<String>) {
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
}
