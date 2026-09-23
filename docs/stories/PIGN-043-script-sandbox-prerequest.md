# PIGN-043 — Script sandbox & pre-request scripts

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-043 | 9 — Later | Later | Todo | PIGN-042 |

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
- [ ] Fixture script `pm.environment.set('ts', Date.now())` updates the current value and the request uses it in the same send.
- [ ] Header added via `pm.request.headers.add` is sent.
- [ ] Infinite loop is terminated at 5 s with an error; UI remains responsive.
- [ ] Script cannot access `fetch`, `window`, filesystem, or Tauri APIs (tests).
- [ ] Same behaviour on web and desktop (E2E on both).

## Technical notes
- Marshal data as JSON across the Worker boundary; no shared objects.
- CSP needs `'wasm-unsafe-eval'` (already in platform.md §6.1).

## Files / components likely affected
`packages/core/src/scripting/*`, `packages/core/src/execution/executor.ts`, `packages/ui/src/workers/script.worker.ts`, `packages/ui/src/features/console/*`, `docs/compatibility.md`.

## Tests required
Unit (host API), sandbox escape tests, E2E.

## Definition of done
Standard DoD.
