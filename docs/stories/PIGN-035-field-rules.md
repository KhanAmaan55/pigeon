# PIGN-035 — Field rules: optional / ignore / nullable / dynamic

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-035 | 7 — Comparison | MVP | Done | PIGN-034 |

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
- [x] Removed field + **Mark optional** → finding becomes warn, outcome warn; after Save for Commit `compare.json` contains the rule (golden).
- [x] `ignore` on `$.meta` hides all findings under `$.meta`.
- [x] `nullable` makes `string → null` pass.
- [x] Project rule `$..requestId` (ignore) applies to every request; request rule can't escalate severity.
- [x] Invalid path pattern is rejected inline with an explanation.
- [x] Property test: adding any rule never increases the outcome severity.

## Technical notes
- Compare config lives with examples (`examples/<…>/<request>/compare.json`) and moves with the request (planner support like PIGN-027).

## Files / components likely affected
`packages/compare/src/{rules,diff}.ts`, `packages/core/src/model/comparison.ts`, `packages/formats/src/project/{reader,writer}.ts`, `packages/ui/src/features/compare/{FindingsList,RulesPanel}.tsx`, `packages/ui/src/features/settings/ProjectComparisonSettings.tsx`.

## Tests required
- Unit: rules table tests, matcher, config read/write golden, property test.
- Playwright: mark optional → warn → commit.

## Definition of done
Standard DoD.

## Implementation notes
- `@pigeon/compare` `rules.ts`: `applyRules(findings, rules)` (project rules first, then request rules; relax-only: `ignore` → `ignored` for the path and everything below it, `optional` → removed field becomes warn, `nullable` / `dynamic` accept null ↔ value / value changes, findings a rule relaxed carry `rule` and say so in the message), `validateRulePath` (inline explanations), `typeOverride` used inside `compareJson` (`CompareOptions.rules`). `type` rules **add** allowed types (`any`: everything) instead of replacing the baseline's — replacing could turn a pass into a fail, which the "rules never escalate" requirement forbids; response-comparison §4.5 updated. Property test: any set of rules (flags and types) never raises the outcome.
- Formats: `ProjectRequest.comparison` from `examples/…/<request>/compare.json` (`pigeonCompare`, `requestId`, optional `baseline`, `status`, `headers`, `body`, `rules`, unknown keys kept); written only when it sets something, rules sorted by path then JSON; `compare.json` files of unknown requests are kept as `orphanComparisons`. Golden: the examples fixture gained a `compare.json`.
- Core: commands `setComparisonConfig` (a change of the request; the planner owns its `compare.json`, so it moves, renames and deletes with the request) and `setComparisonDefaults` (`pigeon.json` `comparison`; project drafts now carry it). `effectiveComparison` (project body settings overridden by the request's, project + request rules, baseline mode), `baselineFor` (`auto` / `example` / `none`), `upsertRule`, `projectRules`. The comparison service applies the rules (worker included).
- UI: finding actions **Mark optional** (removed fields), **Allow null** (null ↔ value), **Mark dynamic** (value changes, values mode), **Ignore**: each upserts a rule at the finding's schema path as an unsaved change of the request and compares again. "Show ignored (N)". Rules panel in the Compare tab: the request's rules (path validated as you type, flags, note, delete, add) and the project's (read-only, "Edit in project settings"). Settings → **Comparison defaults** (status, compared headers and mode, body mode, additional fields, integers, project rules) edits `pigeon.json`.
- Tests: rules table + property, compare.json mapping/golden, core (Mark optional → warn → committed `compare.json` bytes, project rules + request overrides → committed `pigeon.json`, baseline modes), UI (Mark optional → warn → commit, Ignore + Show ignored, invalid path rejected inline, project rule from Settings applies), E2E (mark optional + ignore → warn → commit) in Chromium, Firefox and WebKit.
