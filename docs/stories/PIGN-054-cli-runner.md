# PIGN-054 — CLI regression runner

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-054 | 9 — Later | Later | Todo | PIGN-038, PIGN-040 |

## Goal
A Node CLI (`pigeon run`) that executes a project's collection/folder against an environment and compares responses to baselines — for CI pipelines — using exactly the same core as the apps.

## User story
As a team, we want regression checks in CI using the Pigeon files committed in our repo, so API changes are caught in pull requests.

## Context
- Runner: [architecture.md §3.6](../architecture.md#36-runner-corerunner); comparison [response-comparison.md §7](../response-comparison.md#7-regression-runs-pign-038); Node platform [platform.md §7](../platform.md#7-node-tests-future-cli).

## Scope
**In scope**
- `apps/cli` (package `@pigeon/cli`, bin `pigeon`): `pigeon run <projectDir> [--collection <name|id>] [--folder <path>] [--env <name|file>] [--var key=value]... [--bail] [--reporter pretty|json|junit] [--out <file>] [--timeout <ms>]`.
- Uses `platform-node` (NodeFs, NodeTransport), `ProjectSession` read-only, core runner; variables from env file shared values + `--var` overrides + `PIGEON_VAR_<KEY>` environment variables (for CI secrets).
- Exit codes: 0 pass, 1 failures, 2 usage/config error; warnings don't fail unless `--fail-on-warn`.
- Reporters: pretty (TTY colours), JSON (`RunReport`), JUnit XML (one testcase per request, findings in failure message).
- `pigeon validate <projectDir>`: parses all files, reports problems (useful as a pre-commit/CI check).
- Docs page `docs/cli.md`.

**Out of scope**
- Script execution in CLI until PIGN-043/044 land (then reuse the Node sandbox).

## Acceptance criteria
- [ ] Running against the fixture project + test server produces the same outcomes as the desktop runner.
- [ ] JUnit output renders in GitHub Actions test reporting.
- [ ] Works on macOS, Windows, Linux (CI matrix).
- [ ] Secrets can be provided only via env vars/`--var`, never read from local app state.

## Technical notes
- The CLI never writes project files (read-only session).

## Files / components likely affected
`apps/cli/**`, `packages/platform-node/**`, `packages/core/src/runner/*`, `docs/cli.md`.

## Tests required
CLI integration tests (spawn process) against the test server; reporter snapshots.

## Definition of done
Standard DoD.
