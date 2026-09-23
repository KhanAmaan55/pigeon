# PIGN-022 — Environments (Postman env files)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-022 | 3 — Variables | MVP | Todo | PIGN-019 |

## Goal
Create, edit, delete, and select environments stored as Postman environment files in `environments/`, with shared values (committed) vs current values (local).

## User story
As a developer, I want Local/Staging/Production environments with shared defaults in Git and my own current values locally, so the team shares structure without sharing personal values.

## Context
- Model: [data-model.md §5](../data-model.md#5-variables-and-environments).
- File: [file-format.md §2.5](../file-format.md#25-postman_environmentjson).
- Postman mapping: [compatibility.md §B.1](../compatibility.md#b1-pigeon--postman-environment-observed).
- UI: [ui-ux.md §3.4](../ui-ux.md#34-environment-editor).

## Scope
**In scope**
- Model: `Environment`, `Variable`; reader/writer for `environments/*.postman_environment.json` (key order spec, volatile keys omitted, unknown keys preserved); commit planner and reload support environments.
- Commands: create/rename/duplicate/delete environment; add/edit/remove/reorder variables (shared value, type default/secret, enabled, description).
- Current values: `LocalProjectState.currentValues['env:<id>']`, written immediately (not drafts); "Reset current values"; "Persist current as shared" (creates a draft).
- Environment selector in the top bar (per project, persisted in local state), `Cmd/Ctrl+E` quick switcher, "No environment".
- Environments view (activity bar): list + variable table with columns Enabled, Key, Shared value, Current value, Type, Description; column header tooltips explaining Git vs local.
- Secret type exists in the model but full masking/secret storage is PIGN-025 (for now: secret rows masked in the table only).

**Out of scope**
- Variable resolution in requests (PIGN-023), globals/collection vars (PIGN-024), import/export (PIGN-030).

## Acceptance criteria
- [ ] Creating "Local" with `baseUrl` and Save for Commit writes `environments/local.postman_environment.json` matching file-format §2.5 exactly.
- [ ] Editing a current value never creates a draft or changes files.
- [ ] Selected environment persists per project across restarts and doesn't affect other open projects.
- [ ] Deleting an environment is a draft (**D**) until committed.
- [ ] A hand-written Postman environment file dropped into `environments/` appears after reload.

## Technical notes
- Environment files are top-level Postman objects — reuse canonical JSON with an `environment` key-order spec.
- Keep variable order as in file.

## Files / components likely affected
`packages/core/src/model/environment.ts`, `packages/formats/src/project/{reader,writer,key-order}.ts`, `packages/formats/src/postman/environment.ts`, `packages/core/src/workspace/*`, `packages/ui/src/features/environments/*`, top bar.

## Tests required
- Unit: env read/write golden, unknown-key preservation, current-value isolation.
- Playwright: create env, select, edit current value, commit.

## Definition of done
Standard DoD.
