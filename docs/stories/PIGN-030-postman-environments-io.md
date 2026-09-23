# PIGN-030 — Import/export Postman environments & globals

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-030 | 5 — Examples & Postman | MVP | Todo | PIGN-028, PIGN-025 |

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
- [ ] Postman env and globals fixtures import and commit to files matching file-format §2.5.
- [ ] Secret variables never have their imported value written to a project file.
- [ ] Export → re-import round-trips shared values, types, enabled flags, unknown keys.
- [ ] Dropping a collection + 2 environments imports all three in one confirmation.

## Technical notes
- Keep detection and mapping in `formats/src/postman/environment.ts`; UI only orchestrates.

## Files / components likely affected
`packages/formats/src/{detect.ts,postman/environment.ts,postman/globals.ts}`, `packages/core/src/import/import-service.ts`, `packages/ui/src/features/import-export/*`, `packages/fixtures/postman/environments/*`.

## Tests required
- Unit: detection, mapping, secret handling, export shape.
- Playwright: import env + select + send.

## Definition of done
Standard DoD.
