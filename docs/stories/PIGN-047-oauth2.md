# PIGN-047 — OAuth 2.0 auth

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-047 | 9 — Later | Later | Todo | PIGN-046 |

## Goal
Support Postman's `oauth2` auth: token acquisition (client credentials, password, authorization code with PKCE), token storage as local secrets, and header/query injection.

## User story
As a developer calling OAuth-protected APIs, I want Pigeon to get and refresh tokens for me, so I don't paste tokens by hand.

## Context
- Secrets: [file-format.md §7](../file-format.md#7-secrets). Tokens are local-only, never committed.

## Scope
**In scope**
- Map Postman `oauth2` params (grant type, auth/token URLs, client id/secret, scope, state, PKCE, `addTokenTo`, header prefix) to a typed model; unknown params preserved.
- Grant flows: client credentials and password (core, all platforms via transport); authorization code + PKCE: desktop opens the system browser and listens on a loopback redirect (`http://127.0.0.1:<port>/callback`, Rust side), web uses a popup + redirect page on the Pigeon origin (document that the redirect URI must be registered).
- Token cache per project in `SecretStore` (access, refresh, expiry); "Get new token", "Refresh", "Clear" in the Auth tab; auto-refresh when expired if refresh token exists.
- Token endpoint calls obey CORS on web (document).

**Out of scope**
- Implicit grant (deprecated), device code (future).

## Acceptance criteria
- [ ] Client credentials against a test-server token endpoint works on web and desktop.
- [ ] Auth code + PKCE works on desktop with a test-server authorize page.
- [ ] Tokens never appear in project files or exports.

## Technical notes
- Client secrets typed literally trigger the literal-credential hint (PIGN-025).

## Files / components likely affected
`packages/core/src/execution/auth/oauth2/*`, `apps/desktop/src-tauri/src/oauth_loopback.rs`, `packages/ui/src/features/request-editor/AuthTab/OAuth2.tsx`, `apps/web/public/oauth-callback.html`, test server.

## Tests required
Integration against test-server OAuth endpoints; E2E desktop auth-code flow.

## Definition of done
Standard DoD.
