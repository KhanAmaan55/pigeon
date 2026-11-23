# PIGN-052 — Optional self-hosted CORS proxy (web)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-052 | 9 — Later | Later | Done | PIGN-039, PIGN-040 |

## Goal
Let web users opt into routing requests through a **self-hosted** proxy they run (locally or on their infrastructure) to bypass CORS and forbidden-header limits — without any Pigeon-hosted backend.

## User story
As a web user whose API lacks CORS headers, I want to run a tiny local proxy and keep using Pigeon in the browser, so I'm not forced to install the desktop app.

## Context
- CORS limitations: [platform.md §6.2](../platform.md#62-making-api-requests-cors-and-friends). No cloud backend (product non-goal).

## Scope
**In scope**
- `packages/cors-proxy`: minimal Node server (`npx @pigeon/cors-proxy` style), binds to `127.0.0.1` by default, requires a random token printed on start, allowlist of Pigeon origins, forwards method/URL/headers/body (incl. forbidden headers via `x-pigeon-*` envelope), returns raw status/headers (incl. `Set-Cookie` in a JSON envelope) and body; no logging of bodies.
- `platform-web`: `ProxyTransport` selected per project in settings (URL + token); capabilities updated dynamically (`bypassesCors: true`, `canSetAnyHeader: true`, `canReadAllResponseHeaders: true`; redirects controllable if proxy does manual redirects).
- Security docs: threats of running a proxy (SSRF on your network), why token + localhost binding.
- CORS error card offers "Use a local proxy" with setup instructions.

**Out of scope**
- Hosted/public proxy (never), browser extension (future), desktop-as-agent (future).

## Acceptance criteria
- [x] With the proxy running, a web request to `/cors/none` succeeds and shows all headers.
- [x] Requests without the token are rejected; non-allowlisted origins are rejected.
- [x] Capabilities UI reflects proxy mode.

## Technical notes
- Reuse `NodeTransport` from `platform-node` inside the proxy for identical semantics.

## Files / components likely affected
`packages/cors-proxy/**`, `packages/platform-web/src/proxy-transport.ts`, `packages/ui/src/features/settings/*`, `docs/platform.md`.

## Tests required
Proxy unit/integration tests, Playwright with proxy running.

## Definition of done
Standard DoD.

## Implementation notes

- **`packages/cors-proxy`**: `startProxy` / `proxyHandler` (`src/server.ts`) and the CLI (`src/cli.ts`, options and `PIGEON_PROXY_*` env vars). Bundled by Vite (SSR build) into one Node script `dist/cli.js` (`bin: pigeon-cors-proxy`); `pnpm --filter @pigeon/cors-proxy start` builds and runs it. It forwards with `NodeTransport` from `platform-node` (multipart files through a per-request `PickedFileStore`). Instead of an `x-pigeon-*` header envelope, the whole request travels as a JSON envelope (`POST /v1/forward`), which carries forbidden headers, duplicates and binary bodies (base64) the same way; the response comes back the same way with every header (`Set-Cookie` included). Protocol types live in `@pigeon/platform` (`cors-proxy.ts`). Security model and threats in [platform.md §6.2.1](../platform.md#621-optional-self-hosted-cors-proxy-pign-052) and the package README.
- **Web**: `ProxyTransport` + `WebCorsProxy` (`platform-web/src/proxy-transport.ts`); `createWebPlatform` exposes `corsProxy`, a transport that delegates to fetch or the proxy per send, and a `capabilities` getter returning `proxyModeCapabilities` while on (`transport: 'proxy'` is a new `Capabilities['transport']` value; "no feature flips a capability" still holds — only the platform does, from the user's setting). `PlatformProvider` re-renders `useCapabilities()` consumers on changes (`useSyncExternalStore`).
- **UI**: Settings → **CORS proxy** (`CorsProxySettings.tsx`; per project in local app state `corsProxy`; Test button via `/v1/health`), `useCorsProxyActivation` (active project's setting on open, off without a project), status bar "Proxy mode", **Proxy** transport badge, and "Use a local proxy" on the web CORS error card.
- **Tests**: `cors-proxy/test/proxy.test.ts` (127.0.0.1 + random token, preflight, missing/wrong token, foreign/missing origin, `/cors/none` forwarding, forbidden headers and binary bodies, `Set-Cookie`, multipart files, error envelopes, non-http refused, no body logging), `platform-web/test/proxy-transport.test.ts`, `e2e/web/cors-proxy.spec.ts` (CORS failure → error card → settings → wrong token refused → proxy on → 200 with all headers and the Proxy badge → survives reload; 3 browsers; Playwright starts the proxy as a third web server).
