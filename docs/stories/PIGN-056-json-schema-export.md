# PIGN-056 — JSON Schema export of snapshots

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-056 | 9 — Later | Later | Done | PIGN-035 |

## Goal
Export a baseline's inferred schema snapshot (with field rules applied) as JSON Schema (draft 2020-12), for use in contract tests or documentation.

## User story
As a developer, I want the response shape Pigeon learned exported as JSON Schema, so I can reuse it in other tools and tests.

## Context
- Schema snapshot: [data-model.md §7.1](../data-model.md#71-schema-snapshot-derived-local); rules [response-comparison.md §4.5](../response-comparison.md#45-field-rules).

## Scope
**In scope**
- `compare/src/json-schema.ts`: `toJsonSchema(snapshot, rules) → object`: types → `type` (arrays for unions), properties → `properties` + `required` (keys seen in all elements and not `optional`), `nullable` → add `"null"`, `ignore` → `{}` (any), `items` from merged items, `additionalProperties` omitted (open) unless `additionalFields: 'fail'` → `false`.
- UI: Compare tab / example menu → "Export JSON Schema" (save file); copy to clipboard.
- Deterministic key order in output.

**Out of scope**
- Validating responses against arbitrary JSON Schema/OpenAPI (future), committing schema files automatically.

## Acceptance criteria
- [x] Exported schema validates the baseline body and the actual bodies that pass comparison (ajv tests on fixtures).
- [x] A body that fails comparison due to a removed required field fails schema validation.

## Technical notes
- Keep mapping documented in response-comparison.md (add a short section).

## Files / components likely affected
`packages/compare/src/json-schema.ts`, `packages/ui/src/features/compare/*`, `docs/response-comparison.md`.

## Tests required
Unit + ajv cross-check tests.

## Definition of done
Standard DoD.

## Implementation notes

- **`compare/src/json-schema.ts`**: `toJsonSchema(root, { rules, additionalFields, title, description })` (draft 2020-12, iterative like inference). The design rule: the schema rejects what schema-mode comparison *fails* and accepts what only warns — so beyond the story's mapping, `integer` is exported as `number` (integer → number warns), a null-only baseline is `{}`, `type` rules add types (`any` → `{}`), keys only some array elements had are not required, and arrays get no `minItems` (an empty array is `info`). Rule paths with concrete indices don't match snapshot `[*]` paths and are ignored. Mapping table in response-comparison.md §4.7.
- **Core**: `exampleJsonSchema(model, request, example)` infers the example body with the request's effective comparison (project + request rules, `distinguishIntegers`, `additionalFields`), adds a title and description, and names the file `<request>-<example>.schema.json`.
- **UI**: `JsonSchemaActions` (Copy JSON Schema / Export JSON Schema, `application/schema+json`) in the example view toolbar and in the Compare tab header for the baseline; JSON examples only.
- **Tests**: `compare/test/json-schema.test.ts` — mapping, determinism, rules, the removed-required-field case, an ajv cross-check on all 23 comparison cases (schema verdict equals comparison verdict) and fast-check properties (a value validates against its own schema; whatever comparison passes validates, 500 random pairs). `ajv` (already in the lockfile, used by formats) became a compare devDependency. Core and UI tests for the export; e2e in all three browsers (download checked in Firefox and WebKit; Chromium uses the native save picker).
