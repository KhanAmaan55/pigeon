# PIGN-055 — GraphQL introspection & autocomplete

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-055 | 9 — Later | Later | Done | PIGN-032 |

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
- [x] Introspection against the test server enables autocomplete for `user`/`users` fields.
- [x] Invalid field shows a diagnostic.
- [x] Schema cache survives restart; clearing works.
- [x] `graphql` package is lazy-loaded (not in the initial bundle).

## Technical notes
- Large schemas: build the schema in a Worker.

## Files / components likely affected
`packages/ui/src/features/request-editor/BodyTab/GraphqlBody.tsx`, `packages/core/src/execution/protocols/graphql.ts`, `packages/ui/src/features/graphql-docs/*`, `packages/formats/src/project/*`.

## Tests required
Unit (introspection handling), component (autocomplete), E2E.

## Definition of done
Standard DoD.

## Implementation notes

- **Packages** (approved download): `cm6-graphql` 1.0.0 and `graphql-language-service` 6.0.1 (plus `debounce-promise` and `vscode-languageserver-types`); `graphql` 17 and `@codemirror/autocomplete` were already in the lockfile and became direct `@pigeon/ui` dependencies.
- **Lazy loading**: everything that imports graphql lives in `ui/src/features/graphql/runtime.ts`, reached only through `loadGraphqlRuntime()` (dynamic import). The rest of the UI uses `import type` only. `apps/web/scripts/check-bundle.ts` now fails a build whose initial JavaScript contains graphql (it is in a ~240 KB lazy chunk; the initial bundle grew by ~4 KB of UI code). The GraphQL editor always uses cm6-graphql's parser now; the hand-written stream highlighter (`CodeEditor/graphql-language.ts`) is gone.
- **Introspection**: core `introspectionRequest` / `introspectionFromResponse`; the scratch store's send context was factored into `context(withScripts)` and a new `introspect(query)` action sends with the request's headers, auth (inherited too), variables, cookies and OAuth tokens — without scripts, comparison or history.
- **Cache**: core `GraphqlSchemaCache` over `AppStateStore`, keyed by the request's raw URL without query string (no secrets end up in keys; requests with the same URL share it). Project requests use `project:<localKey>`, the scratch request `app`; last 20 URLs, up to 5 MB each (bigger results stay in memory for the open editor). Clear forgets one URL.
- **Schema file**: `_pigeon.graphql.schemaFile` (formats read/write, other keys under `_pigeon.graphql` kept), SDL or introspection JSON (`{ __schema }` or `{ data: { __schema } }`); it takes precedence over introspection, and a missing or invalid file is explained in the status line.
- **Editor**: cm6-graphql completion and lint (graphql validation), `autocompletion()`, a lint gutter, hover docs via graphql-language-service `getHoverInformation`, Cmd/Ctrl+click → docs panel. Variables are checked with graphql's `getVariableValues` against the chosen operation (a warning; only invalid JSON blocks sending, as before).
- **Docs panel** (`GraphqlDocs.tsx`): root types, all types, one type with fields/arguments/descriptions/deprecations, enum values, union members and interfaces, search over type and field names; it renders a plain `DocsModel` built in the runtime.
- **Worker note**: the story suggested building large schemas in a Worker. A `GraphQLSchema` is a graph of class instances and can't be posted back from a Worker, and cm6-graphql needs it on the main thread, so the schema is built once per load on the main thread (not per keystroke).
- **Tests**: core (introspection request/answer, cache persistence across instances, clear, LRU), formats (schemaFile round trip), UI (fetch through the request context, cache in app state, diagnostics, variable checks, docs, clear, introspection refused, schema file from a project, runtime builders), bundle guard, e2e in Chromium, Firefox and WebKit against the test server (autocomplete offers `user`/`users`, an unknown field gets a diagnostic, hover, docs, the schema is back after a reload, clear). The UI Vitest config pins `graphql` to one build: graphql 17 ships development and production builds, and mixing them in Node tests gives "another realm" errors (browser builds are unaffected).
