# PIGN-035 — Field rules: optional / ignore / nullable / dynamic

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-035 | 7 — Comparison | MVP | Todo | PIGN-034 |

## Goal
Let users relax comparison per field (optional, ignore, nullable, dynamic, explicit types) from the findings list or a rules panel, persisted in `compare.json` (request) and `pigeon.json` (project defaults).

## User story
As a developer, I want to mark expected differences as optional or ignored, so real regressions fail and harmless changes only warn.

## Context
- Rule semantics: [response-comparison.md §4.5–4.6](../response-comparison.md#45-field-rules).
- Files: [file-format.md §2.1, §2.7](../file-format.md#27-comparejson).

## Scope
**In scope**
- `compare/src/rules.ts`: `applyRules(findings, rules)` using the path matcher; relax-only semantics; `ignore` covers descendants; `nullable`, `optional`, `dynamic` (no effect in schema mode yet — value mode arrives in PIGN-036), `type` overrides applied during diff (pass rules into `compareJson`).
- `ComparisonConfig` model (rules + overrides; `baseline` default `auto`), reader/writer for `compare.json` (only non-default keys written; rules sorted), `ComparisonDefaults` in `pigeon.json`.
- Finding row actions: **Mark optional**, **Allow null**, **Ignore**, (**Mark dynamic** shown only in value mode later) → create/update rule at the finding's `schemaPath` as a draft on the compare config → comparison re-runs immediately.
- Rules panel in the Compare tab: request rules (editable table: path with inline validation, flags, note, delete) and inherited project rules (read-only, "Edit in project settings").
- Project settings → Comparison defaults: status mode, header list, body mode, additional fields policy, distinguish integers, project rules table.
- Ignored findings hidden by default with "Show ignored (N)".

**Out of scope**
- Status/headers/value comparisons (PIGN-036).

## Acceptance criteria
- [ ] Removed field + **Mark optional** → finding becomes warn, outcome warn; after Save for Commit `compare.json` contains the rule (golden).
- [ ] `ignore` on `$.meta` hides all findings under `$.meta`.
- [ ] `nullable` makes `string → null` pass.
- [ ] Project rule `$..requestId` (ignore) applies to every request; request rule can't escalate severity.
- [ ] Invalid path pattern is rejected inline with an explanation.
- [ ] Property test: adding any rule never increases the outcome severity.

## Technical notes
- Compare config lives with examples (`examples/<…>/<request>/compare.json`) and moves with the request (planner support like PIGN-027).

## Files / components likely affected
`packages/compare/src/{rules,diff}.ts`, `packages/core/src/model/comparison.ts`, `packages/formats/src/project/{reader,writer}.ts`, `packages/ui/src/features/compare/{FindingsList,RulesPanel}.tsx`, `packages/ui/src/features/settings/ProjectComparisonSettings.tsx`.

## Tests required
- Unit: rules table tests, matcher, config read/write golden, property test.
- Playwright: mark optional → warn → commit.

## Definition of done
Standard DoD.
