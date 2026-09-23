# PIGN-017 — Explorer CRUD, move & reorder

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-017 | 2 — Projects | MVP | Todo | PIGN-016 |

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
- [ ] All commands work via UI and keyboard, with undo not required.
- [ ] Renaming "Get User" to "Get user by id" updates the entity's future `fileKey` to `get-user-by-id` (visible in a debug tooltip or verified by serialize test).
- [ ] Moving a request into a folder with a same-slug item allocates `-2`.
- [ ] Dropping a folder into its child is rejected.
- [ ] Deleting a folder closes its open tabs (prompt if unsaved).
- [ ] `serializeProject(workingModel)` after a sequence of operations matches an expected golden.

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
