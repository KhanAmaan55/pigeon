# PIGN-040 — Cross-OS filesystem conformance

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-040 | 8 — Hardening | MVP | Todo | PIGN-020 |

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
- [ ] Cross-OS suite green on macOS, Windows, Linux CI runners.
- [ ] Git scenario tests (testing.md §3.6) green on all three OSes, including `core.autocrlf=true` on Windows with the project `.gitattributes`.
- [ ] Desktop E2E (Windows, Linux) open → edit → Save for Commit → external change → reload passes.
- [ ] No known phantom diffs: re-opening and committing without edits produces zero writes on every OS.

## Technical notes
- Use a temp dir per test (`os.tmpdir()`), clean up even on failure.
- Case-insensitive rename: `a → a.tmp-<id> → A`.

## Files / components likely affected
`packages/platform-node/src/**`, `packages/platform/src/conformance/*`, `packages/core/test/cross-os/**`, `packages/formats/src/*`, `packages/platform-desktop/src/tauri-fs.ts`, CI.

## Tests required
As listed above; all in CI matrix.

## Definition of done
Standard DoD plus green CI on all three OSes.
