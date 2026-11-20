# PIGN-016 — Request tabs for project requests

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-016 | 2 — Projects | MVP | Done | PIGN-014, PIGN-009 |

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
- [x] Opening 3 requests shows 3 tabs; preview behaviour works as described.
- [x] Editing a request shows ● in its tab; sending uses the edited values.
- [x] Closing with unsaved changes prompts; Discard restores the file version.
- [x] Switching tabs preserves each tab's last response and scroll/editor state.
- [x] Project-relative file references are sent correctly on desktop and on web (fs-access).

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

## Implementation notes
- Core: `core/workspace/commands.ts` (`EditCommand` with `updateRequest`, pure `applyCommand`, `replaceItem`/`findItem` with structural sharing). `ProjectSession.apply`, `isUnsaved`, `unsavedIds`, `discardUnsaved`; `reload()` keeps unsaved edits on top of the new files (conflicts: PIGN-020). Edits to broken files and read-only projects throw.
- UI: the project store holds `tabs` (`{ id, pinned }`; the unpinned one is the preview tab), `activeTabId` and `unsaved`. Each tab has its own editor store (`features/tabs/editor-registry.ts`), created from the scratch-store code with a `RequestBinding` (read from the working model, commit through `updateRequest`, follow `onChange`), so tabs keep their last response, body-mode drafts and in-flight send. Editing a preview tab pins it. Tabs of requests that disappear close.
- Only the active tab's editor is mounted, so the response viewer's sub-tab and scroll position reset when switching (the response itself and the request stay). Follow-up if this matters in practice.
- Tab bar (`features/tabs/RequestTabs.tsx`): method + name, italic preview, ● unsaved, close button / middle click / Cmd·Ctrl+W (also Alt+W, which browsers leave to pages), Ctrl+Tab / Ctrl+Shift+Tab. Closing an unsaved tab asks Discard / Cancel (Save options come with PIGN-018).
- The PIGN-014 read-only banner is gone; without a project the main area shows one "Scratch request" tab.
- "From project…" next to the file pickers lists files of the open project (outside Pigeon's managed files, skipping `.git`/`node_modules`, max 2,000) and stores the project-relative path; sending reads it through the project filesystem on every platform. Absolute paths from a native dialog on desktop are not offered yet (the webview file input only yields bytes); follow-up with native dialogs.
