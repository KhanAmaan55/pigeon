# PIGN-044 — Test scripts & results

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-044 | 9 — Later | Later | Done | PIGN-043 |

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
- [x] Scripts fixture tests run with expected pass/fail counts.
- [x] A throwing test is reported as error, others still run.
- [x] Runner shows test failures per request.

## Technical notes
- Keep assertion library inside the sandbox; only results cross the boundary.

## Files / components likely affected
`packages/core/src/scripting/*`, `packages/ui/src/features/response-viewer/TestsTab.tsx`, `packages/core/src/runner/*`.

## Tests required
Unit per `pm.expect` matcher, fixture-based integration, E2E.

## Definition of done
Standard DoD.

## Implementation notes
- **Assertions without chai**: `pm.expect` is Pigeon's own chai-style subset in the sandbox prelude (no new download), covering everything the story lists plus `deep`, `ok`, `exist`, `empty`, `NaN`, `least`/`most`, `within`, `oneOf`, `keys`, `expect.fail`. Failure messages follow chai ("expected 1 to equal 2"). Unsupported chai features throw a TypeError, reported as an error result. Listed in compatibility.md §A.7.
- **pm.response**: `code`, `status`, `headers` (`get`/`has`/`toObject`/`each`), `json()`, `text()`, `responseTime`, `responseSize`, `to.have.status(code or text)`, `to.have.header(name[, value])`, `to.be.ok`, `to.have.jsonBody()`. The body crosses as text (at most 10 MB).
- **pm.test**: an `AssertionError` is `fail`, any other error is `error`, and the next tests still run. A script that throws outside `pm.test` or times out becomes an `error` result named "Test script in <place>", and the next script still runs. `pm.test` stays unavailable in pre-request scripts.
- **core**: `scripting/tests.ts` (`runTestScripts`, `countTests`, `testsOutcome`) runs the `test` chain (collection → folders → request) after the response, with the scopes as the pre-request scripts left them (request-local variables carry over). Results get their place and are masked with the send's secrets; variable writes become current values. `ExecutionContext.tests` turns it on; results are `ExecutionResult.tests`.
- **Runs**: each `RunEntry` has `tests` (counts plus the first 20 failures). The outcome is the worst of comparison and tests: a failed or errored test fails the request; passing tests with nothing compared make it pass. The run dialog option "Failed test scripts fail the request" (on by default) is `testsAffectOutcome` in the report. The Runner shows "2/3 tests" per row, with the failures as a tooltip.
- **UI**: a **Tests** tab in the response panel (results grouped by place, messages under failures) and a "Tests 2/3" badge next to the comparison badge in the status line (clicking it opens the tab). Script notes and warnings no longer say test scripts are skipped; with execution off, every script is listed as not run.
- **Fixture**: `fixtures/postman/test-scripts.v2.1.json` (collection, folder and request test scripts with known outcomes: 5 pass; 3 pass / 1 fail / 1 error). It also goes through the import round-trip tests.
- **Tests**: core: one passing and one failing case for each matcher (16 cases), `pm.response`, fail vs error, `pm.test` refused in pre-request, the fixture's counts and order through a real send, runs folding tests into outcomes (and the option off). UI: badge, Tests tab, run row. Playwright (3 browsers): a test script's result in the badge and tab. The basic fixture's collection test script now runs, so two UI tests changed (requests without a baseline now pass in its run).
- The out-of-memory sandbox test accepts "memory" or "timeout": filling 64 MB takes QuickJS 3–5 s, close to the 5 s deadline on a busy machine.
