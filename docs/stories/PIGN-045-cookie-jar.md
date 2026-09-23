# PIGN-045 — Cookie jar & cookie manager

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-045 | 9 — Later | Later | Todo | PIGN-042 |

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
- [ ] `/cookies/set?session=abc` then `/cookies` echoes `session=abc` on desktop.
- [ ] Cookies isolated per project.
- [ ] Web toggle sends browser cookies to a same-site test origin.

## Technical notes
- Cookie timestamps are local-only data; fine to store.

## Files / components likely affected
`packages/core/src/cookies/*`, `packages/core/src/execution/executor.ts`, `packages/ui/src/features/cookies/*`.

## Tests required
Unit (jar rules: domain, path, expiry, secure), integration with test server, E2E desktop.

## Definition of done
Standard DoD.
