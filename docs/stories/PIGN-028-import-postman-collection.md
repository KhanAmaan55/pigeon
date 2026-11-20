# PIGN-028 — Import Postman collection (v2.1/v2.0)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-028 | 5 — Examples & Postman | MVP | Done | PIGN-027, PIGN-026 |

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
- [x] Every collection fixture imports; resulting project files validate with the project reader and contain all unknown keys.
- [x] v2.0 fixture imports with v2.1-equivalent auth.
- [x] v1 file shows a clear rejection message.
- [x] Import of a 5,000-request generated collection completes < 5 s and the UI stays responsive (progress indicator).
- [x] Imported project → Save for Commit → reopen → identical working model.
- [x] Examples in the source become example files under `examples/` (with body sidecars) and appear under their requests.

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

## Implementation notes
- Formats: `detectFormat` (bytes, text or parsed JSON; BOM tolerated) recognizes collection v2.1/v2.0, rejects v1 ("Re-export it from Postman as Collection v2.1") and data dumps, and spots environments/globals for PIGN-030. `convertCollectionV20` turns auth objects into param arrays and header strings into arrays (requests, responses, `originalRequest`). `importPostmanCollection(data, version, { existingIds, newId })` maps the tree with the project reader's own mappings (`collectionFromPostman` / `folderFromPostman` were extracted from the reader; requests use `requestFromPostmanItem`), allocates file keys per sibling namespace, turns `response[]` into examples (sidecar format from `_postman_previewlanguage`, else `Content-Type`; JSON that doesn't parse → `.body.txt`; bodies kept exactly as in the file; all headers kept; file-key order like the reader), keeps free ids and regenerates taken ones, builds `url.raw` from parts when a file has none, and reports counts, unsupported auth types, scripts, absolute file paths (kept, flagged), URL parts that disagree with `raw`, generated ids and the v2.0 conversion. Fixtures in `packages/fixtures/postman/` (echo-basic, bodies, auth, nested-folders, examples, scripts, graphql, unknown-fields, legacy v2.0, v1), excluded from Prettier; the 5,000-request collection is generated in tests.
- Core: `previewImport(model, bytes)` / `previewImportFile(bytes, usedIds)` → `ImportPlan` or a rejection; `renamePlan`, `planEntityIds`; command `importCollection` (file key from the possibly edited name; all ids must be free). Import & write files = `importCollection` + `saveForCommit(planEntityIds)`; Import as local drafts = `save(ids)`. 5,000 requests import and commit in ≈3 s (test: < 5 s, best of two).
- UI: `ImportDialog` (format, counts, warnings, id regenerations, editable collection name, Import & write files / Import as local drafts, rejection message). Opened by the explorer's Import button, Cmd/Ctrl+O, or dropping a file anywhere in the window (the desktop window sets `dragDropEnabled: false` so the webview gets HTML5 drops); Welcome → **Import Postman file…** picks the collection, creates a project named after it (folder on desktop, browser workspace on the web) and opens the dialog. Files over 512 KB are mapped in a Web Worker (`import.worker.ts`), inline otherwise, with a progress line.
- Not done here: rewriting absolute file paths inside the project folder to project-relative (no project path is known in a pure import; they are kept and listed). Merging into an existing collection stays out of scope.
