# PIGN-056 — JSON Schema export of snapshots

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-056 | 9 — Later | Later | Todo | PIGN-035 |

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
- [ ] Exported schema validates the baseline body and the actual bodies that pass comparison (ajv tests on fixtures).
- [ ] A body that fails comparison due to a removed required field fails schema validation.

## Technical notes
- Keep mapping documented in response-comparison.md (add a short section).

## Files / components likely affected
`packages/compare/src/json-schema.ts`, `packages/ui/src/features/compare/*`, `docs/response-comparison.md`.

## Tests required
Unit + ajv cross-check tests.

## Definition of done
Standard DoD.
