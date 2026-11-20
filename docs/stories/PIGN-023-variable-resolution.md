# PIGN-023 — Variable resolution & highlighting

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-023 | 3 — Variables | MVP | Done | PIGN-022 |

## Goal
Resolve `{{variables}}` (environment + dynamic) in every request part at send time, and highlight them in editors with resolved/unresolved state and hover values.

## User story
As a developer, I want `{{baseUrl}}` and `{{$guid}}` to work everywhere and to see at a glance which variables are missing, so switching environments just works.

## Context
- Resolution rules: [api-execution.md §3](../api-execution.md#3-variable-resolution).
- Scopes & dynamic variables: [data-model.md §5](../data-model.md#5-variables-and-environments).

## Scope
**In scope**
- `core/variables/`: `buildScopes(model, localState, envId, itemPath)` (environment + globals/collection placeholders for PIGN-024), `resolveString(str, scopes) → { value, unresolved[], usedSecrets[] }`, nested resolution depth 10, cycle detection, dynamic variables (`$guid`, `$randomUUID`, `$timestamp`, `$isoTimestamp`, `$randomInt`).
- `prepareRequest` resolves URL raw, query keys/values, path variable values, header keys/values, raw body, urlencoded/form-data text keys & values, file `src` only when it is exactly one `{{var}}`.
- `meta.unresolved` → response warnings: "Unresolved variables: …".
- CodeMirror extension + single-line input decoration: `{{name}}` chips coloured resolved (green) / unresolved (red) / dynamic (purple); hover tooltip shows value (masked for secrets), scope, and "Edit in environment" link; autocomplete on `{{` listing available variables.
- Applies to URL input, key/value tables, raw body editor.

**Out of scope**
- Collection/globals scopes (PIGN-024), secret masking storage (PIGN-025), auth fields (PIGN-026 reuses resolver), scripts' local scope (PIGN-043).

## Acceptance criteria
- [x] `{{baseUrl}}/users` sends to the selected environment's value; switching environment changes the target.
- [x] Current value overrides shared value.
- [x] Unresolved variable is highlighted red and listed as a warning after send; request still sends.
- [x] `{{a}}` → `{{b}}` → `x` resolves; `{{a}}` ↔ `{{b}}` cycle is reported and left unresolved.
- [x] `{{$guid}}` produces a new UUID per send.
- [x] Disabled variables are ignored.

## Technical notes
- The resolver is pure and synchronous; dynamic variable generators are injectable for deterministic tests.
- Highlighting uses the same parser as the resolver (`core/variables/parse.ts`) to avoid drift.

## Files / components likely affected
`packages/core/src/variables/*`, `packages/core/src/execution/prepare.ts`, `packages/ui/src/components/{CodeEditor,VariableInput}/*`.

## Tests required
- Unit: resolver table tests (precedence, nesting, cycles, disabled, dynamic), prepare integration.
- Component: tooltip/highlight states.
- Playwright: environment switch changes resolved URL.

## Definition of done
Standard DoD.

## Implementation notes
- `core/variables/`: `parse.ts` (`findVariables`, `isSingleVariable`; shared by resolver and highlighting), `scopes.ts` (`buildScopes(model, { environmentId, currentValues })` → layers, highest precedence first; `scopeLayer` keeps the first enabled definition of a key and uses the current value over the shared one; `lookupVariable`, `visibleVariables`), `resolve.ts` (`VariableResolver` / `resolveString`: depth 10, cycles reported separately and left as typed, unknown `$` names unresolved, injectable `DynamicGenerators` for `$guid`, `$randomUUID`, `$timestamp`, `$isoTimestamp`, `$randomInt`; `describeVariable` for tooltips). Collection, folder and globals layers join in PIGN-024 (the layer kinds already exist).
- `prepareRequest` resolves a copy of the request (`resolveRequest`): URL raw (so query keys/values too), path variable values, enabled header keys and values, raw body, urlencoded and form-data keys and text values, file sources only when exactly one `{{var}}`. `meta.unresolved` (cycle names included), `meta.secretValues`, and warnings "Unresolved variables: …" / "Variable cycle (left unresolved): …". `ExecutionContext` gained `scopes` and `generators`; project tabs pass `buildScopes` of the working model + selected environment + current values at send time.
- UI: `VariableInput` (URL bar and every key/value table cell) draws the `{{var}}` highlights behind a transparent input (resolved green, unresolved red, dynamic purple), shows the values in the tooltip (secrets as ••••) and autocompletes after `{{`. The raw body CodeMirror editor marks variables with the same states (`components/CodeEditor/variables.ts`). Scopes come from `VariablesProvider` (the active project; empty for the scratch request, where variables show as unresolved).
- Not done: an "Edit in environment" link in the tooltip (native `title` tooltips can't hold links) and `{{` autocomplete inside the CodeMirror body editor (needs `@codemirror/autocomplete`); both are follow-ups.
- UI tests now allow 20 s per test (`packages/ui/vitest.config.ts`): whole-app jsdom flows exceeded the 5 s default on a busy machine.
