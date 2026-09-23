# PIGN-027 — Save & manage response examples

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-027 | 5 — Examples & Postman | MVP | Todo | PIGN-019, PIGN-010 |

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
- [ ] Saving a `/json/users` response as example and committing writes `…/list-users/200-ok.example.json` and `200-ok.body.json` matching file-format §2.6 (golden).
- [ ] `Date`, `ETag`, `Set-Cookie` etc. are not stored; `Content-Type` is.
- [ ] Renaming the request and committing moves its example directory (plan shows renames).
- [ ] Editing the example body changes only the `.body.json` file.
- [ ] Secrets resolved during the send never appear in example files (test with a secret header variable).
- [ ] Binary response saved as example produces `.body.bin` with exact bytes.

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
