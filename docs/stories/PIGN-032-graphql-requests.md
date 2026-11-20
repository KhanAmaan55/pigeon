# PIGN-032 — GraphQL requests

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-032 | 6 — GraphQL | MVP | Done | PIGN-023 |

## Goal
First-class GraphQL over HTTP: query editor, variables JSON editor, operation name, Postman `graphql` body mode compatibility, and a GraphQL-aware response view.

## User story
As a developer building a GraphQL API, I want to write queries with variables and see `data`/`errors` clearly, so I can debug GraphQL as easily as REST.

## Context
- Protocol handler: [api-execution.md §6](../api-execution.md#6-protocol-handlers).
- Postman mapping (`body.mode: graphql`): [compatibility.md §A.2](../compatibility.md#a2-importexport-mapping).

## Scope
**In scope**
- `Body.graphql { query, variables, operationName? }` in model + Postman mapping (Postman stores `variables` as a string; `operationName` preserved in `extra` if Postman lacks it — store under `_pigeon.operationName` otherwise; document the choice in compatibility.md).
- `protocols/graphql.ts`: POST JSON body; GET mode encodes params in the query string; `variables` must be valid JSON (validation error otherwise); variables resolved (`{{var}}`) in query and variables text.
- "New GraphQL request" action (creates POST request with graphql body).
- Body tab for graphql mode: query editor (CodeMirror GraphQL syntax via `cm6-graphql` or a simple mode), variables JSON editor side by side, operation name input (auto-detected when the document has multiple operations — user picks).
- Response: when protocol is GraphQL, a summary chip shows `errors: N` even for HTTP 200; errors list rendered above the body.
- Explorer badge `GQL` instead of `POST`.

**Out of scope**
- Introspection, schema-aware autocomplete (PIGN-055), subscriptions (future).

## Acceptance criteria
- [x] Query against test server `/graphql` returns data; a query producing errors shows the errors chip and list.
- [x] Invalid variables JSON blocks sending with an inline error.
- [x] GraphQL fixture imports and exports round-trip.
- [x] Works on desktop and web (test server has CORS).

## Technical notes
- Operation detection: lightweight regex/tokenizer for `query|mutation|subscription Name` — no full GraphQL parser needed yet.

## Files / components likely affected
`packages/core/src/model/body.ts`, `packages/core/src/execution/protocols/graphql.ts`, `packages/formats/src/postman/body.ts`, `packages/ui/src/features/request-editor/BodyTab/GraphqlBody.tsx`, `packages/ui/src/features/response-viewer/GraphqlSummary.tsx`.

## Tests required
- Unit: graphql prepare (POST/GET), variables validation, mapping.
- Playwright: send query, see errors.

## Definition of done
Standard DoD. Milestone **M4** reached.

## Implementation notes
- Model: body mode `graphql { query, variables (JSON text), operationName? }` in formats and core (`BODY_MODES`, `emptyBody`). Postman mapping: `graphql.query` / `graphql.variables` (string; objects from other tools become text), unknown `graphql` keys kept; the operation name is stored in the item's `_pigeon.operationName` unless the file already keeps `graphql.operationName` (documented in compatibility §A.2). The old "unsupported body" path now only covers truly unknown modes.
- Execution: `meta.protocol = 'graphql'`; variables are resolved in the query and variables text; `graphqlVariablesError` blocks sending (`invalid-request`) for invalid JSON or a non-object; POST sends `{"query","variables","operationName"}` with the variables text inserted as written (big numbers keep their digits) and `Content-Type: application/json`; GET puts `query`, `variables`, `operationName` in the query string and sends no body. `graphqlOperations` (lightweight tokenizer skipping strings, block strings and comments; depth-0 operations, shorthand `{ }` counts as an anonymous query) and `interpretGraphql` (`data`, `errors` with path/locations) in `core/execution/graphql.ts`.
- UI: Body tab mode **GraphQL** with a query editor (a small CodeMirror stream mode for GraphQL), a JSON variables editor side by side with an inline error, and an operation name field that becomes a picker when the document has several named operations. Response: `errors: N` chip next to the actions and the error list (message, path, locations) above the body. Explorer context menu **New GraphQL request** (POST, empty GraphQL body); GraphQL requests show `GQL` in the explorer.
- Tests: mapping (operation name placement, object variables), prepare POST/GET/validation, operation detection, response interpretation, UI flow (invalid variables block sending, errors chip and list), E2E against the test server's `/graphql` (data and a deliberate error) in Chromium, Firefox and WebKit. The GraphQL fixture round-trips through import/export (PIGN-029 suite). Desktop uses the same core path through the native transport.
