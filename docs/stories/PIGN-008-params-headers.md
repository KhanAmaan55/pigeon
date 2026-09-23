# PIGN-008 — Query params, path variables & headers

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-008 | 1 — First request | MVP | Todo | PIGN-006 |

## Goal
Edit query params (bidirectionally synced with the URL), path variables (`:id`), and headers in key/value tables.

## User story
As a developer, I want to edit params and headers in tables and see the URL update, so I can build requests quickly without hand-encoding URLs.

## Context
- Model: `Url`, `KeyValue`: [data-model.md §4](../data-model.md#4-collection-folder-request).
- Encoding and path variables: [api-execution.md §3](../api-execution.md#3-variable-resolution).
- UI: [ui-ux.md §3.3](../ui-ux.md#33-request-editor).

## Scope
**In scope**
- `core/model/url.ts`: `parseUrlRaw(raw) → { query, pathVariableNames }`, `syncQueryIntoRaw(raw, query)`, preserving `{{vars}}` untouched, disabled params kept in `query` but omitted from `raw`, params without `=` (`?flag`) supported.
- `prepareRequest`: path variable substitution, query encoding rules, disabled headers skipped, duplicate headers preserved in order.
- `ui/components/KeyValueTable`: enable checkbox, key, value, description (toggleable column), delete, auto-append empty row, drag reorder, bulk edit (textarea `key: value` / `key=value` lines), paste of multiple lines.
- Request editor tabs **Params** (query table + path variables table when the URL has `:name`) and **Headers** (with count badge).
- Auto-generated headers (e.g. `Content-Type` from body, `User-Agent`) listed read-only, greyed, in the headers tab.
- Forbidden header warning icon when `!capabilities.canSetAnyHeader`.

**Out of scope**
- Variable highlighting (PIGN-023), header autocomplete (nice-to-have; skip).

## Acceptance criteria
- [ ] Typing `?a=1&b=2` in the URL creates two param rows; editing a row updates the URL; disabling a row removes it from the URL but keeps it in the table.
- [ ] `{{baseUrl}}/users/:id` shows a path variable row `id`; value `42` sends `/users/42`.
- [ ] Values with spaces/unicode are percent-encoded on send, not in the editor.
- [ ] Disabled headers are not sent; duplicate headers are both sent (verified with `/echo` on desktop).
- [ ] On web, adding `Cookie` shows the forbidden-header warning and the request's `warnings` lists it as dropped.

## Technical notes
- Don't use `URL` for parsing the raw string (it breaks on `{{vars}}`); implement a tolerant splitter for `?`, `&`, `=`, `#`.
- `:name` detection only in the path portion, segment-wise (`/:id/` not `http://host:8080`).

## Files / components likely affected
`packages/core/src/model/url.ts`, `packages/core/src/execution/prepare.ts`, `packages/ui/src/components/KeyValueTable/*`, `packages/ui/src/features/request-editor/{ParamsTab,HeadersTab}.tsx`.

## Tests required
- Unit: URL parse/sync round trips (table-driven incl. edge cases: empty values, repeated keys, `#hash`, encoded input, `{{var}}` in host/path/query), path var substitution, header handling.
- Component: KeyValueTable editing & bulk edit.
- Playwright: params ↔ URL sync; path variable send to `/echo`.

## Definition of done
Standard DoD.
