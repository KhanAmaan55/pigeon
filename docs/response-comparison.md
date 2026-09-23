# Pigeon — Response Comparison & Regression Testing

Implementation: `packages/compare` (pure, no I/O). UI: `packages/ui/src/features/compare`. Config storage: `compare.json` (see [file-format.md §2.7](file-format.md#27-comparejson)). Types: [data-model.md §7](data-model.md#7-comparison).

## 1. Concepts

| Term | Meaning |
|---|---|
| **Example** | A saved response (Postman-compatible). Any example can serve as a baseline. |
| **Baseline** | The example a new response is compared against. Selected per request by `ComparisonConfig.baseline`. |
| **Schema snapshot** | Structural schema inferred from the baseline body (types, keys, array item shape). Derived; cached locally; never committed. |
| **Field rule** | Path-scoped rule (`optional`, `nullable`, `ignore`, `dynamic`, `type`) that relaxes comparison. Committed in `compare.json` (request) or `pigeon.json` (project defaults). |
| **Finding** | One detected difference with a severity: `fail`, `warn`, `info`, `ignored`. |
| **Outcome** | `fail` if any finding is `fail`; else `warn` if any `warn`; else `pass`. |

## 2. Baseline selection

`baseline.mode`:
- `auto` (default): first example (in order) whose `code` equals the actual status; if none, first example; if the request has no examples → no comparison ("No baseline — Save as example to start tracking").
- `example`: a fixed `exampleId` (missing example → comparison shows "Baseline not found").
- `none`: comparison disabled for this request.

Comparison runs automatically after every successful send when a baseline exists (preference: auto-compare on/off, default on), and in the runner.

## 3. What is compared

Comparison has three independent sections; each produces findings.

### 3.1 Status
| Setting | Behaviour |
|---|---|
| `exact` (default) | `actual.code !== baseline.code` → `status.changed` **fail** |
| `class` | compare `Math.floor(code/100)` only |
| `ignore` | skipped |

### 3.2 Headers
- Header names compared case-insensitively. Only names in `headers.compare` are checked (default: `content-type`). `ignore` removes names from consideration.
- `mode: 'media-type'` (default): compare `type/subtype` only (ignores `charset`, `boundary`).
- `mode: 'value'`: exact value; `mode: 'presence'`: only existence.
- Missing compared header → `header.missing` **fail**; changed → `header.changed` **fail**; headers present in actual but not baseline → `header.added` **info** (only for names in `compare`).
- On web, headers not exposed by CORS are unknowable: a missing header when `headersRestricted` is true becomes **warn** with "hidden by browser" instead of fail.

### 3.3 Body
Content type decides the comparator:
1. If baseline and actual media types differ in category (JSON vs non-JSON) → `body.contentType.changed` **fail**; body comparison stops.
2. JSON (`application/json`, `*+json`, or baseline example `format: 'json'`) → JSON comparator (below).
3. Other text → `body.mode: 'values'` means exact text equality (`body.value.changed` fail); `schema` mode on text → skipped (info "Text body not compared structurally"). Binary → size/equality only in values mode.
4. Actual body not parseable as JSON while baseline is JSON → `body.parse.failed` **fail**.

`body.mode: 'none'` skips body comparison.

## 4. JSON comparator

### 4.1 Types
JSON types: `null`, `boolean`, `number`, `string`, `array`, `object`. With `distinguishIntegers: true`, numbers are split into `integer` / `number` and `integer → number` is a **warn** ("widened"), `number → integer` is **pass**.

### 4.2 Schema inference (baseline → snapshot)
- Scalars → `{ types: [t] }`.
- Object → `properties` for each key.
- Array → `items` = **merge** of all element schemas. Merge rules: union of `types`; union of object keys; for each key count `seen` (elements containing it) vs `of` (object elements). A key with `seen < of` is **implicitly optional** within the array.
- Empty array → `{ types: ['array'], emptyArray: true }` (no item information).
- `null` in baseline → `{ types: ['null'] }` (unknown real type — see 4.4).

### 4.3 Structural comparison (`mode: 'schema'`, default)
Walk the **actual** value against the **baseline schema**:

| Situation | Finding | Default severity |
|---|---|---|
| Key in baseline schema missing in actual object | `body.field.removed` | **fail** |
| …and key implicitly optional (array merge) | `body.field.removed` | warn |
| Key in actual not in baseline schema | `body.field.added` | per `additionalFields` (default **warn**) |
| Type not in baseline `types` | `body.type.changed` | **fail** |
| Baseline `null`, actual non-null | `body.type.changed` | warn ("baseline had null; type unknown") |
| Baseline non-null, actual `null` | `body.type.changed` | **fail** |
| Baseline empty array, actual array has items | `body.field.added` at `[*]` | info ("no baseline items to compare") |
| Baseline array has items, actual empty array | — | info (length not compared in schema mode) |
| Array element doesn't match `items` | per rules above, path `…[i]`, schemaPath `…[*]` | — |

Findings for array elements are **de-duplicated by `schemaPath` + kind**: one finding with `count` and the first 3 concrete paths, so a 1,000-item array doesn't produce 1,000 findings.

Values are not compared in schema mode.

### 4.4 Value comparison (`mode: 'values'`)
Everything in 4.3, plus scalar values must be equal (`body.value.changed` **fail**). Arrays:
- `arrays: 'index'` (default in values mode): compare element *i* to element *i*; length difference → `body.array.length` **fail**.
- `arrays: { matchBy: 'id' }`: match elements by key; unmatched → added/removed findings.
- `arrays: 'schema'`: structure only for arrays.

Fields with `dynamic: true` skip value comparison but keep type/structure checks.

### 4.5 Field rules
Rules come from project defaults (`pigeon.json`) and request config (`compare.json`); request rules are applied after (override) project rules. For each finding, the rule(s) whose `path` matches the finding's concrete path apply:

| Rule | Effect |
|---|---|
| `ignore: true` | all findings at the path and below → `ignored` (not counted in outcome; shown collapsed) |
| `optional: true` | `field.removed` → **warn** |
| `nullable: true` | `null` ↔ any type → pass |
| `dynamic: true` | `value.changed` → pass |
| `type: [...]` / `'any'` | overrides the baseline types for that path |

Severity can only be **relaxed** by rules, never escalated (except `additionalFields: 'fail'`).

### 4.6 Path syntax
Subset of JSONPath, implemented in `compare/src/path.ts`:

| Pattern | Meaning |
|---|---|
| `$` | root |
| `.name` / `["na.me"]` | object key (bracket form for keys with `.`, `[`, spaces, or non-identifier chars) |
| `[3]` | array index (concrete paths only) |
| `[*]` | any array element |
| `.*` | any object key |
| `..name` | `name` at any depth |

Concrete finding paths use indices (`$.items[3].id`); `schemaPath` replaces indices with `[*]` (`$.items[*].id`). "Mark as …" actions from the UI write rules using `schemaPath`.

## 5. Dynamic value hints

To help users, the comparator flags likely-dynamic fields in **values** mode (UUIDs, ISO timestamps, unix timestamps, JWTs, long hex tokens) with a suggestion "Mark as dynamic?" in the UI. Suggestions never change severity by themselves. In the default schema mode dynamic values don't matter.

## 6. Accepting changes

| Action | Result (as a draft; committed via Save for Commit) |
|---|---|
| **Mark optional / Allow null / Ignore / Mark dynamic** (per finding) | adds/updates a `FieldRule` in `compare.json` using `schemaPath`; re-runs comparison immediately |
| **Accept as new baseline** | replaces the baseline example's response (status, headers minus volatile headers, body) with the actual response; `originalRequest` refreshed from the current request definition |
| **Save as new example** | adds a new example (e.g. a new status code); becomes baseline if `auto` matches |
| **Set as baseline** (on an example) | `baseline: { mode: 'example', exampleId }` |
| **Accept all in run** (runner report) | accept new baseline for every selected failed/warned request |

All actions are undoable until Save for Commit by discarding the draft.

## 7. Regression runs (PIGN-038)

- Scope: collection or folder (recursive), in explorer order; optional filter (only requests with baselines).
- Environment: the currently selected one (can be changed in the run dialog).
- Execution: sequential; stop-on-first-fail option; per-request timeout from settings.
- Report (`RunReport`, local): per request: outcome, status, time, findings counts; totals; duration; environment; started/finished timestamps; transport. Exportable as JSON (and JUnit XML later with the CLI, PIGN-054).
- Reports are local state (last 20 kept). They are not committed.

## 8. Output shape and examples

```jsonc
// ComparisonResult (abridged)
{
  "outcome": "fail",
  "counts": { "fail": 1, "warn": 1, "info": 0, "ignored": 1 },
  "findings": [
    { "kind": "body.field.removed", "path": "$.data[0].email", "schemaPath": "$.data[*].email",
      "severity": "fail", "count": 20, "message": "Field removed (was string)" },
    { "kind": "body.field.added", "path": "$.data[0].nickname", "schemaPath": "$.data[*].nickname",
      "severity": "warn", "count": 20, "message": "New field (string)" },
    { "kind": "body.type.changed", "path": "$.meta.generatedAt", "severity": "ignored",
      "baseline": "string", "actual": "number", "rule": { "path": "$.meta.generatedAt", "ignore": true },
      "message": "Type changed string → number (ignored by rule)" }
  ]
}
```

## 9. Performance

- Inference + comparison of a 5 MB JSON body < 300 ms on a mid-range laptop (tested with a generated fixture).
- Comparison runs in a Web Worker in the UI to keep typing responsive for large bodies (plain function call in Node/tests).
- Snapshots cached by `sourceHash`.

## 10. Non-goals (MVP)

- XML/HTML structural comparison (text equality only).
- OpenAPI/JSON-Schema-based contract validation (JSON Schema export is PIGN-056; validation is future).
- Fuzzy/semantic value comparison (tolerances, regex matchers) — later rule types.
