# PIGN-005 — Local HTTP test server

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-005 | 0 — Foundation | MVP | Done | PIGN-001 |

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
- [x] Every endpoint above responds as documented in a `README.md` in the package.
- [x] Server starts on an ephemeral port for unit tests and on 4010 for E2E.
- [x] Tests pass on macOS, Windows, Linux.
- [x] Playwright config can start it as a `webServer`.

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

## Implementation notes

- **Package**: `packages/test-server` is plain `node:http`. Its only dependency is `graphql` (17.0.2, pinned below the newest release so pnpm's minimum-release-age check passes without an exemption). Using the reference implementation gives `/graphql` real validation and introspection, which PIGN-055 can reuse. Multipart is parsed with undici's `Request.formData()`, so `busboy` isn't needed.
- **API**: `startTestServer({ port = 0, host = '127.0.0.1' }) → { url, port, close() }`. It binds loopback only. `close()` also drops open keep-alive connections and pending `/delay` requests. Also exported: `DEFAULT_PORT` (4010), `USERS`, `GRAPHQL_SCHEMA`, `GRAPHQL_ERROR_MESSAGE`, `LIMITS`, and the `EchoResponse` types.
- **CLI**: `pnpm --filter @pigeon/test-server start` runs `node --experimental-strip-types src/cli.ts`. That's Node's built-in type stripping, so there's no build step or `tsx`, and it works on Node 22.12+. For that to work, `src` imports use `.ts` specifiers (`rewriteRelativeImportExtensions`) and only erasable syntax (`erasableSyntaxOnly`). `PIGEON_TEST_SERVER_PORT` / `PIGEON_TEST_SERVER_HOST` override the port and host.
- **Endpoint behaviour the story left open** (all documented in the package README):
  - `/echo` returns both the combined `headers` and the ordered, case-preserving `rawHeaders`. `parsed` is a tagged union (`json` / `urlencoded` / `multipart` / `invalid`), and file parts carry `sha256`.
  - `/redirect/:n` ends at `/echo` and takes `?status=`, which applies to every hop.
  - `/cookies/set` answers `200` with `Set-Cookie` headers instead of redirecting, so Set-Cookie visibility is easy to test.
  - `/auth/basic` defaults to `user`/`pass`. `/auth/bearer` without `?token=` accepts any token.
  - `/large/:mb` is a JSON array of at least the requested size.
  - `/gzip` pins the OS byte of the gzip header, so the bytes match on every OS.
- **CORS**: permissive endpoints echo `Origin` (with `Allow-Credentials`) rather than sending `*`, because `*` doesn't work for credentialed requests. For the same reason they list the exposed headers explicitly. `/cors/preflight-required` allows simple requests but approves no non-simple methods or headers in a preflight, so a preflighted request is blocked. `OPTIONS` without the preflight headers goes to the endpoint, so `/echo` can reflect it.
- **Determinism**: `sendDate = false` (no `Date` header). All bodies are fixed; `/json/types` is raw text so it keeps a >2^53 integer and `1.0`.
- **Playwright**: `webServer` is now an array (vite preview + test server on 4010). The URL comes from `e2e/test-server.ts`. `e2e/web/test-server.spec.ts` checks in all three engines that the preview origin can call the server: a preflighted `PUT` succeeds, custom headers are exposed, and `/cors/none` plus a preflighted request to `/cors/preflight-required` are blocked.
- **Lint**: `packages/test-server` is in the ESLint workspace table with no internal dependencies. Node built-ins are allowed; React and Tauri are not.
- **Tests**: 72 Vitest cases across echo, content (json/unicode/gzip/bytes/large), flow (status/delay/redirects/404), cookies and auth, GraphQL, CORS, and server lifecycle + CLI (spawned with `PIGEON_TEST_SERVER_PORT=0`). They run in the existing `verify` matrix (macOS/Windows/Linux).
- **Follow-up**: Rust tests start using the server in PIGN-007, and `transportConformance` in PIGN-006/007. The first package whose *tests* import `@pigeon/test-server` (e.g. NodeTransport tests) has to allow it in the test-file override of the ESLint boundary rules.
