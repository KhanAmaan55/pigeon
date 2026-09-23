# PIGN-046 — Digest & AWS SigV4 auth

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-046 | 9 — Later | Later | Todo | PIGN-042 |

## Goal
Execute Postman `digest` and `awsv4` auth types (currently preserved-only), with UI editors.

## User story
As a developer calling AWS APIs or legacy digest-protected services, I want these auth types to work, so I don't need Postman for them.

## Context
- Auth handlers: [api-execution.md §4](../api-execution.md#4-auth-handlers); mapping [compatibility.md §A.2](../compatibility.md#a2-importexport-mapping).

## Scope
**In scope**
- Digest: handler performs challenge round trip (first request → 401 `WWW-Authenticate` → retry with `Authorization: Digest …`), MD5/SHA-256, `qop=auth`; needs access to transport (extend `AuthHandler` context). Desktop full; web only if the server exposes `WWW-Authenticate` via CORS (document).
- AWS SigV4: sign final method/URL/headers/body hash (access key, secret key, session token, region, service); Postman param names preserved.
- Typed domain models + editors; params map 1:1 to Postman arrays.
- Test server endpoints `/auth/digest`, `/auth/awsv4` (verifies signature with known test keys).

**Out of scope**
- NTLM, Hawk, Akamai EdgeGrid, OAuth1 (future).

## Acceptance criteria
- [ ] Both types pass against test server endpoints on desktop; digest on web behaves as documented.
- [ ] Postman fixtures with these auth types round-trip unchanged.
- [ ] SigV4 matches AWS reference test vectors.

## Technical notes
- Use WebCrypto HMAC-SHA256 (works in browser/Tauri/Node).

## Files / components likely affected
`packages/core/src/execution/auth/{digest,awsv4}.ts`, `packages/formats/src/postman/auth.ts`, `packages/ui/src/features/request-editor/AuthTab/*`, test server.

## Tests required
Unit (AWS vectors, digest computation), integration with test server.

## Definition of done
Standard DoD.
