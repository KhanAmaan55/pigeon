# Pigeon CLI (`pigeon run`, `pigeon validate`)

The CLI runs the regression checks of a Pigeon project in CI, from the files committed in the
repository, with exactly the same core as the desktop and web apps (PIGN-054). It never writes
project files and never reads the apps' local state: variables, cookies and tokens set during a
run stay in memory.

## Install and run

The CLI is `apps/cli` (`@pigeon/cli`, binary `pigeon`), bundled into one Node script. Inside this
repository:

```bash
pnpm --filter @pigeon/cli build          # writes apps/cli/dist/cli.js
node apps/cli/dist/cli.js run path/to/project --env Staging
```

or build and run in one step: `pnpm --filter @pigeon/cli start -- run path/to/project`.
`dist/cli.js` bundles every Pigeon package; it needs Node 22 or later and the two QuickJS packages
(`quickjs-emscripten-core`, `@jitl/quickjs-wasmfile-release-sync`) next to it for scripts.

## `pigeon run <projectDir>`

Sends every request of the selected collections or folder, one after the other in explorer
order, and compares each response with its baseline example — the same as **Run collection** in
the apps (docs/response-comparison.md §7). Pre-request and test scripts run in the same sandbox
(QuickJS) unless `--no-scripts`; a failed test fails the request.

| Option | Meaning |
|---|---|
| `-c, --collection <name\|id>` | Collection to run. Default: every collection, one report each. |
| `-f, --folder <path\|id>` | A folder, as names from its collection down (`Admin/Users`) or its id. With `--collection`, looked up there only. |
| `-e, --env <name\|id\|file>` | A project environment, or an environment file outside the project (Pigeon or Postman format). Default: none. |
| `--var <key=value>` | A variable value (repeatable). |
| `--bail` | Stop after the first failing request; the rest is reported as skipped. |
| `--fail-on-warn` | Requests with warnings fail the run too. |
| `--no-scripts` | Do not run pre-request and test scripts. |
| `--timeout <ms>` | Request timeout (default 30000). |
| `-r, --reporter <pretty\|json\|junit>` | Output format (default `pretty`). |
| `-o, --out <file>` | Write the report to a file; a pretty summary still goes to stdout. |

### Variables and secrets

Values resolve as in the apps — environment, then folders, collection, globals — with the
environment's shared values (current values live only on each machine and are never read). On top
of that, in this order (later wins):

1. `PIGEON_VAR_<key>=<value>` environment variables, e.g. `PIGEON_VAR_token`. The part after the
   prefix is the variable name exactly. These values are **always treated as secrets**: masked
   (`••••••`) in every report, log line and URL.
2. `--var key=value`.

Both become current values of the selected environment (or of an in-memory "Command line"
environment when there is no `--env`), so they win over collection, folder and global values and
scripts can still change them. Secret variables have no shared value in project files, so in CI
their values can only come from here (or an `--env` file you provide): the CLI never reads the
OS keychain, `secrets.json` or any other local app state.

### Exit codes

| Code | When |
|---|---|
| 0 | Every request passed (warnings, requests without a baseline and skipped requests don't fail). |
| 1 | A request failed (differences, a failed test) or errored (no response); with `--fail-on-warn`, also a warning. |
| 2 | Usage or configuration error: unknown option, no `pigeon.json`, unknown collection, folder or environment, unreadable `--env` file. |

Project files that cannot be read are reported on stderr (see `pigeon validate`); their requests
are not run, the rest is.

### Reporters

- **pretty** (default): one line per request with outcome, status and time, then the findings of
  failing requests and failed tests, then totals. Colours on a TTY; `NO_COLOR` turns them off,
  `FORCE_COLOR` on.
- **json**: `{ "pigeonCliReport": 1, "version", "project", "exitCode", "reports": RunReport[] }` —
  one `RunReport` (data-model.md §7.3) per collection or folder run, the same objects the apps keep
  in local state (counts, no findings; secrets masked).
- **junit**: JUnit XML. One `<testsuite>` per collection or folder run and one `<testcase>` per
  request (`classname` = collection and folders, `name` = method and request name). Failures and
  failed tests are `<failure>` with every finding in the text, transport errors `<error>`,
  requests without a baseline or skipped by `--bail` `<skipped>`; warnings appear in
  `<system-out>` (or as `<failure type="warn">` with `--fail-on-warn`).

## `pigeon validate <projectDir>`

Reads every project file the way the apps do and lists problems (invalid JSON, wrong shapes,
missing files, stale order entries, examples whose request is gone). Exit code 1 when any file has
an error, 0 when there are only warnings or nothing. `--reporter json` prints
`{ project, ok, collections, environments, problems[] }`. Useful as a pre-commit hook or a first
CI step.

## GitHub Actions

```yaml
jobs:
  api-regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install --frozen-lockfile && pnpm --filter @pigeon/cli build
      - run: node apps/cli/dist/cli.js validate api-project
      - run: >
          node apps/cli/dist/cli.js run api-project --env Staging
          --reporter junit --out pigeon-results.xml
        env:
          PIGEON_VAR_token: ${{ secrets.API_TOKEN }}
      - uses: mikepenz/action-junit-report@v5   # or dorny/test-reporter (reporter: java-junit)
        if: always()
        with: { report_paths: pigeon-results.xml }
```

## Not yet

- Iterations with data files (CSV/JSON), parallel requests, and HTML reports.
- Publishing `@pigeon/cli` to npm; for now it is built from this repository.
