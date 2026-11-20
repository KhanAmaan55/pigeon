# PIGN-027 — Save & manage response examples

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-027 | 5 — Examples & Postman | MVP | Done | PIGN-019, PIGN-010 |

## Goal
Save live responses as Postman-compatible examples stored under `examples/` (metadata + body sidecar), list them under their request, and view/edit/rename/delete them.

## User story
As a developer, I want to save a response as a named example, so I have documentation and a baseline for later comparison.

## Context
- Example model: [data-model.md §6](../data-model.md#6-examples).
- Files, sidecars, volatile headers: [file-format.md §1, §2.6](../file-format.md#26-examplejson-postman-v21-response-body-in-sidecar); D-06.
- UI: [ui-ux.md §3.5–3.6](../ui-ux.md#36-saved-examples).

## Scope
**In scope**
- Model: `Example`, `RequestExample`, `ResponseExample`, `ExampleBody`; `Request.examples`.
- Reader/writer: `examples/<collection>/<folder path>/<request fileKey>/<example fileKey>.example.json` + `<example fileKey>.body.<ext>`; `_pigeon.requestId` + `_pigeon.bodyFile`; JSON bodies pretty-printed (key order preserved); invalid JSON → `.body.txt`; binary → `.body.bin`. Examples whose `requestId` matches no request → problem "orphan example" (kept, never deleted automatically).
- Commit planner: examples follow their request on rename/move (directory path derived from the request's current location); deleting a request deletes its examples (listed in the plan).
- **Save as example** from the response panel: name defaults to `"<code> <status text>"`, `RequestExample` built from the request **definition** (unresolved), volatile response headers removed (default list in preferences, editable), `responseTime` not stored. Creates a draft (Save for Commit writes files).
- Explorer: examples nested under the request (collapsible, count badge); response panel **Examples** tab listing examples.
- Example view: read-only by default, **Edit** toggle (name, code, status text, headers, body in CodeMirror); `originalRequest` collapsed; rename; duplicate; delete.

**Out of scope**
- "Try this example's request" (loading `originalRequest` into the editor) — later nice-to-have.
- Baseline markers and comparison (PIGN-034+), Postman import/export of examples (PIGN-028/029 use this model).

## Acceptance criteria
- [x] Saving a `/json/users` response as example and committing writes `…/list-users/200-ok.example.json` and `200-ok.body.json` matching file-format §2.6 (golden).
- [x] `Date`, `ETag`, `Set-Cookie` etc. are not stored; `Content-Type` is.
- [x] Renaming the request and committing moves its example directory (plan shows renames).
- [x] Editing the example body changes only the `.body.json` file.
- [x] Secrets resolved during the send never appear in example files (test with a secret header variable).
- [x] Binary response saved as example produces `.body.bin` with exact bytes.

## Technical notes
- Example body formatting uses the same pretty-printer as the response viewer but must be deterministic (2 spaces, no trailing spaces, final newline).
- Body sidecar file name derives from the example fileKey; renaming the example renames both files.

## Files / components likely affected
`packages/core/src/model/example.ts`, `packages/formats/src/project/{reader,writer,key-order}.ts`, `packages/formats/src/postman/example.ts`, `packages/core/src/workspace/{commands,commit-planner}.ts`, `packages/ui/src/features/examples/*`, `packages/ui/src/features/response-viewer/ExamplesTab.tsx`, explorer.

## Tests required
- Unit: example read/write golden, sidecar extension rules, volatile header stripping, orphan detection, planner moves.
- Playwright: save example, view, edit, commit.

## Definition of done
Standard DoD.

## Implementation notes
- Formats: `ProjectExample` / `RequestExample` / `ResponseExample` / `ExampleBody` (binary bodies as base64), `ProjectRequest.examples`, `ProjectModel.orphanExamples`. `postman/example.ts` maps Postman `response` objects (`originalRequest` through the request mapping, `_postman_previewlanguage`, `cookie`, `responseTime` kept only when present, unknown keys kept) and the sidecars: `.body.json|xml|html|txt|js` read as text when valid UTF-8, anything else (`.bin`) as exact bytes. The reader walks `examples/**/*.example.json`, joins each to the request named by `_pigeon.requestId` wherever it sits, sorts by file key, and keeps unmatched ones as orphans (problem kind `orphan`, written back in place). The writer derives `examples/<collection>/<folders…>/<request>/` from the request's current location. New key order `example`. `beautifyJson` moved from the UI to formats (one pretty-printer for the viewer and example bodies). Golden fixture `packages/fixtures/projects/examples/` (JSON body with a big number, binary body, no-body 204, orphan, an unmanaged file).
- Core: commands `createExample` (allocates the file key from the name), `updateExample`, `renameExample` (renames both files), `duplicateExample`, `deleteExample`; they all touch the request. Duplicating a request (or a folder/collection) gives the copies' examples new ids pointing at the copy. Commit planner: example files are owned by their request; a request, folder or collection also owns its `examples/` subtree, so renames/moves/deletes take the examples along (unmanaged files keep their directory); renames pair by file name, then by role (example file / body). `exampleFromResponse` builds the example from the request **definition**, drops volatile headers (`DEFAULT_VOLATILE_HEADERS`, incl. `Content-Length`/`Content-Encoding` because the stored body is decoded and reformatted), pretty-prints JSON deterministically (2 spaces, keys and numbers as received, final newline; invalid JSON → `.body.txt`), keeps binary bytes, and masks the secret values the send resolved (`RequestExecutor.execute(…, { onPrepared })` hands them to the in-memory store; results never carry them). `statusText` (reason phrases) moved to core for the default name `"<code> <status text>"`.
- UI: response panel **Save as example** and **Examples** tab (count, open, delete); explorer shows a count badge on requests with examples that expands them as rows (open, rename, duplicate, delete; not draggable); example tabs open `ExampleView` (read-only, **Edit** toggle for name, code, status text, headers and body in CodeMirror; `originalRequest` collapsed; file path shown; duplicate, delete). Save shortcuts in an example tab act on its request. Settings → Examples edits the volatile header list (persisted only when changed).
- Known limit: conflict detection for a drafted request compares the request file only, so an external edit of one of its example files is not flagged before a commit of that request.
