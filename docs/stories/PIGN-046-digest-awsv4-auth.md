# PIGN-046 — Digest & AWS SigV4 auth

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-046 | 9 — Later | Later | Done | PIGN-042 |

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
- [x] Both types pass against test server endpoints on desktop; digest on web behaves as documented.
- [x] Postman fixtures with these auth types round-trip unchanged.
- [x] SigV4 matches AWS reference test vectors.

## Technical notes
- Use WebCrypto HMAC-SHA256 (works in browser/Tauri/Node).

## Files / components likely affected
`packages/core/src/execution/auth/{digest,awsv4}.ts`, `packages/formats/src/postman/auth.ts`, `packages/ui/src/features/request-editor/AuthTab/*`, test server.

## Tests required
Unit (AWS vectors, digest computation), integration with test server.

## Definition of done
Standard DoD.

## Implementation notes
- **Model**: `digest` (username, password, realm, nonce, algorithm, qop, nonceCount, clientNonce, opaque) and `awsv4` (accessKey, secretKey, region, service, sessionToken, addAuthDataToQuery) are typed in `ProjectAuth` and the core schema. Postman params map 1:1. Unchanged auth is written back verbatim, and edits change the params array in place (booleans stay booleans), so the golden auth project and Postman fixtures round-trip unchanged.
- **Execution**: both handlers return `deferred`; `prepareRequest` records it and the executor applies it to the final request.
  - SigV4 (`auth/awsv4.ts`, WebCrypto HMAC-SHA256) signs `host`, `x-amz-*` and `content-type`, never headers a transport or browser may change. The path is normalized and encoded once more for services other than s3. The body hash is used for byte bodies; multipart/file bodies are `UNSIGNED-PAYLOAD`. It adds the session token, and signs in the query string when `addAuthDataToQuery` is on. The secret key, token and signature are masked.
  - Digest (`auth/digest.ts`): MD5 is implemented in TypeScript because WebCrypto has none; SHA-256 uses WebCrypto. It supports `-sess` variants and `qop=auth` (`auth-int` not supported). It answers a 401 challenge and resends, or signs the first request when realm and nonce are set (Postman's preemptive mode). In a browser without an exposed `WWW-Authenticate` there is a clear warning.
- **Reference checks**: AWS's `get-vanilla` test-suite vector and the IAM ListUsers documentation example produce the published signatures. MD5 matches RFC 1321 values, and the Digest answer matches the RFC 2617 §3.5 example.
- **Test server**: `/auth/digest?user&pass&algorithm` (challenge + verification with node:crypto) and `/auth/awsv4` (independent SigV4 verification with `AWS_TEST_KEYS`, header or presigned).
- **UI**: Auth tab editors for "Digest Auth" (with advanced fields folded away) and "AWS Signature", with the literal-secret hint.
- **Tests**: reference vectors; through NodeTransport against the test server: Digest MD5 and SHA-256 (wrong password stays 401), SigV4 plain, with body and session token, presigned (wrong secret → 403). UI: Digest challenge retry and an AWS-signed send from the Auth tab. Playwright (3 browsers): both against the test server.
- `pnpm test:perf`'s open-project budget failed during this story's final run (2.4–3.7 s) while the machine's load average was 12–14; nothing here touches that path.
