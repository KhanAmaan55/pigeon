# PIGN-019 — Save for Commit & Pending Changes

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-019 | 2 — Projects | MVP | Todo | PIGN-018 |

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
- [ ] Editing one header on one request and committing changes exactly one file with a minimal diff (golden test).
- [ ] Save for Commit with no drafts writes zero files.
- [ ] Renaming a request produces a delete + write displayed as `R old → new`; examples dirs are not touched yet (added in PIGN-027).
- [ ] Committing a request inside a new folder also writes the folder (prerequisite shown in plan).
- [ ] Deleting a folder removes its files and the empty directory; unmanaged files inside keep the directory and are listed as a warning.
- [ ] Interrupting a write (simulated fs error mid-plan) leaves no partial files (temp files cleaned up) and keeps drafts intact.
- [ ] Works identically on desktop (TauriFs) and web (FsAccessFs, IdbFs).

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
