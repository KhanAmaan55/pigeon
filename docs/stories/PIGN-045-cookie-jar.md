# PIGN-045 — Cookie jar & cookie manager

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-045 | 9 — Later | Later | Done | PIGN-042 |

## Goal
A per-project cookie jar on desktop (store `Set-Cookie`, send matching `Cookie`), a cookie manager UI, and clearly limited behaviour on web.

## User story
As a developer testing session-based APIs, I want cookies to persist between requests like a browser, so login flows work.

## Context
- Web cookie limits: [platform.md §6.2](../platform.md#62-making-api-requests-cors-and-friends).

## Scope
**In scope**
- `core/cookies/`: RFC 6265 jar (use `tough-cookie` if it runs without Node built-ins, else a small implementation) keyed per project; persisted in local state (never in project files).
- Executor: add `Cookie` header from jar (unless user header present), store `Set-Cookie` from `RawResponse` (desktop only — `canReadAllResponseHeaders`).
- Response **Cookies** tab (desktop); cookie manager dialog (list by domain, add/edit/delete, clear all).
- Web: per-request "Send browser cookies" toggle (`credentials: 'include'`), manager hidden with explanation.
- Request setting "Don't use cookie jar".

**Out of scope**
- `pm.cookies` (future), importing browser cookies.

## Acceptance criteria
- [x] `/cookies/set?session=abc` then `/cookies` echoes `session=abc` on desktop.
- [x] Cookies isolated per project.
- [x] Web toggle sends browser cookies to a same-site test origin.

## Technical notes
- Cookie timestamps are local-only data; fine to store.

## Files / components likely affected
`packages/core/src/cookies/*`, `packages/core/src/execution/executor.ts`, `packages/ui/src/features/cookies/*`.

## Tests required
Unit (jar rules: domain, path, expiry, secure), integration with test server, E2E desktop.

## Definition of done
Standard DoD.

## Implementation notes
- **Jar** (`core/cookies/jar.ts`): a small RFC 6265 implementation instead of `tough-cookie` (no dependency, no Node built-ins). It handles `Set-Cookie` parsing (Domain, Path, Max-Age over Expires, Secure, HttpOnly, SameSite), host-only vs domain cookies, domain and path matching, expiry, deletion by a past expiry, ordering (longest path first, then oldest), and limits (50 per domain, 3,000 in all). There is no public-suffix list: a `Domain` without a dot (`com`) is refused, as is a domain the host doesn't belong to. Secure cookies are only accepted from https or localhost.
- **Per project**: `ProjectSession.cookieJar` is loaded from local state (`cookies`) and saved with `saveCookies()`. It is never in project files. Each project has its own jar; the scratch request has none.
- **Executor**: `ExecutionContext.cookies` adds a `Cookie` header after preparing, unless the request sets its own Cookie header or has **Don't use cookie jar** (Postman's `protocolProfileBehavior.disableCookies`, round-tripped). It stores the final response's `Set-Cookie` where the platform can read it (`canReadAllResponseHeaders`: desktop and Node). **Limitation**: Set-Cookie on redirect hops the transport followed is not seen; documented in api-execution.md. reqwest already had no cookie store of its own.
- **UI**: editor sends and regression runs use the project's jar. Settings tab: "Use the project's cookie jar" on desktop, "Send browser cookies" on the web (`_pigeon.includeCredentials` → `credentials: 'include'` in FetchTransport). The response **Cookies** tab (desktop) shows how the jar read each `Set-Cookie` (ignored ones marked). The **cookie manager** (palette "Manage cookies…", or the Cookies tab) lists cookies by domain, with add, edit, delete, clear per domain and clear all. On the web it explains that the browser owns cookies and links to the updated Web limitations section.
- **Tests**: jar rules (parsing, foreign and top-level domains, secure, domain/host-only/path/expiry matching, replace and delete, limits). Integration through NodeTransport against `@pigeon/test-server`: `/cookies/set?session=abc` then `/cookies` echoes `session=abc`, a second project's jar is empty, `disableCookies` sends nothing, cookies land in local state, and browser capabilities leave the jar unused. UI: store, send, Cookies tab, manager delete. Playwright (3 browsers): "Send browser cookies" stores and sends cookies to `localhost:4010` (same site as the app), off by default; the manager's web message. Desktop smoke: a cookie set by `/smoke/cookie-set` is sent with the next request (macOS; Windows/Linux in CI).
