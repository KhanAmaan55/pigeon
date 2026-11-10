# PIGN-009 — Request body modes

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-009 | 1 — First request | MVP | Done | PIGN-008 |

## Goal
Support all Postman body modes except GraphQL: none, raw (JSON/text/XML/HTML/JavaScript), x-www-form-urlencoded, form-data (text + file), binary file.

## User story
As a developer, I want to send JSON, forms, and file uploads, so I can test any endpoint.

## Context
- Body model: [data-model.md §4](../data-model.md#4-collection-folder-request).
- Encoding table & `PreparedBody`/`FileRef`: [api-execution.md §2, §5](../api-execution.md#5-body-encoding).
- Web file limitations: [platform.md §6.5](../platform.md#65-importing--exporting-files).

## Scope
**In scope**
- `core/model/body.ts`: full `Body` union (except graphql, added in PIGN-032) with `FormDataParam`.
- `core/execution/body/`: encoders per mode; default `Content-Type` when the user hasn't set one; `body.disabled`.
- Validation: GET/HEAD with body blocked when `!capabilities.canSendBodyWithGet` (error) and on desktop only allowed when `settings.disableBodyPruning` (otherwise body dropped + warning, Postman behaviour).
- `FileRef` resolution: `picked` (web/desktop in-memory `File`/bytes for the session), `absolute` (desktop). (`project` refs added in PIGN-014.)
- Rust `http_send` extended: multipart parts (text + file path/bytes), file body from path.
- `FetchTransport`: `FormData` for multipart, `Blob` for file bodies.
- UI **Body** tab: mode radio; CodeMirror 6 editor for raw with language select (JSON syntax + lint for invalid JSON, "Beautify" button); urlencoded table; form-data table with per-row text/file toggle, file picker, optional content type; binary file picker. Changing mode keeps other modes' content in memory (Postman behaviour).

**Out of scope**
- GraphQL (PIGN-032), file paths relative to project (PIGN-014/016), variable resolution inside bodies (PIGN-023).

## Acceptance criteria
- [x] JSON raw body is sent byte-for-byte as typed with `Content-Type: application/json` unless overridden.
- [x] urlencoded body with special characters is encoded correctly (verified by `/echo` parsed form).
- [x] form-data with 2 text fields and 1 file arrives at `/echo` with correct names, filename, size, content type — on web and desktop. Web: Playwright (`setInputFiles`) in Chromium, Firefox and WebKit. Desktop: `cargo test` sends the same shape (picked file inline in the frame, and a file from disk) to `/echo`; `NativeTransport` frame tests cover the TS side.
- [x] Binary body from a picked file arrives with correct bytes (`/echo` reports size + sha256).
- [x] GET with body on web shows a validation error; on desktop the body is dropped with a warning unless "Send body with GET" is enabled in request settings.
- [x] Invalid JSON shows an inline lint marker but still allows sending.

## Technical notes
- CodeMirror setup shared in `ui/src/components/CodeEditor` (language extensions loaded lazily).
- Keep "content kept per mode" in the request model? No — in UI editor state only; the model stores the active mode (Postman stores only one body). Document if you choose otherwise.

## Files / components likely affected
`packages/core/src/model/body.ts`, `packages/core/src/execution/body/*`, `packages/core/src/execution/validate.ts`, `packages/platform-web/src/fetch-transport.ts`, `packages/platform-desktop/src/native-transport.ts`, `apps/desktop/src-tauri/src/http.rs`, `packages/ui/src/components/CodeEditor/*`, `packages/ui/src/features/request-editor/BodyTab/*`.

## Tests required
- Unit: each encoder, default content type rules, GET-body rules per capability.
- `cargo test`: multipart and file body.
- Transport conformance: multipart and binary cases.
- Playwright: JSON and form-data (with `setInputFiles`) to `/echo`.

## Definition of done
Standard DoD.

## Implementation notes
- **Model** (`core/model/body.ts`): `Body` union (`none`, `raw`, `urlencoded`, `formdata`, `file`, each with `disabled?`/`extra?`), `FormDataParam` (`kind`, `src`, `contentType`), `emptyBody`, and the file-source helpers. `KeyValue`/`Description` moved here from `request.ts` (still re-exported from it).
- **File sources**: `src` stays a Postman-style string. Files picked in the editor are `picked:<id>/<name>`; their bytes live in `PickedFileStore` (`@pigeon/platform`, new `Platform.pickedFiles`), which the editor fills and both transports read. Encoding the name in `src` lets core derive the multipart file name and the default content type without access to the store. Absolute paths → `absolute` refs; other paths → `project` refs, which every transport rejects as `file-unavailable` until PIGN-014/015.
- **Encoding** (`core/execution/body/`): one encoder per mode plus `mediaTypeForFileName`. An "empty" body (empty raw text, no enabled rows, no file) is no body, so selecting raw on a GET doesn't trip the GET rule and adds no `Content-Type`. `hasBody` answers that without encoding (used by the UI).
- **GET/HEAD rule** (`core/execution/validate.ts`, `validateBody`): error without `canSendBodyWithGet`; otherwise dropped + warning unless `settings.disableBodyPruning`. Prepare-time warnings travel in the new optional `PreparedRequest.meta.warnings` and come first in `ExecutionResult.warnings`. `autoHeaders` takes the method/settings into account, and lists the multipart `Content-Type` as a `preview` entry that `prepareRequest` doesn't send.
- **FetchTransport**: `FormData` with a `File` per file part (any user `Content-Type` is dropped so the browser's boundary is used; warning unless it was plain `multipart/form-data`), `Blob` for binary bodies. Text-part content types can't be sent by browsers → warning.
- **Rust `http_send`**: `PreparedBody` gained `File { ref }` and `Multipart { parts }`; files are read from disk (`absolute`) or sliced from the frame's body bytes (`inline`, how picked files travel). Multipart is encoded by hand (RFC 7578, browser-style escaping, random boundary), so redirects can replay the bytes; a user boundary is kept, a `multipart/*` type without one gets it appended. New error kind `file-unavailable`.
- **Test server**: `/echo` now also reports `body.sha256`.
- **UI**: `components/CodeEditor` (CodeMirror 6: line numbers, history, bracket matching, token-based colours, lint; the component itself and each language are lazy chunks, which keeps the main web bundle under Vite's 500 kB warning; Cmd/Ctrl+Enter is left to Send). `features/request-editor/BodyTab` (mode radio, raw language select + Beautify for JSON, urlencoded table, form-data table with Text/File select, file chips, multi-file picker and a content-type column, binary picker, GET-body notice) and a new **Settings** tab with "Send body with GET" (disabled on web). `KeyValueTable` is now generic over the row type with `renderValue`, `extraColumns` and `newRow`. Beautify (`lib/json-format.ts`) re-indents tokens instead of `JSON.parse`/`stringify`, so numbers like `12345678901234567890` survive.
- **Content kept per mode**: in the scratch store's `bodyDrafts` (editor state), not in the request, as the story suggests.
- **Tests**: `core/test/body.test.ts` (schema, sources, every encoder, content types, GET rules per capability, executor warnings/previews), `platform/test/picked-files.test.ts`, FetchTransport and NativeTransport body tests, three new conformance cases (`multipart`, `file-body`, `file-unavailable`, also run by the MockTransport double and in Playwright), ten new `cargo test` cases, `ui/test/body-tab.test.tsx`, and `e2e/web/request-bodies.spec.ts` (JSON, lint marker, Beautify, urlencoded, form-data, binary, GET error).
- **Known limits**: the desktop app picks files with the webview's `<input type="file">` too, so desktop files are read into memory for the session (no path is kept); native dialogs with paths come with the dialog work. Picked files are not freed when a row is removed (session memory only). The desktop `--smoke` probe was not extended to bodies; the Body tab itself has not been driven inside the desktop app, only through `cargo test` and the frame tests.
