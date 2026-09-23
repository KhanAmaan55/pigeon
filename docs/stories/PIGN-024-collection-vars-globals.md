# PIGN-024 — Collection variables & project globals

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-024 | 3 — Variables | MVP | Todo | PIGN-023 |

## Goal
Add collection variables (stored in `collection.json`), folder variables (preserved + resolved), and project globals (stored in `environments/globals.postman_globals.json`) with Postman precedence.

## User story
As a developer, I want variables defined on a collection or globally within my project, so shared values like `baseUrl` don't need duplicating in every environment.

## Context
- Scope precedence: [data-model.md §5](../data-model.md#5-variables-and-environments).
- Files: [file-format.md §2.2, §2.5](../file-format.md#22-collectionjson).

## Scope
**In scope**
- Precedence: environment > folder (nearest first) > collection > globals (scripts/data added later).
- Reader/writer for `globals.postman_globals.json` (created on first global variable).
- Current values for collection (`collection:<id>`) and globals (`globals`) scopes in local state.
- UI: Environments view lists **Globals**; collection context menu → **Variables** tab in a collection settings view (also shows collection description/auth placeholder for PIGN-026); folder variables shown read-only when present (edit optional).
- Variable tooltip shows the winning scope and shadowed scopes ("also defined in collection").

**Out of scope**
- Cross-project globals (explicitly not supported — isolation).

## Acceptance criteria
- [ ] A variable in both env and collection resolves to the env value; removing it from env falls back to collection, then globals.
- [ ] Collection variable edits are drafts on the collection; commit updates only `collection.json`.
- [ ] Globals file is created on first commit of a global variable and matches Postman globals shape.
- [ ] Tooltip shows shadowing information.

## Technical notes
- Scope building walks the item's ancestor chain once; cache per tab and invalidate on model change.

## Files / components likely affected
`packages/core/src/variables/scopes.ts`, `packages/formats/src/project/{reader,writer}.ts`, `packages/formats/src/postman/globals.ts`, `packages/ui/src/features/{environments,collection-settings}/*`.

## Tests required
- Unit: precedence table tests; globals read/write golden.
- Playwright: collection var + env override.

## Definition of done
Standard DoD.
