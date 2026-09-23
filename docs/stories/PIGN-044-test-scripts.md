# PIGN-044 — Test scripts & results

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-044 | 9 — Later | Later | Todo | PIGN-043 |

## Goal
Run Postman test scripts after responses (`pm.test`, `pm.expect`, `pm.response`) and show results in a Tests tab and in regression runs.

## User story
As a Postman user, I want my existing test scripts to run and report pass/fail, so Pigeon replaces Postman for my assertions too.

## Context
- [api-execution.md §9](../api-execution.md#9-scripts-later-pign-043044); runner [response-comparison.md §7](../response-comparison.md#7-regression-runs-pign-038).

## Scope
**In scope**
- `pm.response`: `code`, `status`, `headers.get()`, `json()`, `text()`, `responseTime`, `responseSize`, `to.have.status(n)`, `to.have.header(name)`.
- `pm.test(name, fn)` collecting results (pass/fail/error with message); `pm.expect` chai-style subset (`to.equal`, `eql`, `include`, `be.a/an`, `be.true/false/null/undefined`, `have.property`, `have.length`, `above/below`, `match`, `not`), implemented in the sandbox (bundle `chai` into QuickJS if feasible, else own subset — document).
- Test order: collection → folders → request.
- **Tests** tab in response panel with counts; status-line badge combines comparison and tests.
- Runner report includes test results; outcome = worst of comparison and tests (configurable).

**Out of scope**
- `pm.sendRequest`, `pm.visualizer`, `pm.cookies`, `postman.setNextRequest`.

## Acceptance criteria
- [ ] Scripts fixture tests run with expected pass/fail counts.
- [ ] A throwing test is reported as error, others still run.
- [ ] Runner shows test failures per request.

## Technical notes
- Keep assertion library inside the sandbox; only results cross the boundary.

## Files / components likely affected
`packages/core/src/scripting/*`, `packages/ui/src/features/response-viewer/TestsTab.tsx`, `packages/core/src/runner/*`.

## Tests required
Unit per `pm.expect` matcher, fixture-based integration, E2E.

## Definition of done
Standard DoD.
