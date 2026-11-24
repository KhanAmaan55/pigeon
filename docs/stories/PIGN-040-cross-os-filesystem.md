# PIGN-040 — Cross-OS filesystem conformance

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-040 | 8 — Hardening | MVP | Done | PIGN-020 |

## Goal
Prove the project format and Save for Commit behave identically on macOS, Windows, and Linux filesystems, and fix edge cases (line endings, case, reserved names, long paths, unicode normalization, locked/read-only files).

## User story
As a team with mixed operating systems, I want Pigeon files to behave the same for everyone, so Git never shows phantom changes.

## Context
- Per-OS notes: [platform.md §5.2–5.4](../platform.md#52-macos).
- Naming & serialization: [file-format.md §3–4, §10](../file-format.md#4-naming-rules).
- Cross-OS test list: [testing.md §3.6](../testing.md#36-filesystem--git-workflows).

## Scope
**In scope**
- `platform-node`: complete `NodeFs` (incl. watch via `fs.watch`/chokidar-lite polling fallback) and `NodeTransport` (undici, manual redirects) — reference implementations; `transportConformance(NodeTransport)`.
- Cross-OS integration suite (runs in CI matrix on all three OSes via NodeFs, which exercises the same OS semantics TauriFs hits):
  - CRLF files load; unchanged entities are not rewritten; changed ones are written LF.
  - Case-only rename (`Users` → `users` folder name change producing same slug → no-op; different slug → proper rename on case-insensitive FS via temp name).
  - Reserved names and trailing dot/space names never produced.
  - Long paths: warning when project root + managed path > 240 chars (Windows); operation still attempted.
  - NFD filenames created on macOS (e.g. unmanaged files) don't break scanning; Pigeon slugs are ASCII so no NFC/NFD churn.
  - Read-only file → commit reports a clear error, other files still written, drafts kept.
  - Windows locked file → retry 3× with backoff, then error.
  - Symlinked project root works; symlinks inside managed dirs are not followed for deletes.
- Fixes in `formats`/`core`/`platform-desktop` for anything the suite finds.
- Rust side: confirm plugin-fs rename-over-existing semantics on Windows (test in `cargo test` or desktop E2E).

**Out of scope**
- Network filesystems, cloud-synced folders (document as "best effort").

## Acceptance criteria
- [x] Cross-OS suite green on macOS, Windows, Linux CI runners. — green in the CI verify matrix on all three (2026-11-24)
- [x] Git scenario tests (testing.md §3.6) green on all three OSes, including `core.autocrlf=true` on Windows with the project `.gitattributes`. — green in the CI verify matrix on all three, autocrlf case included (2026-11-24)
- [x] Desktop E2E (Windows, Linux) open → edit → Save for Commit → external change → reload passes. — in the `--smoke` run; passes in CI's desktop-build job on macOS, Windows and Linux (2026-11-24)
- [x] No known phantom diffs: re-opening and committing without edits produces zero writes on every OS.

## Technical notes
- Use a temp dir per test (`os.tmpdir()`), clean up even on failure.
- Case-insensitive rename: `a → a.tmp-<id> → A`.

## Files / components likely affected
`packages/platform-node/src/**`, `packages/platform/src/conformance/*`, `packages/core/test/cross-os/**`, `packages/formats/src/*`, `packages/platform-desktop/src/tauri-fs.ts`, CI.

## Tests required
As listed above; all in CI matrix.

## Definition of done
Standard DoD plus green CI on all three OSes.

## Implementation notes
- **platform-node**: `NodeTransport` (node:http/https, no new dependency instead of undici): raw header list (order, case, duplicates, `Host`/`Cookie` as given), manual redirects recording every hop (303 → GET; 301/302 POST → GET; 307/308 keep the body; credentials and an explicit Host dropped on cross-origin hops), gzip/deflate/br decoding, `strictSSL`, one deadline for the whole exchange, aborts with `signal.reason`, picked/project/absolute file refs, `NODE_CAPABILITIES`. Passes every `transportConformance` case against `@pigeon/test-server` plus TLS (self-signed HTTPS server) and file-ref tests. `NodeFs` gained `watch` (recursive `fs.watch`, 50 ms batches, temp files filtered), `withRetry` (EBUSY/EPERM/EACCES, 3 retries at 50/100/150 ms) on renames/unlinks/rm, and symlink rules (symlinked files listed, symlinked directories left out, removing a link never touches its target).
- **Cross-OS suite** (`packages/core/test/cross-os.test.ts`, NodeFs on real temp folders, so the verify matrix runs it with each OS's semantics): reopen + Save for Commit → zero writes; CRLF files load, stay untouched, and a changed one is written LF; same-slug rename moves nothing; case-only directory rename; reserved names / trailing dots and spaces; long-path warning; NFD names; symlinked root; read-only file (POSIX; skipped on Windows and as root); a `core.autocrlf=true` clone has LF files, no phantom changes and a one-line diff after an edit.
- **Fixes the suite found**:
  - CRLF churn: a container file (e.g. `collection.json`) with CRLF endings was rewritten whenever a child changed. Files are now compared by `contentHash` (formats; CRLF → LF except `*.bin` example bodies) in the reader, disk scan, planner and own-write tracking.
  - **Data loss on case-insensitive disks**: renaming an entity whose directory differs only in case (`Admin/` → `admin`) wrote the new files and then deleted them through the old path. The commit now renames the differing segment through a temporary name and drops those deletes.
  - Save for Commit stopped at the first failing file and then kept every draft, which turned the already written entities into conflicts. It now goes on with the other files, clears the drafts of entities whose files all landed, keeps the rest, and the `CommitError` lists each failed path with a readable reason (`describeFsFailure`: permission denied/read-only, locked, read-only file system, disk full) and `failed` paths.
  - Long paths: one warning in the plan when a written path with the project folder exceeds 240 characters (`LONG_PATH_LIMIT`), naming the longest; the write is still attempted.
  - Desktop watcher: events for a project reached through a symlink (macOS reports `/private/var/…` for `/var/…`) were dropped, so external changes were never seen there. It now also matches the canonical root (found by the new smoke flow).
- **Rust**: `with_retry` (permission denied / sharing violations 32, 33) now also covers removes; symlinked directories are left out of listings and removing a link removes only the link; cargo tests for rename-over-existing (runs on Windows in CI), retries, symlinks and a watcher on a symlinked root.
- **Desktop flow**: no WebDriver-based desktop E2E exists, so the `--smoke` run (all three OSes in CI's desktop-build job) now seeds a granted recent project, opens it, edits a request, Saves for Commit (checks the file is LF with the new URL through IPC), writes an external change through IPC and waits for the explorer to show it.
- **Not verified here**: the Windows and Linux runs (unit suite, Git test, smoke) need CI; only macOS was run locally (1214 unit tests, cargo 82, smoke-ok, E2E 273 — two Firefox "Target crashed" page creations under load passed on rerun). Windows-specific branches (read-only attribute, locked files) are covered by retry unit tests rather than real locks.
