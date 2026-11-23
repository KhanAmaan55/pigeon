# PIGN-047 — OAuth 2.0 auth

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-047 | 9 — Later | Later | Done | PIGN-046 |

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
- [x] Client credentials against a test-server token endpoint works on web and desktop.
- [x] Auth code + PKCE works on desktop with a test-server authorize page.
- [x] Tokens never appear in project files or exports.

## Technical notes
- Client secrets typed literally trigger the literal-credential hint (PIGN-025).

## Files / components likely affected
`packages/core/src/execution/auth/oauth2/*`, `apps/desktop/src-tauri/src/oauth_loopback.rs`, `packages/ui/src/features/request-editor/AuthTab/OAuth2.tsx`, `apps/web/public/oauth-callback.html`, test server.

## Tests required
Integration against test-server OAuth endpoints; E2E desktop auth-code flow.

## Definition of done
Standard DoD.

## Implementation notes
- **Model**: `oauth2` typed with Postman's param names (`grant_type`, `authUrl`, `accessTokenUrl`, `clientId`, `clientSecret`, `scope`, `state`, `redirect_uri`, `username`, `password`, `challengeAlgorithm`, `code_verifier`, `client_authentication`, `addTokenTo`, `headerPrefix`, `accessToken`, `tokenName`). Unknown params are kept, and unchanged auth is written verbatim, so the golden fixtures still round-trip.
- **core** (`execution/auth/oauth2.ts`): `requestToken` (client credentials, password, authorization code, refresh; form body; client credentials as Basic, RFC 6749 §2.3.1 encoding, or in the body; JSON or form answers; the server's `error`/`error_description` in messages), `pkcePair` (S256 or plain), `authorizationUrl`, and `ensureToken`: a valid cached token, else a refresh, else (client credentials / password) a new token on send, else a token Postman saved in the file, else a warning pointing to "Get new token". Tokens are treated as expired 30 s early. The handler defers to the executor, which adds `Authorization: <prefix> <token>` (a user Authorization header wins, with a warning) or `?access_token=`, and masks the token, client secret and password. A failed token request fails the send with the reason.
- **Token cache**: `ProjectSession.oauthTokens` keeps tokens in the secret store (scope `oauth2`, keyed by grant, token URL, client and scope). They are never in project files, local state or exports (tested).
- **Browser step** (`Platform.oauth`): desktop `src-tauri/src/oauth.rs` binds a loopback listener (`oauth_begin`, honouring a loopback redirect URI's port and path), opens the system browser (`oauth_complete`, http/https only) and returns the redirect's parameters; it ignores stray requests and times out after 5 minutes. In `--smoke` runs it follows the authorize page itself. Web: popup + `apps/web/public/oauth-callback.html`/`.js` (external script, as the CSP requires), which posts to the opener (same origin only) and closes. The state is checked on return.
- **UI**: the "OAuth 2.0" editor in the Auth tab: grant type, URLs, client, scope, redirect URI, PKCE method, client authentication, token placement and prefix. The token panel has Get new token, Refresh and Clear, a status line (obtained, expiry, refreshable), and the redirect URI to register.
- **Test server**: `/oauth/authorize` (auto-approves, redirects with code + state, records the PKCE challenge), `/oauth/token` (all grants, S256/plain PKCE verification, single-use refresh tokens, `?expires_in=`), `/oauth/protected`.
- **Tests**: core through NodeTransport: client credentials on send and cached, body client auth and query placement, password grant with refresh after expiry, authorization code + PKCE with a simulated browser, wrong secret, tokens absent from files, local state and exports. Rust: loopback URI parsing; the listener returns the redirect's parameters after a stray request. Playwright (3 browsers): client credentials on send, then authorization code + PKCE through the real popup and callback page. Desktop smoke (macOS): the seeded request's authorization code + PKCE flow through the loopback listener, and the token sent with the next request.
- **Not done**: the implicit grant and device code (out of scope). Postman's "tokenName" token list is not modelled (one token per grant/URL/client/scope).
