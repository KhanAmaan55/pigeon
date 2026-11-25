//! Read-only Git status of an open project (PIGN-057, docs/platform.md §5.1). Pigeon never
//! commits, pushes, pulls or changes a repository: this module can only run the read-only
//! invocations in `GitQuery`, through the user's installed `git` (none is bundled).
//!
//! - `git rev-parse --show-prefix` from the project root: the project folder's path inside the
//!   repository (and whether there is one).
//! - `git status --porcelain=v2 -z --branch --untracked-files=all -- .`: branch and changed
//!   files under the project folder. `-z` keeps unicode and spaces in paths intact.
//! - `git check-ignore -q -- .` from the project root: whether the project folder is ignored by
//!   Git (itself or a parent, e.g. a project created under a gitignored `dist/`), so its files
//!   would never be committed (PIGN-061). Exit 0: ignored; 1: not ignored.
//!
//! Every call adds `--no-optional-locks` (status never takes the index lock, so it can't get in
//! the way of the user's own Git) and `-c core.fsmonitor=false` (a repository's config can't make
//! Pigeon start an fsmonitor program).

use std::io::ErrorKind;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::State;

use crate::project_fs::ProjectRoots;

/// The only Git invocations Pigeon makes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GitQuery {
    Version,
    ShowPrefix,
    Status,
    CheckIgnore,
}

impl GitQuery {
    pub const ALL: [GitQuery; 4] = [
        GitQuery::Version,
        GitQuery::ShowPrefix,
        GitQuery::Status,
        GitQuery::CheckIgnore,
    ];
}

/// Read-only subcommands; `git_args` never produces anything else (and a test checks it).
pub const ALLOWED_SUBCOMMANDS: &[&str] = &["--version", "rev-parse", "status", "check-ignore"];

impl GitQuery {
    fn args(self) -> &'static [&'static str] {
        match self {
            GitQuery::Version => &["--version"],
            GitQuery::ShowPrefix => &["rev-parse", "--show-prefix"],
            GitQuery::Status => &[
                "status",
                "--porcelain=v2",
                "-z",
                "--branch",
                "--untracked-files=all",
                "--",
                ".",
            ],
            GitQuery::CheckIgnore => &["check-ignore", "-q", "--", "."],
        }
    }
}

/// The full argument list for a query: global safety options, then the query.
pub fn git_args(query: GitQuery) -> Vec<&'static str> {
    let mut args = vec!["--no-optional-locks", "-c", "core.fsmonitor=false"];
    args.extend_from_slice(query.args());
    args
}

/// Whether an argument list is one Pigeon may run (the subcommand after the global options).
pub fn is_allowed(args: &[&str]) -> bool {
    let rest = match args {
        ["--no-optional-locks", "-c", "core.fsmonitor=false", rest @ ..] => rest,
        _ => return false,
    };
    match rest.first() {
        Some(subcommand) => {
            ALLOWED_SUBCOMMANDS.contains(subcommand)
                && GitQuery::ALL.iter().any(|query| query.args() == rest)
        }
        None => false,
    }
}

pub enum GitRun {
    /// `git` is not installed (or not on PATH).
    Missing,
    Exited {
        ok: bool,
        /// The exit code (`None` when killed by a signal).
        code: Option<i32>,
        stdout: Vec<u8>,
    },
}

/// macOS: `/usr/bin/git` is a shim that opens an "install the command line tools" dialog when
/// they are missing. Pigeon treats that as "no git" instead (checked once, without a prompt).
#[cfg(target_os = "macos")]
fn shim_without_tools() -> bool {
    use std::sync::OnceLock;
    static MISSING: OnceLock<bool> = OnceLock::new();
    *MISSING.get_or_init(|| {
        let first = std::env::var_os("PATH").and_then(|path| {
            std::env::split_paths(&path)
                .map(|dir| dir.join("git"))
                .find(|candidate| candidate.is_file())
        });
        match first {
            Some(git) if git == Path::new("/usr/bin/git") => !Command::new("/usr/bin/xcode-select")
                .arg("-p")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success()),
            Some(_) => false,
            None => true,
        }
    })
}

#[cfg(not(target_os = "macos"))]
fn shim_without_tools() -> bool {
    false
}

fn run(query: GitQuery, cwd: &Path) -> Result<GitRun, String> {
    if shim_without_tools() {
        return Ok(GitRun::Missing);
    }
    let args = git_args(query);
    debug_assert!(is_allowed(&args));
    let mut command = Command::new("git");
    command
        .args(&args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        // Never prompt (credentials, pagers) and never read the user's terminal.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    match command.output() {
        Ok(output) => Ok(GitRun::Exited {
            ok: output.status.success(),
            code: output.status.code(),
            stdout: output.stdout,
        }),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(GitRun::Missing),
        Err(error) => Err(format!("Could not run git: {error}")),
    }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    /// Project-relative, `/`-separated.
    pub path: String,
    /// `modified` (changes not staged), `staged` (only staged changes), `untracked`, `conflicted`.
    pub state: &'static str,
    pub deleted: bool,
    /// For renames: the project-relative path before (when it was inside the project).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepository {
    /// `None` when HEAD is detached.
    pub branch: Option<String>,
    pub files: Vec<GitFile>,
    /// The project folder's path inside the repository, `/`-separated and ending in `/` (`""`
    /// at the repository root).
    pub path: String,
    /// The project folder (itself or a parent) is ignored by Git: its files are never committed.
    pub ignored: bool,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// `git` is installed.
    pub available: bool,
    /// The project folder is inside a Git work tree.
    pub repository: Option<GitRepository>,
}

fn state_of(xy: &str) -> (&'static str, bool) {
    let mut chars = xy.chars();
    let index = chars.next().unwrap_or('.');
    let worktree = chars.next().unwrap_or('.');
    let deleted = index == 'D' || worktree == 'D';
    if worktree != '.' {
        ("modified", deleted)
    } else if index != '.' {
        ("staged", deleted)
    } else {
        ("modified", deleted)
    }
}

/// Parses `git status --porcelain=v2 -z --branch` output; `prefix` is the project folder inside
/// the repository (`--show-prefix`, `""` or ending in `/`). Paths outside it are dropped.
pub fn parse_status(output: &[u8], prefix: &str) -> GitRepository {
    let text = String::from_utf8_lossy(output);
    let mut records = text.split('\0').filter(|r| !r.is_empty());
    let relative = |path: &str| path.strip_prefix(prefix).map(str::to_owned);
    let mut branch = None;
    let mut files = Vec::new();
    while let Some(record) = records.next() {
        if let Some(head) = record.strip_prefix("# branch.head ") {
            branch = (head != "(detached)").then(|| head.to_owned());
            continue;
        }
        if record.starts_with('#') {
            continue;
        }
        let kind = record.as_bytes()[0];
        match kind {
            b'1' => {
                // 1 XY sub mH mI mW hH hI path
                let fields: Vec<&str> = record.splitn(9, ' ').collect();
                if let (Some(xy), Some(path)) = (fields.get(1), fields.get(8)) {
                    if let Some(path) = relative(path) {
                        let (state, deleted) = state_of(xy);
                        files.push(GitFile {
                            path,
                            state,
                            deleted,
                            from: None,
                        });
                    }
                }
            }
            b'2' => {
                // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
                let fields: Vec<&str> = record.splitn(10, ' ').collect();
                let original = records.next();
                if let (Some(xy), Some(path)) = (fields.get(1), fields.get(9)) {
                    if let Some(path) = relative(path) {
                        let (state, deleted) = state_of(xy);
                        files.push(GitFile {
                            path,
                            state,
                            deleted,
                            from: original.and_then(relative),
                        });
                    }
                }
            }
            b'u' => {
                // u XY sub m1 m2 m3 mW h1 h2 h3 path
                let fields: Vec<&str> = record.splitn(11, ' ').collect();
                if let Some(path) = fields.get(10).and_then(|p| relative(p)) {
                    files.push(GitFile {
                        path,
                        state: "conflicted",
                        deleted: false,
                        from: None,
                    });
                }
            }
            b'?' => {
                if let Some(path) = record.get(2..).and_then(relative) {
                    files.push(GitFile {
                        path,
                        state: "untracked",
                        deleted: false,
                        from: None,
                    });
                }
            }
            _ => {}
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    GitRepository {
        branch,
        files,
        path: prefix.to_owned(),
        ignored: false,
    }
}

/// The status of the project folder `root` (a granted project root).
pub fn status(root: &Path) -> Result<GitStatus, String> {
    let prefix = match run(GitQuery::ShowPrefix, root)? {
        GitRun::Missing => {
            return Ok(GitStatus {
                available: false,
                repository: None,
            })
        }
        // Not a repository (exit 128), or the folder is inside `.git` / ignored by safe.directory.
        GitRun::Exited { ok: false, .. } => {
            return Ok(GitStatus {
                available: true,
                repository: None,
            })
        }
        GitRun::Exited {
            ok: true, stdout, ..
        } => String::from_utf8_lossy(&stdout).trim().to_owned(),
    };
    match run(GitQuery::Status, root)? {
        GitRun::Exited {
            ok: true, stdout, ..
        } => {
            let mut repository = parse_status(&stdout, &prefix);
            // Exit 0: ignored. 1 (not ignored) or anything else: not reported.
            repository.ignored = matches!(
                run(GitQuery::CheckIgnore, root)?,
                GitRun::Exited { code: Some(0), .. }
            );
            Ok(GitStatus {
                available: true,
                repository: Some(repository),
            })
        }
        GitRun::Missing => Ok(GitStatus {
            available: false,
            repository: None,
        }),
        GitRun::Exited { ok: false, .. } => Ok(GitStatus {
            available: true,
            repository: None,
        }),
    }
}

/// Whether `git` is installed (`git --version` runs); used by tests.
#[cfg(test)]
pub fn installed() -> bool {
    matches!(
        run(GitQuery::Version, &std::env::temp_dir()),
        Ok(GitRun::Exited { ok: true, .. })
    )
}

#[tauri::command]
pub async fn git_status(roots: State<'_, ProjectRoots>, root: String) -> Result<GitStatus, String> {
    let root = roots.check(&root).map_err(|error| error.message)?;
    tokio::task::spawn_blocking(move || status(&root))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_read_only_queries_can_be_built_or_allowed() {
        for query in GitQuery::ALL {
            assert!(is_allowed(&git_args(query)), "{query:?}");
        }
        assert_eq!(
            git_args(GitQuery::CheckIgnore),
            [
                "--no-optional-locks",
                "-c",
                "core.fsmonitor=false",
                "check-ignore",
                "-q",
                "--",
                "."
            ]
        );
        let mut with_safety = vec!["--no-optional-locks", "-c", "core.fsmonitor=false"];
        for forbidden in [
            vec!["commit", "-m", "x"],
            vec!["push"],
            vec!["pull"],
            vec!["fetch"],
            vec!["checkout", "."],
            vec!["reset", "--hard"],
            vec!["config", "user.name", "x"],
            vec![
                "status",
                "--porcelain=v2",
                "-z",
                "--branch",
                "--untracked-files=all",
                "--",
                "..",
                "&&",
                "rm",
            ],
            vec!["rev-parse", "--show-toplevel"],
            // check-ignore only for the project folder, quietly, and never reading stdin.
            vec!["check-ignore", "-q", "--", ".."],
            vec!["check-ignore", "-q", "--", ".", "/etc/passwd"],
            vec!["check-ignore", "--stdin"],
            vec!["check-ignore", "-v", "--", "."],
            vec!["check-ignore", "-q", "--no-index", "--", "."],
            vec!["-c", "core.hooksPath=/tmp", "status"],
            vec![],
        ] {
            with_safety.truncate(3);
            with_safety.extend(forbidden.iter().copied());
            assert!(!is_allowed(&with_safety), "{with_safety:?}");
        }
        // The safety options are required.
        assert!(!is_allowed(GitQuery::Status.args()));
        assert!(!is_allowed(&["status"]));
        for query in GitQuery::ALL {
            assert!(ALLOWED_SUBCOMMANDS.contains(&query.args()[0]));
        }
    }

    #[test]
    fn parses_porcelain_v2_with_unicode_spaces_renames_and_conflicts() {
        let output = [
            "# branch.oid 1234",
            "# branch.head feature/ünï code",
            "1 .M N... 100644 100644 100644 aaaa bbbb api/collections/users/get user.request.json",
            "1 A. N... 000000 100644 100644 0000 cccc api/environments/dev.env.json",
            "1 D. N... 100644 000000 000000 dddd 0000 api/collections/users/old.request.json",
            "2 R. N... 100644 100644 100644 eeee eeee R100 api/collections/users/renamed.request.json",
            "api/collections/users/before.request.json",
            "u UU N... 100644 100644 100644 100644 a b c api/pigeon.json",
            "? api/collections/users/new ✓.request.json",
            "? other/outside.json",
            "",
        ]
        .join("\0");
        let repo = parse_status(output.as_bytes(), "api/");
        assert_eq!(repo.branch.as_deref(), Some("feature/ünï code"));
        let summary: Vec<(&str, &str, bool)> = repo
            .files
            .iter()
            .map(|f| (f.path.as_str(), f.state, f.deleted))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("collections/users/get user.request.json", "modified", false),
                ("collections/users/new ✓.request.json", "untracked", false),
                ("collections/users/old.request.json", "staged", true),
                ("collections/users/renamed.request.json", "staged", false),
                ("environments/dev.env.json", "staged", false),
                ("pigeon.json", "conflicted", false),
            ]
        );
        assert_eq!(
            repo.files[3].from.as_deref(),
            Some("collections/users/before.request.json")
        );
        assert_eq!(parse_status(b"# branch.head (detached)\0", "").branch, None);
    }

    /// A real repository through the installed `git` (skipped when there is none).
    #[test]
    fn status_of_a_temporary_repository() {
        if !installed() {
            eprintln!("git not installed: skipped");
            return;
        }
        let dir = std::env::temp_dir().join(format!("pigeon-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let project = dir.join("api project");
        std::fs::create_dir_all(project.join("collections")).unwrap();
        // Not a repository yet.
        assert_eq!(
            status(&project).unwrap(),
            GitStatus {
                available: true,
                repository: None
            }
        );
        let git = |args: &[&str]| {
            let ok = Command::new("git")
                .args(args)
                .current_dir(&dir)
                .env("GIT_AUTHOR_NAME", "Test")
                .env("GIT_AUTHOR_EMAIL", "test@example.invalid")
                .env("GIT_COMMITTER_NAME", "Test")
                .env("GIT_COMMITTER_EMAIL", "test@example.invalid")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success();
            assert!(ok, "git {args:?}");
        };
        git(&["init", "-q", "-b", "main"]);
        std::fs::write(project.join("pigeon.json"), "{}").unwrap();
        std::fs::write(dir.join("README.md"), "outside").unwrap();
        git(&["add", "."]);
        git(&["commit", "-q", "-m", "init"]);
        let clean = status(&project).unwrap().repository.unwrap();
        assert_eq!(clean.branch.as_deref(), Some("main"));
        assert!(clean.files.is_empty());
        assert_eq!(clean.path, "api project/");
        assert!(!clean.ignored);

        std::fs::write(project.join("pigeon.json"), "{\"x\":1}").unwrap();
        std::fs::write(project.join("collections").join("ü é.json"), "{}").unwrap();
        std::fs::write(dir.join("README.md"), "changed outside the project").unwrap();
        let changed = status(&project).unwrap().repository.unwrap();
        let paths: Vec<(&str, &str)> = changed
            .files
            .iter()
            .map(|f| (f.path.as_str(), f.state))
            .collect();
        assert_eq!(
            paths,
            vec![
                ("collections/ü é.json", "untracked"),
                ("pigeon.json", "modified")
            ]
        );
        // Committing outside Pigeon clears it.
        git(&["add", "-A"]);
        git(&["commit", "-q", "-m", "more"]);
        assert!(status(&project)
            .unwrap()
            .repository
            .unwrap()
            .files
            .is_empty());

        // A project created under a gitignored folder (PIGN-061): ignored, itself or via a parent.
        std::fs::write(dir.join(".gitignore"), "/dist\nscratch/\n").unwrap();
        let in_dist = dir.join("dist").join("Pigeon");
        std::fs::create_dir_all(&in_dist).unwrap();
        std::fs::write(in_dist.join("pigeon.json"), "{}").unwrap();
        let ignored = status(&in_dist).unwrap().repository.unwrap();
        assert!(ignored.ignored);
        assert_eq!(ignored.path, "dist/Pigeon/");
        // Its files never show as changed: Git doesn't see them.
        assert!(ignored.files.is_empty());
        let scratch = dir.join("scratch");
        std::fs::create_dir_all(&scratch).unwrap();
        assert!(status(&scratch).unwrap().repository.unwrap().ignored);
        assert!(!status(&project).unwrap().repository.unwrap().ignored);
        assert!(!status(&dir).unwrap().repository.unwrap().ignored);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
