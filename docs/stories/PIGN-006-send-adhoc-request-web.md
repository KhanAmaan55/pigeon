# PIGN-006 — Send an ad-hoc HTTP request (web fetch)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-006 | 1 — First request | MVP | Done | PIGN-004, PIGN-005 |

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
- [x] Sending `GET http://localhost:4010/json/user` from the web app shows `200 OK`, a time in ms, a size in bytes/KB, and the JSON text.
- [x] Sending `POST /echo` with a raw text body shows the echoed body.
- [x] Invalid URL shows a validation error without calling the transport.
- [x] Sending to `/cors/none` shows an error card with kind `cors-suspected` (text can be minimal).
- [x] `core` execution code has no DOM or Tauri imports.

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

## Implementation notes
- **Model** (`core/src/model/request.ts`): zod schemas with inferred types for `Request`, `Url`, `KeyValue`, `Body` (`none` + `raw`, all raw languages), `RequestSettings`; `createRequest()` validates through `RequestSchema`. Scratch requests have `fileKey: ''` until saved (PIGN-012/013). zod runs `jitless` (`core/src/model/zod.ts`): its `new Function` probe trips the CSP and Firefox logs that as a console error.
- **Execution** (`core/src/execution/`): `prepareRequest` validates the method (RFC 9110 token), URL (adds `http://` when no scheme is typed, http/https only, otherwise the typed URL is kept), header names/values, and GET/HEAD + body against `canSendBodyWithGet`; adds `User-Agent: Pigeon/<PIGEON_VERSION>`, `Accept: */*` and the raw body's `Content-Type` unless set. `RequestExecutor.execute()` never rejects; failures become `result.error`. `normalizeResponse` decodes with the header charset (unknown labels fall back to UTF-8), shows untyped bodies as text only if they are valid UTF-8, and parses JSON for `application/json`, `text/json` and `+json`.
- **Warnings / errors** (deviation, docs updated): `RawResponse.warnings?` and a `TransportError` class in `@pigeon/platform` carry dropped-header warnings and classified failures from transports to core. `ExecutionContext.projectId` is nullable for the scratch request. `NormalizedResponse.cookies` is left for PIGN-045.
- **FetchTransport** (`platform-web/src/fetch-transport.ts`): drops forbidden headers (and always `User-Agent`) with a warning each; refuses GET/HEAD with a body, `CONNECT`/`TRACE`/`TRACK` and invalid header values as `invalid-request` before calling fetch, so they are not misreported as CORS; `TypeError` → `cors-suspected` with a hint. Timing covers fetch + body read.
- **UI**: per-mount zustand store (`features/request-editor/scratch-store.ts`) provided by `ScratchRequestProvider`; a new send aborts and supersedes an in-flight one. The editor has a method select, URL input (Enter sends), a raw text body (empty = no body) and `Cmd/Ctrl+Enter` anywhere in the editor. Validation errors show in the response panel's error card (`data-kind`).
- **Desktop**: `createDesktopPlatform()` uses `FetchTransport` until PIGN-007; `platform-desktop` may import `platform-web` until then (ESLint rule + architecture.md §2). The desktop CSP (`tauri.conf.json` `connect-src`) still only allows IPC, so sends from the desktop app are blocked by the CSP until PIGN-007 or until `connect-src` is widened.
- **Tests**: core unit (`model`, `prepare`, `response`) and executor + MockTransport integration; FetchTransport unit tests with an injected fetch; UI component tests; Playwright `e2e/web/send-request.spec.ts` (3 browsers).
- **Follow-ups**: PIGN-007 removes the `platform-desktop → platform-web` dependency; PIGN-011 refines error classification (mixed content, timeouts) and Send → Cancel.
