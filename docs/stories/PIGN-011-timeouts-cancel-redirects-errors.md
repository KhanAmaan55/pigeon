# PIGN-011 — Timeouts, cancel, redirects & network errors

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-011 | 1 — First request | MVP | Todo | PIGN-007, PIGN-010 |

## Goal
Robust request lifecycle: cancel in-flight requests, timeouts, redirect settings, and clear, platform-aware error messages (especially CORS and mixed content on web).

## User story
As a developer, I want to cancel slow requests and understand why a request failed, so I don't waste time guessing.

## Context
- Error kinds and classification: [api-execution.md §2, §7.2, §8](../api-execution.md#8-cancellation-timeouts-concurrency).
- Web limitations table: [platform.md §6.2](../platform.md#62-making-api-requests-cors-and-friends).

## Scope
**In scope**
- Send button becomes **Cancel** while in flight; `Esc` cancels; sending again cancels the previous execution.
- `RequestSettings`: `timeoutMs`, `followRedirects`, `maxRedirects`, `strictSSL`; request **Settings** tab with these controls; unsupported ones disabled with tooltip (`canControlRedirects`, `canDisableTlsVerification`).
- Global default timeout preference (in-memory until PIGN-018), default 30 s; `0` = none.
- Error classification: desktop maps reqwest errors → `timeout`, `dns`, `connection-refused`, `tls`, `network`; web maps `AbortError`/timeout, `mixed-content` (page origin https + target http non-localhost), otherwise `cors-suspected`.
- Error card component: kind title, message, hint, raw detail (collapsible). CORS hint explains CORS in 3 sentences and suggests desktop app / enabling CORS on the server; mixed-content hint suggests running Pigeon web locally or desktop.
- **Timeline** tab (desktop): resolved request line, request headers (secrets masked — masking helper stub), redirect hops, TTFB/total.
- Add HTTPS self-signed endpoint to test server for TLS tests (`startTestServer({ https: true })` with a generated cert fixture).

**Out of scope**
- Proxy settings, client certificates, retry policies.

## Acceptance criteria
- [ ] `/delay/5000` can be cancelled; result shows "Cancelled", no error card spam.
- [ ] Timeout of 1000 ms on `/delay/3000` shows a `timeout` error on web and desktop.
- [ ] Desktop: `followRedirects=false` on `/redirect/1` shows the 302 response with `Location`; `maxRedirects=2` on `/redirect/5` shows a "too many redirects" error.
- [ ] Desktop: self-signed HTTPS fails with `tls` error; succeeds with `strictSSL=false`.
- [ ] Web: `/cors/none` shows CORS card with hint; a simulated mixed-content case is classified correctly (unit test with injected origin).
- [ ] Settings tab disables redirect/TLS controls on web with an explanatory tooltip.

## Technical notes
- Classification lives in `core/execution/errors.ts` (inputs: transport error code + context) so web/desktop share wording.
- `http_cancel` from PIGN-007 is reused; ensure cancelled Rust futures don't leak.

## Files / components likely affected
`packages/core/src/execution/{errors,executor}.ts`, `packages/core/src/model/request.ts` (settings), `packages/platform-web/src/fetch-transport.ts`, `apps/desktop/src-tauri/src/http.rs`, `packages/ui/src/features/request-editor/SettingsTab.tsx`, `packages/ui/src/features/response-viewer/{ErrorCard,TimelineTab}.tsx`, `packages/test-server/src/https.ts`.

## Tests required
- Unit: error classification matrix.
- `cargo test`: timeout, redirect limits, TLS.
- Playwright: cancel flow, timeout, CORS card.

## Definition of done
Standard DoD. Milestone **M1** reached: requests work on web and desktop.
