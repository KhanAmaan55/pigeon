# PIGN-028 — Import Postman collection (v2.1/v2.0)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-028 | 5 — Examples & Postman | MVP | Todo | PIGN-027, PIGN-026 |

## Goal
Import a Postman Collection v2.1 or v2.0 file into the current project with a preview dialog, preserving unknown fields, and write it as project files.

## User story
As a Postman user, I want to import my existing collections without losing anything, so I can switch to Pigeon immediately.

## Context
- Mapping, preservation, normalizations: [compatibility.md Part A](../compatibility.md#part-a--postman-collections).
- Import UX: [ui-ux.md §3.9](../ui-ux.md#39-import--export).
- Import flow: [architecture.md §7](../architecture.md#7-import--export).

## Scope
**In scope**
- `formats/src/detect.ts`: `detectFormat(text|bytes)` for Postman collection v2.1 / v2.0 / v1 (reject) — structure-based (compatibility §B.4, collection part).
- `formats/src/postman/collection-v21.ts` importer → `{ collection: Collection, report: ImportReport }` with each request's `response[]` mapped to `Example[]` (example files + body sidecars from PIGN-027).
- `formats/src/postman/collection-v20.ts` converter (auth objects → arrays, header strings, URL strings) feeding the v2.1 path.
- Id handling: keep Postman ids when unique in project, else regenerate (listed in report).
- Slugs for all folders/requests; duplicate names handled.
- `ImportReport`: counts, warnings (unsupported auth types, scripts not executed, absolute file paths rewritten or kept, v2.0 conversion, id regenerations, derived URL mismatch).
- Import dialog: file picker/drag & drop anywhere in the window, detected format + version, counts, warnings, target "New collection" (name editable), buttons **Import & write files** (default: creates drafts then commits them) / **Import as local drafts**.
- Welcome screen "Import Postman file" creates a new project first (asks for location) then imports.
- Fixtures per testing.md §3.4 (collection files) added to `packages/fixtures/postman/`.

**Out of scope**
- Export (PIGN-029), environments (PIGN-030), merging into an existing collection, Postman data dumps.

## Acceptance criteria
- [ ] Every collection fixture imports; resulting project files validate with the project reader and contain all unknown keys.
- [ ] v2.0 fixture imports with v2.1-equivalent auth.
- [ ] v1 file shows a clear rejection message.
- [ ] Import of a 5,000-request generated collection completes < 5 s and the UI stays responsive (progress indicator).
- [ ] Imported project → Save for Commit → reopen → identical working model.
- [ ] Examples in the source become example files under `examples/` (with body sidecars) and appear under their requests.

## Technical notes
- Run parsing/import in a Worker for large files (UI), plain call in tests.
- Reuse `formats/src/postman/item.ts` from PIGN-013.
- Example bodies: choose the sidecar extension from `_postman_previewlanguage` / `Content-Type` header (file-format §2.6); imported examples keep all headers (no volatile-header stripping on import).

## Files / components likely affected
`packages/formats/src/{detect.ts,postman/*}`, `packages/core/src/import/import-service.ts`, `packages/ui/src/features/import-export/*`, `packages/fixtures/postman/*`.

## Tests required
- Unit: importer per fixture (snapshot of resulting model + report), v2.0 conversion, detection.
- Integration: import → commit → read equality.
- Playwright: drag-and-drop import flow.

## Definition of done
Standard DoD.
