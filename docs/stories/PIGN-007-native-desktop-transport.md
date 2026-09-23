# PIGN-007 — Native desktop HTTP transport

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-007 | 1 — First request | MVP | Todo | PIGN-003, PIGN-006 |

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
- [ ] Desktop request to `/cors/none` succeeds (no CORS error).
- [ ] Custom `Host` and `Cookie` headers reach `/echo` unchanged.
- [ ] Duplicate response headers (e.g. two `Set-Cookie`) are both visible.
- [ ] `/redirect/3` returns the final response and 3 recorded hops.
- [ ] `/gzip` body is decoded; size reflects decoded bytes.
- [ ] A 50 MB `/large/50` response completes without freezing the UI (binary IPC, no base64).
- [ ] `cargo test` covers send, redirects, headers, timeout against the test server on all 3 CI OSes.

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
