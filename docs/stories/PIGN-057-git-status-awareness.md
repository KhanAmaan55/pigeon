# PIGN-057 — Read-only Git status awareness (desktop)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-057 | 9 — Later | Later | Done | PIGN-041 |

## Goal
On desktop, show which Pigeon project files are modified/untracked relative to Git `HEAD`, and the current branch — read-only. Pigeon still never commits, pushes, or pulls.

## User story
As a developer, I want to see which requests I've changed since my last commit, so I know what my next Git commit will contain.

## Context
- Git is out of scope for writing: [product.md §4](../product.md#4-non-goals). Web cannot access Git: [platform.md §6.6](../platform.md#66-git--local-repository-access).

## Scope
**In scope**
- Detect a Git repository containing the project folder (walk up to find `.git`), via the user's installed `git` binary (`git status --porcelain=v2 -z -- <project paths>`, `git rev-parse --abbrev-ref HEAD`) through a Rust command with a strict allowlist of read-only subcommands; no bundled Git.
- Explorer decoration: Git state (modified/untracked/staged) per entity file — distinct from Pigeon's draft badges (`M` local draft vs Git dot).
- Status bar: branch name, count of changed Pigeon files; refresh on file watcher events and window focus.
- "Open in Git client" / "Reveal in terminal" helpers (optional).
- Capability `gitStatus: boolean` (false on web; false when `git` isn't installed).

**Out of scope**
- Any Git write operation, diffs from history, blame.

## Acceptance criteria
- [x] After Save for Commit, changed files show as Git-modified; after the user commits externally, decorations clear on refresh.
- [x] No Git subcommand other than the allowlisted read-only ones can be invoked (Rust test).
- [x] Missing `git` → feature hidden, no errors.
- [ ] Works on macOS, Windows, Linux. *Verified on macOS; the Rust temp-repository test runs on all three in CI once pushed (it skips when `git` is missing), and the Windows-only no-console flag compiles only there.*

## Technical notes
- Use `-z` output parsing to handle unicode/space paths safely.

## Files / components likely affected
`apps/desktop/src-tauri/src/git.rs`, `packages/platform-desktop/src/git.ts`, `packages/platform/src/capabilities.ts`, `packages/ui/src/features/explorer/*`, status bar, `docs/platform.md`.

## Tests required
`cargo test` (allowlist), integration with a temp Git repo (Node), desktop E2E on Linux/Windows.

## Definition of done
Standard DoD.

## Implementation notes

- **Rust** (`src-tauri/src/git.rs`): command `git_status(root)` for granted project roots only (`ProjectRoots::check`). `GitQuery` is a closed enum — `--version`, `rev-parse --show-prefix`, `status --porcelain=v2 -z --branch --untracked-files=all -- .` — and `git_args` / `is_allowed` are the only way to build arguments; every call adds `--no-optional-locks` and `-c core.fsmonitor=false` (a repository's config can't make Pigeon start a program), sets `GIT_TERMINAL_PROMPT=0`, clears `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`, and hides the console window on Windows. The branch comes from the porcelain `# branch.head` header rather than a separate `rev-parse --abbrev-ref HEAD`. `-z` records are parsed for ordinary, renamed, unmerged and untracked entries; paths are made project-relative with `--show-prefix`. On macOS, `/usr/bin/git` without the command line tools would open an install dialog, so that case counts as "no git".
- **Platform**: capability `gitStatus` (desktop `true`; web, Node, memory `false`), `Platform.git?: GitStatusReader`, types in `platform/src/git.ts` plus `MemoryGitStatus` for tests; `DesktopGitStatus` in platform-desktop. Whether `git` is installed is only known from the status (`available: false`), not from the capability: the UI hides everything then.
- **UI** (`features/git/git-status.tsx`): a per-session store (one read at a time, coalesced), refreshed on project open, window focus and 400 ms after session changes (Save for Commit writes and reloads from the watcher both emit). Explorer `GitDot` (square, coloured per state, separate from the draft letters; a request counts its example files) and status bar `GitStatusItem` (branch, "N changed", click to refresh).
- **Tests**: cargo — the allowlist (write subcommands, extra arguments and missing safety options are refused), porcelain parsing (unicode, spaces, renames, conflicts, detached HEAD), and a temporary repository through the installed `git` (not a repo → changes inside and outside the project → commit clears). TS — the desktop adapter, and UI tests for decorations, refresh on focus after an external commit, and hidden states. The desktop smoke test checks `git_status` on its (non-repository) project and that an ungranted folder is refused.
- Not done: the optional "Open in Git client" / "Reveal in terminal" helpers.
