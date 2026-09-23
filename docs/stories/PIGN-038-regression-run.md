# PIGN-038 — Collection/folder regression run & report

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-038 | 7 — Comparison | MVP | Todo | PIGN-037 |

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
- [ ] Running a fixture collection of 10 requests against the test server produces a report with correct outcomes (mix of pass/warn/fail/no-baseline).
- [ ] Stop-on-first-fail stops after the first fail; Cancel stops mid-run and marks the rest "skipped".
- [ ] Bulk accept updates selected examples as drafts; re-run passes.
- [ ] Exported JSON matches a documented `RunReport` schema (add to data-model.md).
- [ ] 200-request run on web and desktop keeps the UI responsive.

## Technical notes
- Runner is framework-agnostic and will be reused by the CLI (PIGN-054) — no UI imports.

## Files / components likely affected
`packages/core/src/runner/*`, `packages/ui/src/features/runner/*`, `packages/core/src/model/run-report.ts`, `docs/data-model.md`.

## Tests required
- Unit/integration: runner with MockTransport (ordering, stop, cancel, report).
- Playwright: run a folder, view report, export.

## Definition of done
Standard DoD. Milestone **M5** reached.
