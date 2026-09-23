# PIGN-023 — Variable resolution & highlighting

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-023 | 3 — Variables | MVP | Todo | PIGN-022 |

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
- [ ] `{{baseUrl}}/users` sends to the selected environment's value; switching environment changes the target.
- [ ] Current value overrides shared value.
- [ ] Unresolved variable is highlighted red and listed as a warning after send; request still sends.
- [ ] `{{a}}` → `{{b}}` → `x` resolves; `{{a}}` ↔ `{{b}}` cycle is reported and left unresolved.
- [ ] `{{$guid}}` produces a new UUID per send.
- [ ] Disabled variables are ignored.

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
