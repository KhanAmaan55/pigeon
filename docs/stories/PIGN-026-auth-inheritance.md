# PIGN-026 — Auth (basic, bearer, API key) with inheritance

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-026 | 4 — Auth | MVP | Done | PIGN-025 |

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
- [x] Collection bearer `{{token}}` → request with Inherit sends `Authorization: Bearer <resolved>` (`/auth/bearer` returns 200).
- [x] Folder `noauth` stops inheritance for its children.
- [x] Basic with UTF-8 username/password encodes correctly (`/auth/basic`).
- [x] API key in query adds the param; in header adds the header.
- [x] A request with `oauth2` auth (from fixture) round-trips byte-identical through read/serialize and shows "not supported yet" with a warning on send.

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

## Implementation notes
- Formats: `ProjectAuth` is typed (`noauth`, `basic`, `bearer`, `apikey`; anything else `{ type: 'unsupported', authType }`) and keeps the Postman object it was read from in `source`. `authFromPostman` reads v2.1 arrays and v2.0 objects; `authToPostman` returns `source` untouched when nothing changed (byte-identical files, including non-string params like oauth2's `useBrowser: false`), otherwise edits the params array in place (unknown params, order and extra keys kept), omitting empty/default params; a type change writes a fresh v2.1 object. New golden fixture `packages/fixtures/projects/auth/` (bearer collection, basic with UTF-8 and an extra `showPassword` param, API key header/query, oauth2, digest, a v2.0-style basic, a `noauth` folder).
- Core: `Request.auth` (`AuthSchema`), `inheritedAuth(model, itemId)` walks folders (nearest first) then the collection and reports the origin; `noauth` stops it; a collection inherits nothing. Handlers in `execution/auth/` (registry; Basic = base64 of UTF-8 `user:pass`). `prepareRequest` uses `request.auth ?? ctx.inheritedAuth`, resolves variables in auth fields, lets a user header (or query param) of the same name win with a warning, rejects line breaks, and adds the credentials to `meta.secretValues` so results mask them. Unsupported types: sent without auth plus a warning. Commands: `setContainerAuth`; `updateRequest` with `auth: undefined` removes the key (Inherit).
- UI: shared `AuthEditor` (type selector with Inherit / No auth / Basic / Bearer / API Key and a read-only "Unsupported: <type>" entry; fields with variable highlighting; "Inherited from collection Users API: Bearer"; literal-credential hint on password/token/API key value; values typed for another type come back when switching back). Used by the request **Auth** tab (between Params and Headers, dot when the request has its own auth) and the collection/folder settings tab. The scratch request has no Inherit option.
- Transport conformance gained an `auth` case (`/auth/basic` with UTF-8 credentials, `/auth/bearer`), mirrored in `http/tests.rs`. Requests inheriting the basic fixture's bearer `{{token}}` now report `token` as unresolved (PIGN-023 UI test updated).
- E2E: inherited collection bearer against the test server in Chromium, Firefox and WebKit (browser workspace); the auth fixture folder (inherited bearer, UTF-8 Basic, back to Inherit → 401) in Chromium.
