# PIGN-026 — Auth (basic, bearer, API key) with inheritance

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-026 | 4 — Auth | MVP | Todo | PIGN-025 |

## Goal
Configure auth at collection, folder, and request level with Postman inheritance semantics; execute noauth, Basic, Bearer, and API key; preserve all other auth types verbatim.

## User story
As a developer, I want to set a bearer token once on the collection and have every request inherit it, so I don't repeat auth everywhere.

## Context
- Auth model & inheritance: [data-model.md §4.1](../data-model.md#41-auth).
- Handlers: [api-execution.md §4](../api-execution.md#4-auth-handlers).
- Postman auth mapping (v2.1 arrays, v2.0 objects): [compatibility.md §A.1–A.2](../compatibility.md#a2-importexport-mapping).

## Scope
**In scope**
- `formats/src/postman/auth.ts`: v2.1 auth ⇄ domain (`basic`, `bearer`, `apikey` typed; others `unsupported` with params preserved, including param `type` fields).
- `core/execution/auth/`: registry + handlers; effective auth resolution walking ancestors; variables resolved in auth fields; explicit user header wins over generated header (+ warning).
- Request/folder/collection **Auth** tab: type selector (Inherit from parent, No auth, Basic, Bearer, API Key, and read-only "Unsupported: <type>" if present); shows effective inherited source ("Inherited from collection Users API: Bearer").
- Literal-credential hint (from PIGN-025) on password/token/value fields.
- Timeline shows generated `Authorization` masked.

**Out of scope**
- Digest, AWS SigV4 (PIGN-046), OAuth 2.0 (PIGN-047), others.

## Acceptance criteria
- [ ] Collection bearer `{{token}}` → request with Inherit sends `Authorization: Bearer <resolved>` (`/auth/bearer` returns 200).
- [ ] Folder `noauth` stops inheritance for its children.
- [ ] Basic with UTF-8 username/password encodes correctly (`/auth/basic`).
- [ ] API key in query adds the param; in header adds the header.
- [ ] A request with `oauth2` auth (from fixture) round-trips byte-identical through read/serialize and shows "not supported yet" with a warning on send.

## Technical notes
- Store auth in request files exactly as Postman v2.1 (`{"type":"bearer","bearer":[{"key":"token","value":"…","type":"string"}]}`).

## Files / components likely affected
`packages/formats/src/postman/auth.ts`, `packages/core/src/model/auth.ts`, `packages/core/src/execution/auth/*`, `packages/ui/src/features/request-editor/AuthTab.tsx`, `packages/ui/src/features/collection-settings/*`.

## Tests required
- Unit: mapping for every auth type in the fixture, inheritance resolution, handler outputs.
- Transport conformance: basic/bearer endpoints.
- Playwright: inherited bearer.

## Definition of done
Standard DoD. Milestone **M3** reached.
