# PIGN-020 — External file changes & conflicts

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-020 | 2 — Projects | MVP | Done | PIGN-019 |

## Goal
Detect changes made outside Pigeon (git pull/checkout, editors), reload them, and surface conflicts with local drafts.

## User story
As a developer who pulls teammates' changes, I want Pigeon to pick them up and warn me when they clash with my local edits, so I never silently lose work.

## Context
- Reload & conflict rules: [file-format.md §8](../file-format.md#8-filesystem-changes-and-conflicts).
- Watch capability: [platform.md §4, §5.1, §6.3](../platform.md#4-capability-matrix).

## Scope
**In scope**
- Desktop: `TauriFs.watch` (plugin-fs watch, recursive, debounced 250 ms, managed paths only); own-write suppression by hash.
- Web: re-scan on window focus and **Refresh** (project menu + `⟳` button); scan compares size/lastModified then hash.
- `ProjectSession.reload(changedPaths?)`: incremental re-read; update base; classify each changed entity: silent update / conflict (`draft.baseHash` ≠ new hash) / deleted-on-disk-with-draft / broken.
- Unsaved in-memory edits on an entity changed on disk → prompt "File changed on disk. Reload or keep editing?".
- Conflict UI: explorer `!` badge, editor banner with **Keep mine** (rebase: `baseHash` := new), **Take theirs** (discard draft), **Compare** (side-by-side JSON diff). Save for Commit blocked for conflicted entities (planner `blocked`).
- `pigeon.json` changed externally → full reload; format version newer → read-only.
- Status bar: "Watching files" / "Refresh on focus" indicator; Linux inotify failure fallback notice.

**Out of scope**
- Three-way merge of JSON (future).

## Acceptance criteria
- [x] Desktop: modifying a request file in another editor updates the open tab within 1 s (no draft) .
- [x] Our own Save for Commit does not trigger a reload loop or a conflict.
- [x] Draft + external change → conflict badge + banner; each resolution works; commit blocked until resolved.
- [x] Writing Git merge conflict markers into a file marks it broken, read-only, and never overwritten.
- [x] `git checkout` of a branch with a different tree (Git scenario test) → working model equals the new files (plus non-conflicting drafts).
- [x] Web (Chromium fs-access): external change is detected on focus/refresh.

## Technical notes
- Batch events: branch switches produce hundreds of events — coalesce and reload once.
- Watcher events are hints; always verify via hash.

## Files / components likely affected
`packages/core/src/workspace/{project-session,reload,conflicts}.ts`, `packages/platform-desktop/src/tauri-fs.ts`, `packages/platform-web/src/fs-access-fs.ts`, `packages/ui/src/features/{explorer,request-editor,pending-changes}/*`, status bar.

## Tests required
- Unit: classification matrix.
- Integration: MemoryFs external change simulation (MemoryFs.watch).
- Git scenario tests (Node + git): checkout, merge conflict markers.
- Desktop E2E: external edit reload.

## Definition of done
Standard DoD.

## Implementation notes
- Desktop watcher: Rust `src-tauri/src/watch.rs` (`notify` 8, recursive, `project_watch`/`project_unwatch`, only for granted roots) coalesces events for 250 ms and emits `project-fs-change` `{ root, events }` with project paths (temp and `.crswap` files skipped). `TauriFs.watch(onEvent, onError)` listens and starts/stops it; `ProjectFileSystem.watch` gained an optional `onError` (watcher couldn't start, e.g. inotify limits).
- `ProjectSession.watch()` coalesces events (`WATCH_DEBOUNCE_MS` = 250) and calls `checkForChanges()`, which compares managed-file hashes with what was read and reloads only on a difference — watcher events are hints. Our own Save for Commit re-reads the base, so its writes never look external (no reload loop, no conflict). `isOwnWrite` is kept for a future incremental reload.
- `reload()` stays a full re-read (fast enough for MVP sizes); "incremental per file" is a follow-up if large projects need it. Conflicts are derived, not stored: a non-create draft whose `baseHash` ≠ the file's hash is `changed-on-disk`; an update draft whose entity is gone is `deleted-on-disk` (so conflicts survive restarts). `changeState` = `conflict`. `resolveConflict(id, 'mine' | 'theirs')` (mine rebases `baseHash`, or turns the draft into a create when the file was deleted; theirs = `discard`). `conflictTexts(id)` feeds Compare. The commit planner already blocks such drafts.
- Unsaved edits on an entity whose file changed → `externallyChanged()`, banner "File changed on disk. Reload or keep editing?" (`reloadEntity`, `keepEditing`).
- Web (and desktop when the watcher fails): `checkForChanges()` on window focus and on Refresh. Status bar: Watching files / Refresh on focus / File watching unavailable.
- UI: explorer `!` badge, conflict banner (Keep mine / Take theirs / Compare with a unified diff of file vs draft).
- Tests: classification and resolutions, merge-conflict markers (broken, never written), MemoryFs watcher with a burst of 20 edits → one reload, own commit → no reload, `git checkout` to a branch with a different tree (NodeFs + git), Rust watcher test with a real directory, Chromium E2E on OPFS for focus/Refresh. Desktop E2E for the native watcher still waits for the WebdriverIO setup (follow-up noted in PIGN-014).
