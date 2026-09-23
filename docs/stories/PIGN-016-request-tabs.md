# PIGN-016 — Request tabs for project requests

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-016 | 2 — Projects | MVP | Todo | PIGN-014, PIGN-009 |

## Goal
Open project requests in editor tabs and edit them in memory through `ProjectSession` edit commands, with unsaved indicators.

## User story
As a developer, I want several requests open in tabs and to edit them freely, so I can work across endpoints.

## Context
- Edit commands: [architecture.md §3.2](../architecture.md#32-projectsession-coreworkspace).
- Change states: [data-model.md §10](../data-model.md#10-change-states-of-an-entity).
- Tabs UX: [ui-ux.md §3.2–3.3](../ui-ux.md#32-collection-explorer).

## Scope
**In scope**
- `ProjectSession.apply(cmd)` with `updateRequest(id, patch)`; working model = base + in-memory edits; `isUnsaved(ref)`; `discardUnsaved(ref)`.
- Project store: tabs (`open`, `activeIndex`, `previewTab`); single click in explorer = preview tab (replaced by next preview), double click/edit = pinned.
- Tab bar: method badge + name, unsaved dot ●, close (`Cmd/Ctrl+W`, middle click), `Ctrl+Tab` cycling, overflow scroll.
- Closing a tab with unsaved changes → prompt: Discard / Cancel (Save options appear in PIGN-018).
- Request editor bound to the working model; the scratch editor becomes a special "Scratch" tab when no project is open.
- Form-data/binary file pickers inside a project offer "Pick from project folder" → stores project-relative `src`; absolute paths outside the project allowed on desktop with a warning ("won't work for teammates").
- Last response per request kept in memory (per tab), shown when switching tabs.

**Out of scope**
- Persisting edits or tabs (PIGN-018), explorer CRUD (PIGN-017).

## Acceptance criteria
- [ ] Opening 3 requests shows 3 tabs; preview behaviour works as described.
- [ ] Editing a request shows ● in its tab; sending uses the edited values.
- [ ] Closing with unsaved changes prompts; Discard restores the file version.
- [ ] Switching tabs preserves each tab's last response and scroll/editor state.
- [ ] Project-relative file references are sent correctly on desktop and on web (fs-access).

## Technical notes
- Patches applied to immutable model objects (structural sharing) so React re-renders only affected components.
- Tab state is per project store (isolation for PIGN-021).

## Files / components likely affected
`packages/core/src/workspace/{project-session,commands}.ts`, `packages/ui/src/stores/project-store.ts`, `packages/ui/src/features/request-editor/*`, `packages/ui/src/features/tabs/*`.

## Tests required
- Unit: apply/discard commands, unsaved tracking.
- Playwright: open/edit/close/preview tab flows.

## Definition of done
Standard DoD.
