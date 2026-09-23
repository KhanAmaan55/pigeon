# PIGN-052 — Optional self-hosted CORS proxy (web)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-052 | 9 — Later | Later | Todo | PIGN-039, PIGN-040 |

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
- [ ] With the proxy running, a web request to `/cors/none` succeeds and shows all headers.
- [ ] Requests without the token are rejected; non-allowlisted origins are rejected.
- [ ] Capabilities UI reflects proxy mode.

## Technical notes
- Reuse `NodeTransport` from `platform-node` inside the proxy for identical semantics.

## Files / components likely affected
`packages/cors-proxy/**`, `packages/platform-web/src/proxy-transport.ts`, `packages/ui/src/features/settings/*`, `docs/platform.md`.

## Tests required
Proxy unit/integration tests, Playwright with proxy running.

## Definition of done
Standard DoD.
