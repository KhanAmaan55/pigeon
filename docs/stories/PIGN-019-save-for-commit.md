# PIGN-019 — Save for Commit & Pending Changes

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-019 | 2 — Projects | MVP | Done | PIGN-018 |

## Goal
Implement **Save for Commit**: materialize drafts into project files deterministically, with a Pending Changes panel that shows the file plan and diffs before writing.

## User story
As a developer, I want to choose which local changes become file changes and review the diff, so my Git commits contain exactly what I intend.

## Context
- Commit planning algorithm: [file-format.md §5.1](../file-format.md#51-commit-planning).
- Pending Changes UX: [ui-ux.md §3.8](../ui-ux.md#38-save-vs-save-for-commit).

## Scope
**In scope**
- `core/workspace/commit-planner.ts`: `planCommit(base, drafts, selection, diskState) → CommitPlan { writes, deletes, rmdirs, renames (display), blocked: Conflict[] , prerequisites }`, following file-format §5.1 incl. structural prerequisites for partial commits and "never overwrite broken files".
- `ProjectSession.commit(plan)`: writes via `writeFileAtomic`, deletes, removes empty dirs; updates base + hashes; clears committed drafts; records own-write hashes (for PIGN-020).
- Save for Commit from editor (`Cmd/Ctrl+Shift+S`) commits the active entity (+ prerequisites) directly and shows toast "Wrote N files" (+ Reveal on desktop).
- **Pending Changes** panel (activity bar, badge count): drafts grouped by type with A/M/D/R; selection checkboxes; file plan list; per-file unified diff (CodeMirror merge view, current file vs to-be-written); **Save selected for commit**, **Save all for commit**, **Discard**.
- Empty state text: "Everything is written to files. Use Git to commit."
- Create `packages/platform-node` with a minimal `NodeFs` (node:fs/promises, passes `fsConformance`) for Git scenario tests; PIGN-040 extends it.

**Out of scope**
- Conflict resolution UI (PIGN-020), Git operations.

## Acceptance criteria
- [x] Editing one header on one request and committing changes exactly one file with a minimal diff (golden test).
- [x] Save for Commit with no drafts writes zero files.
- [x] Renaming a request produces a delete + write displayed as `R old → new`; examples dirs are not touched yet (added in PIGN-027).
- [x] Committing a request inside a new folder also writes the folder (prerequisite shown in plan).
- [x] Deleting a folder removes its files and the empty directory; unmanaged files inside keep the directory and are listed as a warning.
- [x] Interrupting a write (simulated fs error mid-plan) leaves no partial files (temp files cleaned up) and keeps drafts intact.
- [x] Works identically on desktop (TauriFs) and web (FsAccessFs, IdbFs).

## Technical notes
- Scan only managed paths (file-format §1.1) for `diskState`.
- Apply order: writes (new dirs first) → deletes → rmdir deepest first.
- Keep plan computation pure and fast (< 100 ms for 5k requests).

## Files / components likely affected
`packages/core/src/workspace/{commit-planner,project-session}.ts`, `packages/ui/src/features/pending-changes/*`, `packages/ui/src/components/DiffView/*`.

## Tests required
- Unit: planner (table-driven scenarios), prerequisites, broken-file protection.
- Integration: commit on MemoryFs then `readProject` equals working model.
- Git scenario (Node, CI): commit → `git diff --stat` shows expected files.
- Playwright: pending changes flow.

## Definition of done
Standard DoD.

## Implementation notes
- `core/workspace/commit-planner.ts`: pure `planCommit({ base, drafts, selection, disk, knownPaths, brokenPaths, hash })` → `{ entityIds, prerequisites, writes, deletes, rmdirs, renames, blocked, warnings, model }`. Prerequisites = drafts of parents of selected entities (old and new parent), transitively. Safety rules beyond file-format §5.1: only files of committed entities (or below a committed container, or the parent container of a committed child, whose order lists child file keys) are written, so files changed by others are never overwritten; only paths the base was read from are deleted; broken files are never written or deleted (a draft on a broken file is `blocked: broken-file`). `pigeon.json` is written only when a collection draft is committed. ~20 ms for a one-request commit in a 5,000-request project (`commit-perf.test.ts`).
- `ProjectSession`: `scanDisk`, `planCommit(ids?)`, `previewCommit(ids?)` (as if unsaved edits were saved; for the panel), `commit(plan)` (writes → deletes → rmdir deepest first; on failure throws `CommitError`, keeps drafts and reloads the base from disk; `writeFileAtomic` never leaves temp files), `saveForCommit(ids?)` (Save first when needed), `isOwnWrite(path, hash)` for PIGN-020.
- Pending Changes (activity bar, count badge): entities with A/M/D/● (unsaved), checkboxes (new changes start selected), file plan with A/M/D and `R old → new`, blocked entities and kept-directory warnings, per-file unified diff, Save selected / Save all for commit, Discard. The diff is a small LCS line diff (`components/DiffView`) instead of the CodeMirror merge view — exact, dependency-free and testable in jsdom; swap later if side-by-side is wanted.
- Cmd/Ctrl+Shift+S and the Save menu ("Save for commit", "Save all for commit") commit the active request (+ prerequisites); a toast says "Wrote N files". "Reveal" on desktop is not implemented yet (needs a reveal command).
- New package `@pigeon/platform-node` (`NodeFs`, passes `fsConformance`). Core tests may import it (`testPigeon` in eslint.config.js); the Git scenario test (`core/test/commit.test.ts`) commits into a real `git init` repository and checks `git diff --numstat`.
