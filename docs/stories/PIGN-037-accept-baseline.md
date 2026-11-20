# PIGN-037 — Accept new baseline & baseline selection

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-037 | 7 — Comparison | MVP | Done | PIGN-035 |

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
- [x] After a failing comparison, Accept → outcome pass; Save for Commit changes only the example + body files (and not `compare.json`).
- [x] Pin a 404 example → comparing a 200 response fails on status; Auto picks the 200 example.
- [x] Discarding the accept draft restores the previous baseline and failing result.
- [x] Secrets never end up in the accepted example (test).

## Technical notes
- Reuse the example-capture function from PIGN-027 (single code path for "response → example").

## Files / components likely affected
`packages/core/src/comparison/*`, `packages/core/src/workspace/commands.ts`, `packages/ui/src/features/compare/*`, `packages/ui/src/features/examples/*`.

## Tests required
- Unit: accept command, baseline selection modes.
- Playwright: accept flow + discard.

## Definition of done
Standard DoD.

## Implementation notes
- Core: `acceptedExamplePatch(definition, response, { volatileHeaders, secretValues })` reuses `exampleFromResponse` (one capture path: volatile headers dropped, secrets masked, JSON pretty-printed, `originalRequest` from the current definition) and returns the `request` / `response` patch for `updateExample` — the example keeps its id, name and file key, so a commit touches only its `.example.json` / body sidecar (never `compare.json`). `withBaseline(config, baseline)` (auto removes the key), `resolveBaseline` (shared by the editor; returns the example or `no-baseline` / `disabled` / `baseline-not-found`), `uniqueExampleName` ("200 OK (2)").
- UI: Compare tab header has a baseline selector (Auto, Pin: <example> for each example, Disable comparison); footer **Accept as new baseline** (confirmation listing the findings that go away) and **Save as new example**; states "Comparison is turned off" (Turn on) and "Baseline not found" (Use the auto baseline); badge **Off** / **Baseline not found**. Explorer example menu: **Pin as baseline** / **Use auto baseline**; ★ follows a pinned example (none when off). Accepting re-runs the comparison (pass); discarding the request's changes restores the previous example.
- Tests: core (accept → pass and only the example's files written; a second accept discarded restores the committed baseline; pin a 404 → status fails, auto → the 200 example, missing pin → not found; secrets masked; unique names), UI (accept with confirmation and discard, pin/disable/enable, save as new example, explorer pin ★), E2E accept → pass → discard → fail in Chromium, Firefox and WebKit.
