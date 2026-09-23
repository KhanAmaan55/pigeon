# PIGN-018 — Save to local state (drafts)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-018 | 2 — Projects | MVP | Todo | PIGN-017 |

## Goal
Implement **Save**: persist edits as drafts in local app state (not project files), restore them after restart, and show modified/added/deleted badges. Also persist tabs, layout, and preferences.

## User story
As a developer, I want to save my work locally without touching my Git working tree, so I can experiment and decide later what to commit.

## Context
- Save vs Save for Commit: [file-format.md §5](../file-format.md#5-save-vs-save-for-commit).
- Local state schema & location: [data-model.md §9](../data-model.md#9-local-state), [file-format.md §6](../file-format.md#6-local-app-state); D-07.

## Scope
**In scope**
- `ProjectSession.save(refs?)`: converts unsaved edits into `Draft`s (`create`/`update`/`delete`, `parentId`, `index`, `baseHash` = hash of the entity's current file or null for new) and writes `LocalProjectState` via `AppStateStore` (`project:<id>` namespace).
- On open: load drafts → working model = base + drafts; drafts whose entity no longer exists / base changed are handled in PIGN-020 (for now: apply if possible, else keep and flag "stale").
- `discardDraft(ref)` restores file version.
- Desktop `AppStateStore`: `projects/<projectId>/state.json` written atomically, debounced for UI state (tabs/layout 500 ms), immediate for Save.
- Web: IndexedDB `projects` store (already from PIGN-015).
- Persist: open tabs + active tab, explorer expansion, response layout, theme, preferences (default timeout).
- UI: `Cmd/Ctrl+S` Save (active tab), "Save all" in menu/palette, split Save button; explorer badges **M**, **A**, **D** (deleted items shown struck-through until committed); tab ● cleared after save; close-tab prompt offers Save / Discard / Cancel.
- Local state `schemaVersion: 1` + unreadable state → backup and reset (file-format §6).

**Out of scope**
- Writing project files (PIGN-019), conflicts (PIGN-020).

## Acceptance criteria
- [ ] Edit a request → Save → restart app → edit is still there, badge **M**, project files unchanged (verified by hash).
- [ ] Create folder + request → Save → restart → both present with **A**.
- [ ] Delete a request → Save → shows as deleted **D**; Discard brings it back.
- [ ] Tabs, active tab, layout, and theme restore after restart (desktop & web).
- [ ] Corrupted `state.json` is backed up and the project opens clean.

## Technical notes
- Drafts store full entity data without children (children are separate drafts); order changes are drafts on the parent (`update` with new order).
- Keep draft application pure: `applyDrafts(base, drafts) → { model, stale: Draft[] }` in core.

## Files / components likely affected
`packages/core/src/workspace/{drafts,project-session,local-state}.ts`, `packages/platform-desktop/src/app-state.ts`, `packages/platform-web/src/idb-app-state.ts`, `packages/ui/src/features/{explorer,tabs,request-editor}/*`, `packages/ui/src/stores/*`.

## Tests required
- Integration: session save → new session over same stores restores (MemoryFs + MemoryAppState).
- Unit: applyDrafts, stale detection, schema migration/backup.
- Playwright: save + reload restores (web); desktop E2E save + restart.

## Definition of done
Standard DoD.
