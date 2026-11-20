# PIGN-017 — Explorer CRUD, move & reorder

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-017 | 2 — Projects | MVP | Done | PIGN-016 |

## Goal
Create, rename, duplicate, delete, move, and reorder collections, folders, and requests in the explorer (in-memory edits through ProjectSession).

## User story
As a developer, I want to organize my API into collections and folders with drag and drop, so the project mirrors how I think about the API.

## Context
- Naming rules (slugs, collisions): [file-format.md §4](../file-format.md#4-naming-rules).
- Explorer UX: [ui-ux.md §3.2](../ui-ux.md#32-collection-explorer).

## Scope
**In scope**
- Commands: `createCollection`, `createFolder`, `createRequest`, `renameItem`, `duplicateItem` (deep copy with new ids, name "… copy"), `deleteItem` (confirm; folders recursive), `moveItem(id, newParentId, index)`, `reorderCollections`.
- Slug allocation on create/rename/move collisions via `allocateSlug`; slugs unique per directory across folders and requests.
- Explorer: context menu, inline rename (`F2`/`Enter`), keyboard navigation (arrows, `Enter` open, `Del`), drag & drop with before/after/inside indicators; cannot drop a folder into its own descendant.
- New request (`Cmd/Ctrl+N`) inside the selected folder/collection, opens in a pinned tab with URL focused.
- Explorer filter (fuzzy on name + URL).
- Structural edits count as unsaved state (explorer shows italic/● for now; badges in PIGN-018).

**Out of scope**
- Persisting (PIGN-018), writing files (PIGN-019), cross-project moves.

## Acceptance criteria
- [x] All commands work via UI and keyboard, with undo not required.
- [x] Renaming "Get User" to "Get user by id" updates the entity's future `fileKey` to `get-user-by-id` (visible in a debug tooltip or verified by serialize test).
- [x] Moving a request into a folder with a same-slug item allocates `-2`.
- [x] Dropping a folder into its child is rejected.
- [x] Deleting a folder closes its open tabs (prompt if unsaved).
- [x] `serializeProject(workingModel)` after a sequence of operations matches an expected golden.

## Technical notes
- Keep commands pure functions `(model, cmd) → model` in `core/workspace/commands.ts`; ProjectSession just applies them.
- Use a tree-DnD approach compatible with virtualization (`@dnd-kit` works with virtual lists).

## Files / components likely affected
`packages/core/src/workspace/commands.ts`, `packages/formats/src/slug.ts`, `packages/ui/src/features/explorer/*`.

## Tests required
- Unit: every command incl. edge cases (collisions, deep moves, delete with open tabs signal).
- Golden: serialize after operations.
- Playwright: create/rename/move/delete flows.

## Definition of done
Standard DoD.

## Implementation notes
- Commands in `core/workspace/commands.ts`: `createCollection`, `createFolder`, `createRequest`, `renameItem` (collections too), `duplicateItem` (deep copy, new ids from a `CommandContext`, "… copy" after the original), `deleteItem` (collections, folders recursively), `moveItem`, `moveCollection` (instead of a whole-order `reorderCollections`). New/renamed entities get `slugify` + `allocateSlug` against their siblings; moves keep the slug unless it collides. Commands carry their own ids so they stay pure; `touchedIds(model, command)` names the entity and every container whose order changes (all count as unsaved). `CommandError` for invalid commands (moving a folder into itself/descendants, broken containers, unknown ids).
- `ProjectSession.discardUnsaved` now also restores deleted entities (at their file position, if the container still exists) and drops created ones.
- Golden: `packages/fixtures/projects/after-operations` = `serializeProject` after a fixed sequence of commands (`UPDATE_GOLDEN=1 pnpm vitest run packages/core/test/commands.test.ts`).
- Explorer: Radix context menu (New request / New folder / Rename / Duplicate / Delete), inline rename (F2, Enter commits, Esc cancels, blur commits), confirm dialog for deletes (mentions unsaved open requests, which are discarded and their tabs closed), keyboard (arrows, Enter opens pinned, F2, Del / Cmd·Ctrl+Backspace, Cmd·Ctrl+D, Cmd·Ctrl+F focuses the filter), Cmd·Ctrl+N (also Alt+N) for a new request in the selected container (pinned tab, URL focused), "+" for a new collection, a fuzzy filter on name + URL (ancestors of matches expanded), unsaved entities in italics with a dot.
- Drag and drop uses native HTML5 DnD on the virtualized rows (no `@dnd-kit`): top/bottom quarter = before/after, middle = inside for containers; requests split in halves; collections only reorder among collections. `resolveDrop` in `features/explorer/actions.ts` decides, and refuses drops into the dragged folder or its descendants.
- E2E hooks are installed after a dynamic import, so specs wait for `window.__pigeonTest` (`gotoApp`).
