# PIGN-036 — Status, headers & value-mode comparison

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-036 | 7 — Comparison | MVP | Todo | PIGN-035 |

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
- [ ] 200 vs 201 fails in `exact`, passes in `class`.
- [ ] `Content-Type: application/json; charset=utf-8` vs `application/json` passes in `media-type` mode.
- [ ] On web, a compared header hidden by CORS produces warn (not fail).
- [ ] Values mode: changed `name` fails; with `dynamic` on `$.updatedAt` a changed timestamp passes; `matchBy: 'id'` handles reordered arrays.
- [ ] Text body in values mode detects a change; schema mode reports info only.

## Technical notes
- Keep section comparators independent; `compareResponse()` orchestrates and merges findings.

## Files / components likely affected
`packages/compare/src/{status,headers,diff,text,hints,index}.ts`, `packages/core/src/comparison/comparison-service.ts`, `packages/ui/src/features/compare/*`.

## Tests required
- Table-driven cases per section; hint detection tests; Playwright for one values-mode flow.

## Definition of done
Standard DoD.
