# PIGN-034 — Compare response against baseline (UI)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-034 | 7 — Comparison | MVP | Todo | PIGN-027, PIGN-033 |

## Goal
After each send, automatically compare the response body to the request's baseline example and show Pass/Warn/Fail plus findings in a Compare tab.

## User story
As a developer, I want every response checked against my saved example, so I notice schema changes without reading JSON by eye.

## Context
- Baseline selection `auto`: [response-comparison.md §2](../response-comparison.md#2-baseline-selection).
- Compare view UX: [ui-ux.md §3.7](../ui-ux.md#37-comparison--diff-view).

## Scope
**In scope**
- `core/comparison/comparison-service.ts`: `compareExecution(request, result, projectDefaults) → ComparisonResult | NoBaseline`, baseline `auto` only (first example with same code, else first), JSON body comparison via `@pigeon/compare` with project default body settings; content-type category mismatch / parse failure findings (response-comparison §3.3 items 1 & 4).
- Runs in a Web Worker in the UI (shared worker helper) for large bodies.
- Results stored in project store and `LocalProjectState.lastComparisons` (bounded).
- Status line badge: ✓ Pass / ⚠ Warn / ✗ Fail / — No baseline (click → Compare tab).
- **Compare** tab: header (outcome, counts, baseline name), findings list grouped by section and sorted by severity, row shows schemaPath + count, message, baseline → actual; "Show in body" scrolls the Pretty view to the path.
- Side-by-side baseline vs actual JSON view with gutter markers (+ / − / ~), synchronized scrolling, click-to-sync from findings.
- ★ baseline marker on the chosen example in explorer and Examples tab.
- Preference: auto-compare on send (default on).

**Out of scope**
- Rules and row actions (PIGN-035), status/headers/value mode (PIGN-036), baseline switching and accept (PIGN-037).

## Acceptance criteria
- [ ] Save `/json/user` as example; change test server shape (use `/json/user-v2` fixture endpoint with removed + added + type-changed fields) and send via a request whose URL is edited → Compare shows fail with the three findings.
- [ ] Request without examples shows "No baseline — Save as example to start tracking".
- [ ] HTML response vs JSON baseline → contentType changed fail, body not compared.
- [ ] 5 MB comparison doesn't block typing in the editor.
- [ ] Works on web and desktop.

## Technical notes
- Add `/json/user-v2` (and similar variant shapes) to the test server for E2E.
- Cache schema snapshots by `sourceHash` (example body hash + settings).

## Files / components likely affected
`packages/core/src/comparison/*`, `packages/ui/src/features/compare/*`, `packages/ui/src/workers/compare.worker.ts`, `packages/ui/src/features/response-viewer/StatusLine.tsx`, `packages/test-server/src/json-shapes.ts`.

## Tests required
- Unit: baseline auto-selection, service outcomes.
- Component: findings list grouping/sorting.
- Playwright: fail/pass flows.

## Definition of done
Standard DoD.
