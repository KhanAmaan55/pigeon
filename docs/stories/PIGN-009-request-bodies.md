# PIGN-009 — Request body modes

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-009 | 1 — First request | MVP | Todo | PIGN-008 |

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
- [ ] JSON raw body is sent byte-for-byte as typed with `Content-Type: application/json` unless overridden.
- [ ] urlencoded body with special characters is encoded correctly (verified by `/echo` parsed form).
- [ ] form-data with 2 text fields and 1 file arrives at `/echo` with correct names, filename, size, content type — on web and desktop.
- [ ] Binary body from a picked file arrives with correct bytes (`/echo` reports size + sha256).
- [ ] GET with body on web shows a validation error; on desktop the body is dropped with a warning unless "Send body with GET" is enabled in request settings.
- [ ] Invalid JSON shows an inline lint marker but still allows sending.

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
