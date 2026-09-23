# PIGN-031 — Scripts tab (preserve & edit)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-031 | 5 — Examples & Postman | MVP | Todo | PIGN-028 |

## Goal
Show and edit Postman pre-request and test scripts at collection, folder, and request level, stored as Postman `event[]` — without executing them yet.

## User story
As a Postman user with scripts, I want to see and keep editing them in Pigeon, so nothing breaks when I export back or when script execution arrives.

## Context
- Script model: [data-model.md §4.2](../data-model.md#42-scripts); storage as `exec: string[]` [file-format.md §3](../file-format.md#3-deterministic-serialization).
- Future execution: [api-execution.md §9](../api-execution.md#9-scripts-later-pign-043044).

## Scope
**In scope**
- **Scripts** tab on request, folder, collection: two CodeMirror JavaScript editors (Pre-request, Tests), each with enable toggle (`disabled` flag) and line count; banner "Scripts are saved and exported but not executed yet".
- Edits update `events` (split lines into `exec[]`, join on read); preserve `script.id`, `type`, `name`, `src` and unknown keys.
- Explorer indicator (small `JS` badge) for items with scripts.
- Send shows a one-line warning when the request (or ancestors) has scripts that were not executed.

**Out of scope**
- Execution (PIGN-043/044), `pm` autocomplete.

## Acceptance criteria
- [ ] Scripts fixture round-trips unchanged through import → edit nothing → commit → export.
- [ ] Editing one line of a script produces a one-line Git diff (golden test).
- [ ] Disabled flag toggles and persists.
- [ ] Warning appears on send for requests with scripts.

## Technical notes
- Normalize CRLF in pasted scripts to LF before splitting.

## Files / components likely affected
`packages/core/src/model/events.ts`, `packages/formats/src/postman/events.ts`, `packages/ui/src/features/request-editor/ScriptsTab.tsx`, `packages/ui/src/features/collection-settings/*`, explorer.

## Tests required
- Unit: exec split/join, preservation.
- Golden diff test.
- Playwright: edit script and commit.

## Definition of done
Standard DoD.
