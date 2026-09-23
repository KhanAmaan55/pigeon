# PIGN-029 — Export Postman collection v2.1

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-029 | 5 — Examples & Postman | MVP | Todo | PIGN-028 |

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
- [ ] All exports validate against the v2.1 JSON Schema.
- [ ] Round-trip equality holds for every fixture.
- [ ] Exported file opens in Postman (manual check, noted in implementation notes) with folders, requests, auth, scripts, variables intact.
- [ ] Export works on desktop (save dialog) and web (download / save picker).

## Technical notes
- URL decomposition must handle `{{baseUrl}}` hosts: Postman represents `{{baseUrl}}/users` as `host: ["{{baseUrl}}"], path: ["users"]`.

## Files / components likely affected
`packages/formats/src/postman/{export,url}.ts`, `packages/fixtures/postman/schema/*`, `packages/formats/test/roundtrip.test.ts`, `packages/ui/src/features/import-export/*`.

## Tests required
- Schema validation + round trip for all fixtures; URL decomposition table tests.

## Definition of done
Standard DoD.
