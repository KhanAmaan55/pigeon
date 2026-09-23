# PIGN-020 — External file changes & conflicts

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-020 | 2 — Projects | MVP | Todo | PIGN-019 |

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
- [ ] Desktop: modifying a request file in another editor updates the open tab within 1 s (no draft) .
- [ ] Our own Save for Commit does not trigger a reload loop or a conflict.
- [ ] Draft + external change → conflict badge + banner; each resolution works; commit blocked until resolved.
- [ ] Writing Git merge conflict markers into a file marks it broken, read-only, and never overwritten.
- [ ] `git checkout` of a branch with a different tree (Git scenario test) → working model equals the new files (plus non-conflicting drafts).
- [ ] Web (Chromium fs-access): external change is detected on focus/refresh.

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
