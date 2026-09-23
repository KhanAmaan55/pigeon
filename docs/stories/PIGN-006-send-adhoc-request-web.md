# PIGN-006 — Send an ad-hoc HTTP request (web fetch)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-006 | 1 — First request | MVP | Todo | PIGN-004, PIGN-005 |

## Goal
The first end-to-end vertical slice: type a method + URL in a single scratch request editor, press Send, see status, time, size, and raw body — using the shared execution pipeline and the browser `FetchTransport`.

## User story
As a developer, I want to send a GET/POST to a URL and see the response, so Pigeon is useful from day one.

## Context
- Execution pipeline & types: [api-execution.md §1–2, §7.2](../api-execution.md).
- Request model: [data-model.md §4](../data-model.md#4-collection-folder-request).

## Scope
**In scope**
- `core/model`: initial `Request`, `Url`, `KeyValue`, `Body` (`none` + `raw` text only for now) types and `createRequest()` factory. Add **zod** to `core`.
- `core/execution`: `prepareRequest(request, ctx)` (method, URL parse/validate, headers, raw body), `RequestExecutor.execute()` calling `platform.transport.send()`, `normalizeResponse()` (content type, text decode via `TextDecoder` + charset, size, JSON parse attempt), `ExecutionResult`.
- `platform-web`: `FetchTransport` (method, headers, body, `AbortSignal`, `redirect: 'follow'`, `cache: 'no-store'`); basic error mapping (`TypeError` → `cors-suspected`; full classification in PIGN-011).
- `ui`: scratch request editor in the main area (method select, URL input, Send button, `Cmd/Ctrl+Enter`), response panel showing status line (code + text, colour), time, size, and raw body text. Loading state.
- Scratch request lives in a UI store in memory only.
- Desktop temporarily uses `MockTransport`-free path: desktop platform's transport is `FetchTransport` until PIGN-007 (acceptable because Tauri webview has fetch; CORS applies until then).

**Out of scope**
- Params/headers tables (PIGN-008), bodies other than raw text (PIGN-009), pretty viewer (PIGN-010), cancel/timeouts (PIGN-011), projects/persistence.

## Acceptance criteria
- [ ] Sending `GET http://localhost:4010/json/user` from the web app shows `200 OK`, a time in ms, a size in bytes/KB, and the JSON text.
- [ ] Sending `POST /echo` with a raw text body shows the echoed body.
- [ ] Invalid URL shows a validation error without calling the transport.
- [ ] Sending to `/cors/none` shows an error card with kind `cors-suspected` (text can be minimal).
- [ ] `core` execution code has no DOM or Tauri imports.

## Technical notes
- `prepareRequest` must be pure and synchronous-looking (`async` is fine) — it will grow in PIGN-008/009/023/026.
- Measure time around `transport.send` in the transport (`timings.totalMs`), not in UI.
- Default headers: `User-Agent: Pigeon/<version>` is set by core but dropped by FetchTransport (forbidden in some browsers) — add the "dropped header" warning mechanism now (`warnings: string[]`).

## Files / components likely affected
`packages/core/src/model/request.ts`, `packages/core/src/execution/{prepare,executor,response}.ts`, `packages/platform-web/src/fetch-transport.ts`, `packages/ui/src/features/request-editor/*`, `packages/ui/src/features/response-viewer/*`.

## Tests required
- Unit: `prepareRequest` (URL validation, method uppercase, headers passthrough), `normalizeResponse` (charset decode, JSON detection, size).
- Integration: executor + MockTransport.
- Playwright: send to test server `/json/user` and `/cors/none` (3 browsers).

## Definition of done
Standard DoD.
