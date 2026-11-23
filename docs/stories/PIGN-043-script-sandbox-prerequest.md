# PIGN-043 — Script sandbox & pre-request scripts

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-043 | 9 — Later | Later | Done | PIGN-042 |

## Goal
Execute Postman-style pre-request scripts in a secure QuickJS sandbox (same on desktop and web), supporting a documented `pm` subset for variables and request mutation.

## User story
As a Postman user, I want my pre-request scripts (e.g. computing a signature or timestamp) to run, so my requests work without rewriting them.

## Context
- Script order, `pm` subset, safety: [api-execution.md §9](../api-execution.md#9-scripts-later-pign-043044); D-10.

## Scope
**In scope**
- `core/scripting/`: host API contract (pure), `ScriptRunner` interface; `ui`/platform provide `QuickJsScriptRunner` (quickjs-emscripten in a Web Worker; Node variant for tests/CLI).
- Execution order collection → folders → request; each with 5 s timeout and memory limit; errors surface in the response panel ("Pre-request script error in folder Admin: …") and abort the send.
- `pm.environment|collectionVariables|globals|variables` `.get/.set/.unset/.has`, `pm.request` (url, method, headers add/upsert/remove, body raw read/write), `pm.info` (requestName, requestId), `console.log/info/warn/error` → **Console** panel (per project, bounded).
- Variable writes go to **current values** (local), never shared values; a transient request-local scope for `pm.variables.set`.
- Script banner updated: "Pre-request scripts run; test scripts not yet" until PIGN-044.
- Preference: disable script execution (per project).
- Compatibility doc: supported `pm` API table + unsupported calls throw `NotSupportedInPigeon: <name>`.

**Out of scope**
- Test scripts (PIGN-044), `pm.sendRequest`, `require()` libraries (lodash, crypto-js — later), cookies API.

## Acceptance criteria
- [x] Fixture script `pm.environment.set('ts', Date.now())` updates the current value and the request uses it in the same send.
- [x] Header added via `pm.request.headers.add` is sent.
- [x] Infinite loop is terminated at 5 s with an error; UI remains responsive.
- [x] Script cannot access `fetch`, `window`, filesystem, or Tauri APIs (tests).
- [x] Same behaviour on web and desktop (E2E on both). — web: Playwright in 3 browsers; desktop: the `--smoke` run on macOS (Windows/Linux run it in CI, not yet)

## Technical notes
- Marshal data as JSON across the Worker boundary; no shared objects.
- CSP needs `'wasm-unsafe-eval'` (already in platform.md §6.1).

## Files / components likely affected
`packages/core/src/scripting/*`, `packages/core/src/execution/executor.ts`, `packages/ui/src/workers/script.worker.ts`, `packages/ui/src/features/console/*`, `docs/compatibility.md`.

## Tests required
Unit (host API), sandbox escape tests, E2E.

## Definition of done
Standard DoD.

## Implementation notes
- **Dependencies** (downloaded with your approval): `quickjs-emscripten-core` + `@jitl/quickjs-wasmfile-release-sync` 0.32.0 in `@pigeon/core`. I first installed the `quickjs-emscripten` bundle, which emitted all four wasm builds (~3.7 MB); I switched to the core package plus the one release build (503 KB, 236 KB gzip), loaded only when a script first runs. The initial web JS stays at 276 KB gzip.
- **core/scripting**: `types.ts` (the JSON-only host contract: `ScriptState`, `ScriptRunner`, console entries), `prelude.ts` (the `pm` subset in plain JS, running on `__state`; unsupported calls throw `NotSupportedInPigeon: <name>`), `quickjs.ts` (`createQuickJsRunner`: a fresh runtime per script, 64 MB heap, 1 MB stack, interrupt at the 5 s deadline; the script is a function body as in Postman), `prerequest.ts` (`scriptChain` collection → folders → request, skipping disabled/empty scripts; `runPreRequestScripts` threads one state through the chain, applies request changes (unchanged headers keep their descriptions) and variable writes to the scopes for this send, adds a top `local` scope for `pm.variables.set`, and returns writes as current-value writes).
- **Executor**: `ExecutionContext.preRequest` runs the chain before `prepareRequest`. A failure is an `ExecutionError` of the new kind `script` ("Pre-request script error in folder Admin: …"), and nothing is sent. Console output and the error are masked with the secret values in scope.
- **UI**: `features/scripts/run-script.ts` runs QuickJS in a Worker (`script.worker.ts`), with only JSON crossing; if the worker doesn't answer 3 s after the deadline it is terminated and replaced; without Worker support (tests) it runs inline. Editor sends and regression runs use it. Writes become current values through `ProjectSession.setCurrentValue` (secret variables go to the secret store as usual). A **Console** response tab (per project, last 500 entries, in memory, with Clear) also appears under the error card when a script fails. **Settings → Scripts** turns execution off per project (local state `scriptsEnabled`). The Scripts tab note says pre-request scripts run; the send warning lists only skipped test scripts, or all scripts with "script execution is off".
- **Desktop**: `connect-src` gained `'self'` (the app's own assets) so the Worker can load the wasm on every webview; the CSP test allows only that besides IPC. macOS worked without it, but Windows serves the app from `http://tauri.localhost`.
- **Tests**: core: precedence and writes, request changes, timeout at the deadline (with logs kept), out of memory, no `fetch`/`XMLHttpRequest`/`WebSocket`/`window`/`document`/`process`/`Buffer`/Tauri globals/timers/`importScripts`/`Worker`/storage, `require` and dynamic `import` don't work, `NotSupportedInPigeon`, the story's `pm.environment.set('ts', …)` used in the same send, `headers.add` sent, a failing script names its place and stops the send, request-local precedence, secret masking. UI: send with a script (header, console), failing script, switch off. Playwright (Chromium, Firefox, WebKit, real CSP): header from a script reaches the server, console output, an infinite loop is stopped after 5 s while the URL field keeps working. Desktop: the smoke project's request has a pre-request script whose header the probe checks in the echoed request.
- **compatibility.md §A.7** documents the supported `pm` API; D-10 is marked decided.
