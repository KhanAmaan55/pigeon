# PIGN-037 — Accept new baseline & baseline selection

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-037 | 7 — Comparison | MVP | Todo | PIGN-035 |

## Goal
Let users accept an actual response as the new baseline, save it as an additional example, and choose which example is the baseline (auto, pinned, or none).

## User story
As a developer who intentionally changed an API, I want to accept the new response as the baseline in one click, so future runs compare against the new contract.

## Context
- Accept actions & baseline modes: [response-comparison.md §2, §6](../response-comparison.md#6-accepting-changes).

## Scope
**In scope**
- **Accept as new baseline**: replaces the baseline example's response (code, status, headers minus volatile list, body) and refreshes `originalRequest` from the current request definition; draft on the example; comparison re-runs → pass.
- **Save as new example** from the Compare tab (name default `"<code> <status>"`, de-duplicated).
- Baseline selector in Compare header and example context menu: **Auto**, **Pin this example** (`mode: 'example'`), **Disable comparison** (`mode: 'none'`); `compare.json` updated; missing pinned example → "Baseline not found" state with fix action.
- Confirmation dialog for accept showing a summary (findings that will disappear).
- All actions undoable by discarding drafts (Pending Changes).

**Out of scope**
- Bulk accept from runs (PIGN-038).

## Acceptance criteria
- [ ] After a failing comparison, Accept → outcome pass; Save for Commit changes only the example + body files (and not `compare.json`).
- [ ] Pin a 404 example → comparing a 200 response fails on status; Auto picks the 200 example.
- [ ] Discarding the accept draft restores the previous baseline and failing result.
- [ ] Secrets never end up in the accepted example (test).

## Technical notes
- Reuse the example-capture function from PIGN-027 (single code path for "response → example").

## Files / components likely affected
`packages/core/src/comparison/*`, `packages/core/src/workspace/commands.ts`, `packages/ui/src/features/compare/*`, `packages/ui/src/features/examples/*`.

## Tests required
- Unit: accept command, baseline selection modes.
- Playwright: accept flow + discard.

## Definition of done
Standard DoD.
