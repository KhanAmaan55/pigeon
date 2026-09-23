# PIGN-032 — GraphQL requests

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-032 | 6 — GraphQL | MVP | Todo | PIGN-023 |

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
- [ ] Query against test server `/graphql` returns data; a query producing errors shows the errors chip and list.
- [ ] Invalid variables JSON blocks sending with an inline error.
- [ ] GraphQL fixture imports and exports round-trip.
- [ ] Works on desktop and web (test server has CORS).

## Technical notes
- Operation detection: lightweight regex/tokenizer for `query|mutation|subscription Name` — no full GraphQL parser needed yet.

## Files / components likely affected
`packages/core/src/model/body.ts`, `packages/core/src/execution/protocols/graphql.ts`, `packages/formats/src/postman/body.ts`, `packages/ui/src/features/request-editor/BodyTab/GraphqlBody.tsx`, `packages/ui/src/features/response-viewer/GraphqlSummary.tsx`.

## Tests required
- Unit: graphql prepare (POST/GET), variables validation, mapping.
- Playwright: send query, see errors.

## Definition of done
Standard DoD. Milestone **M4** reached.
