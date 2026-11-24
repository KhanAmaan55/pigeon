# PIGN-054 — CLI regression runner

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-054 | 9 — Later | Later | Done | PIGN-038, PIGN-040 |

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
- [x] Running against the fixture project + test server produces the same outcomes as the desktop runner.
- [ ] JUnit output renders in GitHub Actions test reporting. *The XML follows the JUnit schema the common report actions read (snapshot-tested); not yet seen in a real Actions report: CI runs the CLI tests but doesn't publish a JUnit file to a report action.*
- [x] Works on macOS, Windows, Linux (CI matrix). *The CLI tests are part of `pnpm verify`, green in the CI matrix on all three (2026-11-24).*
- [x] Secrets can be provided only via env vars/`--var`, never read from local app state.

## Technical notes
- The CLI never writes project files (read-only session).

## Files / components likely affected
`apps/cli/**`, `packages/platform-node/**`, `packages/core/src/runner/*`, `docs/cli.md`.

## Tests required
CLI integration tests (spawn process) against the test server; reporter snapshots.

## Definition of done
Standard DoD.

## Implementation notes

- **`apps/cli`** (`@pigeon/cli`, bin `pigeon`): `src/args.ts` (`node:util` `parseArgs`; help texts), `src/run.ts`, `src/validate.ts`, `src/reporters.ts`, `src/main.ts` (dispatch and exit codes), `src/cli.ts` (entry). Bundled by Vite (SSR) into `dist/cli.js` like the CORS proxy; the QuickJS packages stay external (their WebAssembly file is loaded at run time) and are direct dependencies of the CLI (already in the lockfile; no new download).
- **Same core path as the apps**: the per-request steps moved from the UI runner into core `runner/project-run.ts` — `executeProjectRequest` (scopes, inherited auth, scripts, cookie jar, OAuth tokens, skipped-script warnings) and `compareProjectResult` (effective comparison and baseline). The UI runner and `compareRequestResult` now call them (the UI passes its Web Worker script runner and body comparison), and so does the CLI, with `NodeTransport` and inline QuickJS. A test runs the project through both and compares outcomes and counts.
- **Read-only**: the project is read through `ReadOnlyFs` (writes throw); local state and secrets are `MemoryAppState` / `MemorySecretStore`, empty at start. A test snapshots every project file before and after runs.
- **Variables**: `PIGEON_VAR_<key>` then `--var` (later wins) become current values of the `--env` environment, or of an in-memory "Command line" environment; keys the environment lacks are added in memory. `PIGEON_VAR_*` values are always secrets (masked in URLs, messages, findings, test failures and script errors on stderr). `--env` also takes an environment file (Pigeon or Postman JSON, via `importPostmanEnvironment`).
- **Selection**: no `--collection` runs every collection (one `RunReport` each); `--folder` takes names (`Admin/Users`) or an id, and must be unambiguous. `--bail` stops the current scope and the remaining ones.
- **Extras beyond the story**: `--no-scripts` (scripts run by default, as in the apps), `--reporter json` for `validate`.
- **Exit codes** as specified; "nothing to run" prints a warning on stderr and exits 0.
- **Tests**: `apps/cli/test/cli.test.ts` spawns the built CLI against the test server with a project written to a temp folder (outcomes, masking, `--bail`, folders, env files, JUnit, exit codes, `validate`); `reporters.test.ts` has pretty and JUnit snapshots and runs `main` in process with a mock transport for `--fail-on-warn`. A Vitest global setup builds `dist/cli.js` first, so `pnpm verify` (tests before build) works on a clean checkout. `apps/cli` joined the root Vitest projects, the TypeScript solution and the ESLint boundaries.
- **Docs**: new [cli.md](../cli.md) (options, variables and secrets, exit codes, reporters, a GitHub Actions example); architecture.md §2 and §3.6, platform.md §7, response-comparison.md §7.
