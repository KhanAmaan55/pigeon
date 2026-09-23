# PIGN-033 — Comparison engine: inference & structural diff

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-033 | 7 — Comparison | MVP | Todo | PIGN-001 |

## Goal
A pure `@pigeon/compare` library that infers a schema snapshot from a baseline JSON body and structurally compares an actual JSON body against it, producing typed findings.

## User story
As a developer, I want Pigeon to tell me precisely which fields were added, removed, or changed type, so I can spot breaking API changes instantly.

## Context
- Full spec: [response-comparison.md §4](../response-comparison.md#4-json-comparator) (types, inference, structural table, de-duplication).
- Types: [data-model.md §7](../data-model.md#7-comparison).

## Scope
**In scope**
- `compare/src/infer.ts`: `inferSchema(json) → SchemaNode` with array item merge (`seen`/`of`), `emptyArray`, null handling, `distinguishIntegers` option.
- `compare/src/path.ts`: path formatting (concrete `$.a[3]["b.c"]` and schema `$.a[*]…`), parser + matcher for patterns (`$`, `.name`, `["…"]`, `[n]`, `[*]`, `.*`, `..name`) — matcher used by PIGN-035.
- `compare/src/diff.ts`: `compareJson(baselineSchema, actual, { additionalFields, distinguishIntegers }) → Finding[]` implementing the structural table (removed, implicitly-optional removed, added, type changed, null cases, empty arrays) with de-duplication by `schemaPath`+kind (`count`, first 3 paths).
- `compare/src/result.ts`: outcome & counts.
- Messages human-readable ("Field removed (was string)").
- Table-driven cases in `compare/test/cases/*.json` + property tests.

**Out of scope**
- Field rules (PIGN-035), status/headers/values (PIGN-036), UI (PIGN-034).

## Acceptance criteria
- [ ] All situations in response-comparison §4.3 have at least one test case with expected findings and severities.
- [ ] `compare(x, x)` is pass for arbitrary JSON (property test).
- [ ] 1,000-element array with one missing field in every element yields exactly one finding with `count: 1000`.
- [ ] Inference of objects is key-order independent.
- [ ] 5 MB JSON inference + comparison < 300 ms (perf test, `pnpm test:perf`).
- [ ] Package has zero runtime dependencies.

## Technical notes
- Iterative traversal (explicit stack) to avoid recursion limits on deep JSON.
- Keep `Finding` shape exactly as data-model §7.2 (including `count` / `examplePaths` for de-duplicated findings).

## Files / components likely affected
`packages/compare/src/{infer,path,diff,result,types}.ts`, `packages/compare/test/**`.

## Tests required
Table-driven + property + perf tests.

## Definition of done
Standard DoD.
