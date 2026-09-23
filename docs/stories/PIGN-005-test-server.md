# PIGN-005 — Local HTTP test server

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-005 | 0 — Foundation | MVP | Todo | PIGN-001 |

## Goal
A deterministic local HTTP server (`@pigeon/test-server`) used by unit, integration, E2E, and Rust tests, so no test depends on the public internet.

## User story
As a contributor, I want a local server with predictable endpoints, so request-execution tests are fast and reliable on every OS.

## Context
Endpoint list: [testing.md §3.5](../testing.md#35-request-execution).

## Scope
**In scope**
- `packages/test-server` using `node:http` (no framework, or a tiny one such as `h3` — keep dependencies light).
- Endpoints: `/echo` (JSON reflection of method, path, query, headers, raw body as text/base64, parsed urlencoded/multipart parts incl. file names/sizes), `/json/:shape` (fixed bodies: `user`, `users`, `nested`, `types`), `/status/:code`, `/delay/:ms`, `/redirect/:n`, `/redirect-to?url=&status=`, `/cookies/set?name=value`, `/cookies`, `/gzip`, `/bytes/:n`, `/large/:mb`, `/unicode`, `/auth/basic?user=&pass=`, `/auth/bearer?token=`, `/graphql` (small schema: `user(id)`, `users`, error case), `/cors/none`, `/cors/allow-all` (incl. preflight + expose headers), `/cors/preflight-required`.
- API: `startTestServer({ port?: 0 }) → { url, close() }`; CLI `pnpm --filter @pigeon/test-server start` (fixed port 4010 by default, env override) for E2E and Rust tests.
- Unit tests for each endpoint using `fetch` from Node.

**Out of scope**
- HTTPS/self-signed endpoints (add in PIGN-011 if needed for TLS tests).

## Acceptance criteria
- [ ] Every endpoint above responds as documented in a `README.md` in the package.
- [ ] Server starts on an ephemeral port for unit tests and on 4010 for E2E.
- [ ] Tests pass on macOS, Windows, Linux.
- [ ] Playwright config can start it as a `webServer`.

## Technical notes
- Multipart parsing: use `busboy` (small, well known) or Node's `Request.formData()` via undici.
- All responses deterministic (no dates, no random ids) except `/delay`.
- All endpoints except `/cors/none` and `/cors/preflight-required` send permissive CORS headers (allow any origin/method/header, expose all headers, answer `OPTIONS`) so the web app can call them from the Vite preview origin in E2E tests. `/cors/none` sends no CORS headers (used to test CORS error UX).

## Files / components likely affected
`packages/test-server/**`, `playwright.config.ts`.

## Tests required
Unit tests per endpoint group.

## Definition of done
Standard DoD.
