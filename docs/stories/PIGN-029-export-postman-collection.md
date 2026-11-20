# PIGN-029 — Export Postman collection v2.1

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-029 | 5 — Examples & Postman | MVP | Done | PIGN-028 |

## Goal
Export a collection (or a folder as a collection) to a single Postman v2.1 file that re-imports into Postman and round-trips semantically with the original import.

## User story
As a developer, I want to hand a Postman file to a teammate who still uses Postman, so switching tools never locks anyone out.

## Context
- Export options and normalizations: [compatibility.md §A.4–A.5](../compatibility.md#a4-normalizations-documented-not-loss).

## Scope
**In scope**
- `formats/src/postman/export.ts`: `exportCollection(model, collectionId | folderId, { includeExamples, includePigeonMetadata }) → object`; regenerates URL derived parts (`protocol`, `host[]`, `path[]`, `port`) from `raw` like Postman; emits `extra` keys in place; strips `_pigeon` unless requested; `info.schema` v2.1 URL.
- Vendored Postman v2.1 JSON Schema in `packages/fixtures/postman/schema/` + validator (e.g. `ajv`, test-only dependency).
- `normalizePostman(json)` test helper implementing compatibility §A.4 normalizations.
- Round-trip test for every fixture: `normalize(export(import(x))) deepEquals normalize(x)`.
- UI: collection/folder context menu → Export → options dialog → `platform.files.saveFile('<name>.postman_collection.json')`.
- Verify manually once that Postman ignores `_pigeon` keys when "Include Pigeon metadata" is on; record result in compatibility.md (§A.5 "Observed").

**Out of scope**
- Exporting environments (PIGN-030).

## Acceptance criteria
- [x] All exports validate against the v2.1 JSON Schema.
- [x] Round-trip equality holds for every fixture.
- [ ] Exported file opens in Postman (manual check, noted in implementation notes) with folders, requests, auth, scripts, variables intact.
- [x] Export works on desktop (save dialog) and web (download / save picker).

## Technical notes
- URL decomposition must handle `{{baseUrl}}` hosts: Postman represents `{{baseUrl}}/users` as `host: ["{{baseUrl}}"], path: ["users"]`.

## Files / components likely affected
`packages/formats/src/postman/{export,url}.ts`, `packages/fixtures/postman/schema/*`, `packages/formats/test/roundtrip.test.ts`, `packages/ui/src/features/import-export/*`.

## Tests required
- Schema validation + round trip for all fixtures; URL decomposition table tests.

## Definition of done
Standard DoD.

## Implementation notes
- `formats/src/postman/url.ts` `decomposeUrl(raw)`: protocol, `host[]` (split on dots outside `{{…}}`, so `{{baseUrl}}` stays one part), `port` (digits or a variable), `path[]` (trailing slash → empty last segment); query and hash come from the model. Table tests in `url-decompose.test.ts`.
- `formats/src/postman/export.ts` `exportCollection(collectionOrFolder, { includeExamples = true, includePigeonMetadata = false })` → `{ data, fileName, warnings }`; reuses the project mappings (`requestToPostmanItem`, `authToPostman`, `exampleToPostman`, variables), emits unknown keys in place, regenerates URL parts (requests and `originalRequest`), drops `_pigeon` (and always the file-only `order`, `requestId`, `bodyFile`), inlines example bodies (binary ones as Latin-1 text, with a warning), leaves broken entities out (warning), omits the empty `value` of file form-data rows. A folder exports as a collection (its id, name, description, auth, events and variables at the root). `exportCollectionText` writes it tab-indented like Postman. File name `<name>.postman_collection.json`.
- Schema: `packages/fixtures/postman/schema/collection-v2.1.0.json` is the official v2.1.0 schema (draft-04), vendored verbatim from schema.getpostman.com, validated with `ajv-draft-04` (dev dependency of formats). Every fixture's export validates; a sanity test checks that malformed collections are rejected.
- `test/postman-normalize.ts` implements compatibility §A.4 (plus two documented additions: example order, empty file-row values). `roundtrip.test.ts`: for every fixture, import → project files → read → export validates against the schema and `normalize(export) == normalize(original)`.
- UI: explorer context menu **Export as Postman collection…** on collections and folders → options dialog (include examples, include Pigeon metadata, warnings, file name) → `platform.files.saveFile` (desktop save dialog; web download or save picker). E2E covers the download in Firefox and WebKit (Chromium uses the native save picker).
- Not done: the manual check that the exported file opens in Postman (criterion left unchecked — no Postman available here), and whether Postman ignores `_pigeon` keys (compatibility §A.5 now says "Assumption").
