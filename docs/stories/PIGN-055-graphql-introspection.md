# PIGN-055 — GraphQL introspection & autocomplete

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-055 | 9 — Later | Later | Todo | PIGN-032 |

## Goal
Fetch a GraphQL schema via introspection (or load an SDL file) and provide schema-aware autocomplete, validation, and a docs explorer in the query editor.

## User story
As a GraphQL developer, I want autocomplete and inline validation from the schema, so I write correct queries faster.

## Context
- GraphQL protocol handler: [api-execution.md §6](../api-execution.md#6-protocol-handlers).

## Scope
**In scope**
- "Fetch schema" action: runs the standard introspection query through the normal executor (same auth/variables); caches the schema per request URL in local state (not committed).
- Optional schema file: `schemaFile` (project-relative SDL/JSON) stored under `_pigeon.graphql.schemaFile` in the request file — committed, so teams share it.
- CodeMirror GraphQL language service (`cm6-graphql` + `graphql` package): autocomplete, hover docs, validation diagnostics; variables editor validation against operation variable types.
- Schema docs side panel (types, fields, search).

**Out of scope**
- Subscriptions, federation-specific features.

## Acceptance criteria
- [ ] Introspection against the test server enables autocomplete for `user`/`users` fields.
- [ ] Invalid field shows a diagnostic.
- [ ] Schema cache survives restart; clearing works.
- [ ] `graphql` package is lazy-loaded (not in the initial bundle).

## Technical notes
- Large schemas: build the schema in a Worker.

## Files / components likely affected
`packages/ui/src/features/request-editor/BodyTab/GraphqlBody.tsx`, `packages/core/src/execution/protocols/graphql.ts`, `packages/ui/src/features/graphql-docs/*`, `packages/formats/src/project/*`.

## Tests required
Unit (introspection handling), component (autocomplete), E2E.

## Definition of done
Standard DoD.
