# PIGN-036 — Status, headers & value-mode comparison

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-036 | 7 — Comparison | MVP | Done | PIGN-035 |

## Goal
Complete the comparison sections: status code rules, header comparison, value mode (with array matching and dynamic fields), and non-JSON bodies.

## User story
As a developer, I want status codes, key headers, and (optionally) exact values checked, so a regression run catches everything I care about.

## Context
- Spec: [response-comparison.md §3.1, §3.2, §3.3, §4.4, §5](../response-comparison.md#3-what-is-compared).

## Scope
**In scope**
- `compare/src/status.ts`: `exact` / `class` / `ignore`.
- `compare/src/headers.ts`: names case-insensitive, `compare` list, `ignore`, modes `media-type` / `value` / `presence`; `headersRestricted` downgrade to warn with "hidden by browser".
- Value mode in `diff.ts`: scalar equality, `arrays: 'index' | { matchBy } | 'schema'`, `body.array.length`, `dynamic` rule skips value checks.
- Non-JSON bodies: text exact equality in values mode; info finding in schema mode; binary equality by hash.
- Dynamic-value hints (UUID, ISO date, unix timestamp, JWT, long hex) → "Mark as dynamic?" row action (hint only).
- UI: per-request overrides in the rules panel (status mode, header list/mode, body mode, array matching); Status and Headers sections in findings list.

**Out of scope**
- XML structural compare, tolerances/regex matchers (future).

## Acceptance criteria
- [x] 200 vs 201 fails in `exact`, passes in `class`.
- [x] `Content-Type: application/json; charset=utf-8` vs `application/json` passes in `media-type` mode.
- [x] On web, a compared header hidden by CORS produces warn (not fail).
- [x] Values mode: changed `name` fails; with `dynamic` on `$.updatedAt` a changed timestamp passes; `matchBy: 'id'` handles reordered arrays.
- [x] Text body in values mode detects a change; schema mode reports info only.

## Technical notes
- Keep section comparators independent; `compareResponse()` orchestrates and merges findings.

## Files / components likely affected
`packages/compare/src/{status,headers,diff,text,hints,index}.ts`, `packages/core/src/comparison/comparison-service.ts`, `packages/ui/src/features/compare/*`.

## Tests required
- Table-driven cases per section; hint detection tests; Playwright for one values-mode flow.

## Definition of done
Standard DoD.

## Implementation notes
- `@pigeon/compare`, one comparator per section: `compareStatus` (exact / class / ignore), `compareHeaders` (case-insensitive names, `compare` list, `ignore`, modes media-type / value / presence; header findings carry the lowercase name as `path`; a missing header is a warning "may be hidden by the browser" when the response's headers are restricted), `compareValues` (values mode on top of the structural pass: scalars must be equal; arrays by `index` with length checks, by `{ matchBy }` key with added/removed elements, or `schema` to skip; type changes are left to the structural comparator; iterative), `compareText` / `compareBinary` (values mode: exact text / hash + size; schema mode: info), `dynamicHint` (UUID, ISO date, unix seconds/ms, JWT, long hex) attached to value findings as `hint`.
- Core `compareResponseInput(input, effective)` orchestrates status, headers and body, then applies the rules; the plain-data input now carries statuses, headers (example headers, enabled only), `headersRestricted` and binary hashes. `effectiveComparison` merges `status`, `headers` (`compare`, `mode`, `ignore`) and body (`mode`, `additionalFields`, `distinguishIntegers`, `arrays`) from `pigeon.json` and `compare.json`. The worker runs the same function.
- UI: findings list shows Status and Headers sections; rule actions only for body paths; value findings offer **Mark dynamic**, labelled **Mark as dynamic?** when a hint says the value looks generated (hint only). The rules panel has the request's overrides (status mode, compared headers and mode, body mode, array matching with the key); "project default" removes an override (an empty `compare.json` is deleted). While a comparison re-runs the tab keeps showing the last result (it used to collapse to "Comparing…", which closed the rules panel being edited).
- Tests: per-section tables (status, headers incl. CORS warning, values incl. matchBy and dynamic, text/binary, hints) and a values-mode self-comparison property; core acceptance cases through `compareExecution`; UI flow (status finding, overrides, Mark as dynamic?, committed `compare.json`); E2E values mode against `/echo` (schema passes, values fails) in Chromium, Firefox and WebKit.
- Test infrastructure: the commit planner's strict 100 ms budget (PIGN-019) moved to `pnpm test:perf` (`packages/core/test/perf/`); the normal suite keeps the same scenario with a loose 1 s guard, since parallel runs on a busy machine made the strict check flaky.
