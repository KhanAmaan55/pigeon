# PIGN-030 — Import/export Postman environments & globals

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-030 | 5 — Examples & Postman | MVP | Done | PIGN-028, PIGN-025 |

## Goal
Import Postman environment and globals files (single or multiple at once) and export environments/globals in Postman format, respecting shared vs current values and secrets.

## User story
As a Postman user, I want to bring my environments along and export them back, so my variables move with my collections.

## Context
- Mapping and the initial/current value caveat: [compatibility.md §B.1](../compatibility.md#b1-pigeon--postman-environment-observed).
- Secrets rules: [file-format.md §7](../file-format.md#7-secrets).

## Scope
**In scope**
- `detectFormat` extended: environment (`_postman_variable_scope: 'environment'` or `values[]` + `name` shape), globals.
- Importer → `Environment` / globals values; name collisions → "Staging (2)" or "Replace existing" choice.
- Import dialog shows variables count, secret count, and option **"Also use imported values as my current values"** (default off); secrets' imported values go to `SecretStore` as current values if the option is on, and the shared value is left empty with a warning ("secret values are not written to files").
- Export environment/globals: re-add `_postman_variable_scope`, `_postman_exported_at` (now), `_postman_exported_using: "Pigeon/<version>"`; values = shared values only.
- Multiple files dropped at once (collection + environments) → one combined preview.

**Out of scope**
- Apidog/Echo API (PIGN-048/049).

## Acceptance criteria
- [x] Postman env and globals fixtures import and commit to files matching file-format §2.5.
- [x] Secret variables never have their imported value written to a project file.
- [x] Export → re-import round-trips shared values, types, enabled flags, unknown keys.
- [x] Dropping a collection + 2 environments imports all three in one confirmation.

## Technical notes
- Keep detection and mapping in `formats/src/postman/environment.ts`; UI only orchestrates.

## Files / components likely affected
`packages/formats/src/{detect.ts,postman/environment.ts,postman/globals.ts}`, `packages/core/src/import/import-service.ts`, `packages/ui/src/features/import-export/*`, `packages/fixtures/postman/environments/*`.

## Tests required
- Unit: detection, mapping, secret handling, export shape.
- Playwright: import env + select + send.

## Definition of done
Standard DoD.

## Implementation notes
- Formats: `detectFormat` recognizes environments by `_postman_variable_scope: "environment"` or a `name` + `values[]` shape, globals by scope. `postman/environment-io.ts`: `importPostmanEnvironment` / `importPostmanGlobals` reuse the project mappings (types, `enabled`, descriptions and unknown keys kept; volatile `_postman_exported_*` dropped), give a missing or taken id a fresh one, empty the shared value of every secret and return all imported values as `currentValues` plus a report (variables, secrets, warning when secret values were not written). `exportEnvironment` / `exportGlobals` write shared values only and re-add `_postman_variable_scope`, `_postman_exported_at` (now) and `_postman_exported_using: "Pigeon/<version>"`; file names `<name>.postman_environment.json` / `globals.postman_globals.json`. Fixtures in `packages/fixtures/postman/environments/`.
- Core: `previewImportFiles(files, importContext(model))` → one `ImportItem` per file (collection, environment with `collidesWith`, globals, or rejected), ids reserved across the batch. `applyImport(session, items, { names, useAsCurrentValues, onCollision })` applies collections (`importCollection`), environments (`createEnvironment` with its unknown keys — the command gained `extra` — as "Name (2)" on a name clash, or `setEnvironmentValues` on the existing one for "replace"), globals (merged by key), and optionally sets the imported values as current values (secrets go to the `SecretStore` through the usual routing); it returns the entity ids to commit or save.
- UI: the import dialog takes several files (picker with multiple selection, or several files dropped at once) and shows one combined preview: per file its format, counts (folders/requests/examples, or variables/secrets), warnings and id regenerations; editable collection names; a keep-both/replace choice when an environment name exists; "Also use imported values as my current values" (off by default). Environments view: Import button, **Export as Postman environment…** in each environment's menu, and an export button on Globals.
- E2E: a collection and two environments dropped together import in one confirmation; selecting the imported environment and sending reaches the test server (Chromium, Firefox, WebKit).
