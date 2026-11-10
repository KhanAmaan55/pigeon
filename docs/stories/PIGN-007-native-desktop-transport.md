# PIGN-007 — Native desktop HTTP transport

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-007 | 1 — First request | MVP | Done | PIGN-003, PIGN-006 |

## Goal
Desktop sends requests through a Rust `http_send` command (reqwest), bypassing CORS and forbidden-header limits, with identical behaviour on macOS, Windows, and Linux.

## User story
As a desktop user, I want to call any API without CORS restrictions and with full control over headers, so Pigeon behaves like a real API client.

## Context
- D-03: [architecture.md §11](../architecture.md#11-technical-decisions). **Confirm before starting.**
- Transport spec: [api-execution.md §7.1](../api-execution.md#71-desktop--rust-http_send-all-three-oses).
- Capabilities: [platform.md §4](../platform.md#4-capability-matrix).

## Scope
**In scope**
- Rust `src-tauri/src/http.rs`: `http_send(req) -> RawResponse` and `http_cancel(id)`. reqwest with rustls, gzip/brotli/deflate/zstd decoding, redirect policy `none` + manual follow loop recording hops (method rewrite rules for 301/302/303 vs 307/308), timeout, `danger_accept_invalid_certs` when `strictSSL=false`, raw ordered header list (multi-value), TTFB + total timing, HTTP version string, body as binary IPC response.
- One reqwest client per project id (map keyed by id; default key for scratch).
- `platform-desktop`: `NativeTransport` implementing `Transport` via `invoke`; bytes transfer without base64 (use `tauri::ipc::Response` / `Channel` for body).
- Desktop capabilities updated: `transport: 'native'`, `bypassesCors`, `canSetAnyHeader`, `canReadAllResponseHeaders`, `canControlRedirects`, `canDisableTlsVerification`, `canSendBodyWithGet`, `detailedTimings`.
- Response status line shows a transport badge (Native / Browser).

**Out of scope**
- Multipart and file bodies (PIGN-009 extends the command), cookie handling (PIGN-045), proxies, client certificates.

## Acceptance criteria
- [x] Desktop request to `/cors/none` succeeds (no CORS error).
- [x] Custom `Host` and `Cookie` headers reach `/echo` unchanged.
- [x] Duplicate response headers (e.g. two `Set-Cookie`) are both visible.
- [x] `/redirect/3` returns the final response and 3 recorded hops.
- [x] `/gzip` body is decoded; size reflects decoded bytes.
- [x] A 50 MB `/large/50` response completes without freezing the UI (binary IPC, no base64). Transport measured in the macOS debug app: about 205 ms from invoke to `ArrayBuffer`, 0 ms to decode the frame, longest main-thread gap 32 ms. Showing 50 MB of text in the raw response `<pre>` is still slow; virtualized viewing is PIGN-010.
- [x] `cargo test` covers send, redirects, headers, timeout against the test server on all 3 CI OSes.

## Technical notes
- Serialize `PreparedRequest` with `serde`; keep field names identical to the TS types.
- Cancellation: store `AbortHandle`s in `State<Mutex<HashMap<String, AbortHandle>>>`.
- Add only the permissions needed for the custom commands in `capabilities/default.json`.
- Shared `transportConformance` suite (platform §8) should be introduced here with MockTransport + FetchTransport-in-Playwright; mirror its cases in `cargo test`.

## Files / components likely affected
`apps/desktop/src-tauri/src/{main.rs,http.rs}`, `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/capabilities/default.json`, `packages/platform-desktop/src/native-transport.ts`, `packages/platform-desktop/src/capabilities.ts`, `packages/platform/src/conformance/transport.ts`, `packages/ui/src/features/response-viewer/StatusLine.tsx`.

## Tests required
- `cargo test` (test server started by the test harness or CI step).
- `transportConformance` for MockTransport; Playwright run for FetchTransport.
- Manual: desktop dev run against `/cors/none` on at least one OS; CI build on all.

## Definition of done
Standard DoD plus: desktop build green on all three OS runners.

## Implementation notes
- **D-03 accepted**: custom `http_send`/`http_cancel` commands on reqwest 0.13 (rustls, HTTP/2, no system proxy, no cookie store). Spec details are in [api-execution.md §7.1](../api-execution.md#71-desktop--rust-http_send-all-three-oses).
- **Rust** (`src-tauri/src/http.rs`): `HttpState` (managed state) holds one `reqwest::Client` per `(projectId, strictSSL)` and the abort handles of in-flight requests. It runs a manual redirect loop that records hops, applies the 301/302/303 → GET and 307/308 keep rules, and drops credentials on cross-origin hops. The timeout covers the whole exchange, and a cancel that arrives before its send still aborts it. Bodies are capped at 100 MB, and errors are classified coarsely (PIGN-011 refines them).
- **Deviation, decompression**: reqwest's built-in decompression strips `Content-Encoding`/`Content-Length` from the response, so it is off. `http.rs` decodes gzip/deflate/br/zstd itself (on a blocking thread, honouring the size cap) and sends `Accept-Encoding: gzip, deflate, br, zstd` unless the request sets one. Headers stay exactly as sent.
- **IPC**: both directions use one binary frame, `[u32 LE JSON length][JSON][body]`, passed as a `Uint8Array` argument and returned as a `tauri::ipc::Response` (`ArrayBuffer` in JS). The response body is a view into that buffer. Command failures reject with `{ kind, message, detail? }`.
- **Permissions**: `build.rs` declares the app commands (`AppManifest`), which generates `allow-*` permissions. `capabilities/default.json` grants exactly `allow-http-send`, `allow-http-cancel` and `allow-smoke-report`. `main.rs` registers every command in one `invoke_handler`, because Tauri keeps only the last one; `smoke_report` is registered only with `--smoke`.
- **TS**: `NativeTransport` (`platform-desktop/src/native-transport.ts`, injectable `invoke`) rejects with `signal.reason` as soon as the signal aborts and sends `http_cancel` in the background. `DESKTOP_CAPABILITIES` moved to `capabilities.ts`. `platform-desktop` no longer depends on `platform-web` (ESLint boundary and architecture.md §2 updated). `PreparedRequest.meta.projectId` was added and is set by `prepareRequest` from `ctx.projectId`.
- **UI**: the status line moved to `response-viewer/StatusLine.tsx` and shows a transport badge, Native or Browser, with an explanatory tooltip (`data-testid="response-transport"`).
- **Conformance**: `transportConformanceCases(caps)` (21 framework-free cases, `@pigeon/platform/conformance/transport-cases`) plus a Vitest wrapper `transportConformance()`. They run against a MockTransport test-server double (Vitest) and against FetchTransport in Chromium, Firefox and WebKit (Playwright; every `fetch` runs in the page from the app's origin, so real CORS applies). FetchTransport's `timeout` case is an expected failure until PIGN-011. `cargo test` mirrors the cases (39 `http` tests). It starts `@pigeon/test-server` itself with Node on a free port, using the new `PIGEON_TEST_SERVER_EXIT_ON_STDIN_END` so the server never outlives the test binary, or uses `PIGEON_TEST_SERVER_URL`.
- **Smoke**: `--smoke` now also sends a request through the UI → `NativeTransport` → `http_send` to a local server without CORS headers that the smoke module starts. It requires `200 OK`, the Native badge and the body, so CI checks the IPC wiring and permissions on all three OSes. Verified locally on macOS.
- **Follow-ups**: PIGN-009 extends the frame with multipart/file bodies. PIGN-010 adds a viewer for large bodies. PIGN-011 adds hints, timeline and TLS tests, and makes FetchTransport honour `timeoutMs`. Header names go out lowercased over HTTP/1.1 (hyper's default); preserving the original case would need a raw-header hyper setup if users ask for it.
