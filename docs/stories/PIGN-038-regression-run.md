# PIGN-038 — Collection/folder regression run & report

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-038 | 7 — Comparison | MVP | Done | PIGN-037 |

## Goal
Run all requests in a collection or folder sequentially with one environment, compare each to its baseline, and present a regression report with bulk accept and JSON export.

## User story
As a developer before a release, I want to run my whole collection and see which endpoints changed shape, so I can catch regressions in one click.

## Context
- Runs: [response-comparison.md §7](../response-comparison.md#7-regression-runs-pign-038).
- Runner UI: [ui-ux.md §3.10](../ui-ux.md#310-runner-pign-038).
- Runner module: [architecture.md §3.6](../architecture.md#36-runner-corerunner).

## Scope
**In scope**
- `core/runner/runner.ts`: `run({ scope, environmentId, stopOnFail, onlyWithBaseline, signal }) → AsyncIterable<RunEvent>` and final `RunReport`; uses the same executor + comparison service; sequential; cancellable.
- `RunReport` stored in local state (last 20) and in `projects/<id>/runs/<runId>.json` on desktop (bounded, file-format §6).
- Run dialog (from explorer context menu "Run folder/collection" and Runner activity view): scope, environment, stop on first failure, only requests with baselines.
- Live run view: per-request row (method, name, status, time, outcome badge), progress bar, cancel; click a row → opens request tab with that execution result and comparison.
- Summary: totals per outcome, duration, environment, transport; **Accept selected as baselines** (bulk PIGN-037 accept); **Export report (JSON)** via `platform.files.saveFile`.
- Secrets masked in stored reports.

**Out of scope**
- Iteration data files, parallel execution, JUnit output (CLI, PIGN-054), script tests (PIGN-044).

## Acceptance criteria
- [x] Running a fixture collection of 10 requests against the test server produces a report with correct outcomes (mix of pass/warn/fail/no-baseline).
- [x] Stop-on-first-fail stops after the first fail; Cancel stops mid-run and marks the rest "skipped".
- [x] Bulk accept updates selected examples as drafts; re-run passes.
- [x] Exported JSON matches a documented `RunReport` schema (add to data-model.md).
- [x] 200-request run on web and desktop keeps the UI responsive.

## Technical notes
- Runner is framework-agnostic and will be reused by the CLI (PIGN-054) — no UI imports.

## Files / components likely affected
`packages/core/src/runner/*`, `packages/ui/src/features/runner/*`, `packages/core/src/model/run-report.ts`, `docs/data-model.md`.

## Tests required
- Unit/integration: runner with MockTransport (ordering, stop, cancel, report).
- Playwright: run a folder, view report, export.

## Definition of done
Standard DoD. Milestone **M5** reached.

## Implementation notes
- **Core** — `core/runner/runner.ts`: `runTargets(model, scopeId, { onlyWithBaseline })` (explorer order, broken files left out) and `runRegression(targets, deps, options)`, an async generator of `started` / `request-started` / `request-finished` events that returns the `RunReport`. Sending and comparing are injected (`RunDeps`), so the CLI (PIGN-054) can reuse it with no UI imports. Stop on first failure stops after a `fail` or `error`; Cancel aborts the in-flight request and marks the rest `skipped`. `rememberRunReport` keeps the last 20 (`RUN_REPORTS_LIMIT`).
- **Schema** — `RunReport` / `RunEntry` are documented in data-model.md §7.3 (`pigeonRunReport: 1`). Entries carry finding counts, not findings; URLs are the masked ones from the result, and an entry whose URL had a secret too short to mask has no `url`.
- **Storage (deviation)** — reports live in the project's local state (`runReports` in `state.json`, IndexedDB on web), not in `projects/<id>/runs/<runId>.json`: they are small (counts, no findings or bodies), so one bounded list is simpler and works the same on web and desktop. file-format.md §6 updated.
- **UI** — `features/runner/runner-store.ts` (one runner per open project): builds each request's execution context like the editor (variables of the *chosen* environment, inherited auth, skipped scripts) and compares through the same helper as the editor (`features/compare/compare-request.ts`, which the editor registry now uses too). Results stay in memory for the live run: clicking a row opens the request tab with that result and comparison (`showResult` on the tab's editor store). **Accept selected as baselines** applies `acceptedExamplePatch` per row (volatile headers dropped, the send's secrets masked) as `updateExample` drafts. The run yields a macrotask between requests and rows are memoized, so long runs keep the window responsive (UI test with 200 requests).
- Run dialog from the explorer menu (**Run collection… / Run folder…**) and the Runner view (**New run…**); the live run and reports show in a **Runner** tab (`$runner`). The Runner view lists recent runs; a past run opens read-only.
- **Tests** — core: ordering and outcome mix over 10 requests, only-with-baseline, stop on first failure, cancel, bulk accept → re-run passes, bounded reports. UI: run a collection (pass/fail/no-baseline/error), open a row, accept selected, re-run, export, past reports; 200-request run with the event loop ticking. Playwright (all three browsers): run a folder against the test server, open a row; export download checked in Firefox/WebKit (Chromium uses the native save picker).
- Responsiveness with 200 requests verified in jsdom (and the yield is platform-independent); not measured by hand in the desktop app.
