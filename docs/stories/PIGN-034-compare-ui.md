# PIGN-034 — Compare response against baseline (UI)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-034 | 7 — Comparison | MVP | Done | PIGN-027, PIGN-033 |

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
- [x] Save `/json/user` as example; change test server shape (use `/json/user-v2` fixture endpoint with removed + added + type-changed fields) and send via a request whose URL is edited → Compare shows fail with the three findings.
- [x] Request without examples shows "No baseline — Save as example to start tracking".
- [x] HTML response vs JSON baseline → contentType changed fail, body not compared.
- [x] 5 MB comparison doesn't block typing in the editor.
- [x] Works on web and desktop.

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

## Implementation notes
- Core `comparison/comparison-service.ts`: `selectBaseline` (auto: first example with the response's status, else the first), `projectBodySettings` (`pigeon.json` `comparison.body`, invalid values fall back to the defaults: schema mode, additional fields warn, no integer split), `compareBodyTexts` (plain strings, worker-friendly: content-type category mismatch → `body.contentType.changed` fail and no body comparison; JSON that doesn't parse → `body.parse.failed` fail; text baselines → info "Text body not compared structurally"; JSON → `@pigeon/compare`), `compareExecution`, `comparisonResult`, `rememberComparison` (latest per request, at most 100). Schema snapshots are cached in memory by a hash of the baseline body and the settings (FNV-1a, 20 entries), never stored.
- UI: the request editor store runs the comparison after each send (preference **Compare responses with the baseline example after each send**, default on, persisted) and again after "Save as example". Bodies over 256 KB are compared in a Web Worker (`features/compare/compare.worker.ts`), smaller ones inline. Results go to the project store and `LocalProjectState.lastComparisons`.
- Status line badge ✓ Pass / ⚠ Warn / ✗ Fail / — No baseline (opens the Compare tab). **Compare** tab: outcome, counts, baseline name; findings grouped Status / Headers / Body and sorted by severity, with schema path and ×count, message, baseline → actual; **Show in body** (Body tab, Pretty view, scrolled to the line); **Compare** opens the side-by-side view (virtualized baseline and actual JSON with − / + / ~ markers, proportionally synchronized scrolling, both sides scroll to the selected finding). `indexJson` maps concrete and schema paths to lines of the pretty text.
- ★ marks the baseline example (the one the last comparison used, else the first) in the explorer and the Examples tab.
- Test server: `/json/user-v2` (email removed, nickname added, id a string).
- Tests: service (selection, outcomes, content type, parse failure, text, settings, bounded memory), line index, finding grouping, UI flow (no baseline → save example → pass → fail, findings, side by side markers, show in body, ★), the preference, E2E against the test server (pass, fail with three findings, HTML vs JSON) in Chromium, Firefox and WebKit, and a 5 MB comparison through the worker while typing (Chromium). Desktop uses the same UI and worker.
- Desktop smoke fix found while verifying: `--smoke` used the real app data directory, so it restored whatever project the user had open (the scratch editor it drives wasn't there) and could rewrite the user's `app.json`. Smoke runs now use a fresh temporary data directory (`data_dir.rs`, removed when the run ends); normal runs are unchanged.
- A UI test setup file (`packages/ui/test/setup.ts`) gives jsdom's `Range` empty `getClientRects` / `getBoundingClientRect`, which CodeMirror needs when scrolling to a line.
