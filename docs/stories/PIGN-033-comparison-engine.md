# PIGN-033 — Comparison engine: inference & structural diff

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-033 | 7 — Comparison | MVP | Done | PIGN-001 |

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
- [x] All situations in response-comparison §4.3 have at least one test case with expected findings and severities.
- [x] `compare(x, x)` is pass for arbitrary JSON (property test).
- [x] 1,000-element array with one missing field in every element yields exactly one finding with `count: 1000`.
- [x] Inference of objects is key-order independent.
- [x] 5 MB JSON inference + comparison < 300 ms (perf test, `pnpm test:perf`).
- [x] Package has zero runtime dependencies.

## Technical notes
- Iterative traversal (explicit stack) to avoid recursion limits on deep JSON.
- Keep `Finding` shape exactly as data-model §7.2 (including `count` / `examplePaths` for de-duplicated findings).

## Files / components likely affected
`packages/compare/src/{infer,path,diff,result,types}.ts`, `packages/compare/test/**`.

## Tests required
Table-driven + property + perf tests.

## Definition of done
Standard DoD.

## Implementation notes
- `@pigeon/compare` (no runtime dependencies): `inferSchema` (iterative with an explicit stack; array elements merged into `items` with per-key `seen`/`of`; sorted types and keys, so object key order doesn't matter; `emptyArray`, plus `someEmpty` when some baseline arrays at a place were empty and others not; `distinguishIntegers`), `compareJson` (structural table of response-comparison §4.3, iterative; findings de-duplicated by kind + `schemaPath` with `count` and the first 3 concrete paths), `summarize` (outcome fail > warn > pass; counts per severity), paths (`keySegment`, `parsePath`, `formatPath`, `toSchemaPath`, `matchPath` with `[*]`, `.*`, `..name` and an `orBelow` option for rules in PIGN-035).
- Two refinements found by the property test (`compare(x, x)` must pass): an implicitly optional key (only some baseline elements had it) is reported only when no actual object at that place has it — an element without it is normal; and an empty actual array is not reported where the baseline also had empty arrays (`someEmpty`, added to the SchemaNode in data-model §7.1). response-comparison §4.3 documents both.
- Messages: "Field removed (was string)", "Field added (boolean)", "Type changed from number to string", "Value is null (was string)", "Baseline had null; type unknown (now string)", "Widened from integer to number", "No baseline items to compare", "Empty array (…)".
- Tests: table-driven cases in `packages/compare/test/cases/*.json` (every §4.3 situation, integers, de-duplication), inference and path tests (including 20,000-deep nesting and `__proto__` keys), fast-check properties (self-comparison finds nothing over 1,000 random JSON values with and without `distinguishIntegers`; key-order independence; array elements match their merged items), the 1,000-element `count: 1000` case. `pnpm test:perf` (new root script and `vitest.perf.config.ts`; `*.perf.test.ts` are excluded from `pnpm test`) checks a 5 MB body (18,000 users) inferred and compared in under 300 ms (best of 3; ≈30 ms here). `fast-check` is a dev dependency only.
