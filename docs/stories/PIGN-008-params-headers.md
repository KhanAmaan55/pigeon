# PIGN-008 — Query params, path variables & headers

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-008 | 1 — First request | MVP | Done | PIGN-006 |

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
- [x] Typing `?a=1&b=2` in the URL creates two param rows; editing a row updates the URL; disabling a row removes it from the URL but keeps it in the table.
- [x] `{{baseUrl}}/users/:id` shows a path variable row `id`; value `42` sends `/users/42`.
- [x] Values with spaces/unicode are percent-encoded on send, not in the editor.
- [x] Disabled headers are not sent; duplicate headers are both sent (verified with `/echo` on desktop). On desktop the `--smoke` run builds such a request in the editor and checks the request head the server received; on web, fetch joins duplicates into one `a, b` line.
- [x] On web, adding `Cookie` shows the forbidden-header warning and the request's `warnings` lists it as dropped.

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

## Implementation notes
- **Core** (`core/model/url.ts`): `splitUrlRaw`, `parseUrlRaw`, `syncQueryIntoRaw`, `syncUrlFromRaw` (query + path variables after a URL edit) and `buildRequestUrl` (send-time substitution and encoding). All splitting is done on a copy of the string with `{{…}}` masked out, so variables are never cut. Rules are in [api-execution.md §3](../api-execution.md#3-variable-resolution).
- **Send uses `raw`**: `prepareRequest` builds the URL from `url.raw` and `url.pathVariables`; `url.query` only adds disabled rows and descriptions. Imports whose `raw` and `query` disagree are reconciled by PIGN-013.
- **Encoding choice**: RFC 3986 query characters (sub-delims, `:@/?`) are kept rather than only unreserved ones, so `a+b`, `12:00` and `a,b` go out as typed (as curl and Postman do); `[]`, `|`, `{}`, spaces and non-ASCII are encoded.
- **Auto headers**: `autoHeaders(request, capabilities)` (core) is the single list used by `prepareRequest` and the headers tab. Change: no default `User-Agent` where `!canSetAnyHeader`; before, every web request carried a "User-Agent was not sent" warning, which would also have buried the dropped-`Cookie` warning this story asks for.
- **Forbidden headers**: the list moved from `platform-web` to `@pigeon/platform` (`isForbiddenHeader`, `isForbiddenMethod`) so the UI can use it without depending on a platform adapter; `platform-web` re-exports `isForbiddenHeader`.
- **UI**: `KeyValueTable` (components) with bulk-text helpers in `bulk.ts`; `ParamsTab` and `HeadersTab` under `features/request-editor`; the editor now has Params / Headers / Body tabs (Radix Tabs, Params first). The scratch store gained `setQuery`, `setPathVariables`, `setHeaders`; `setUrl` re-syncs rows. Tooltips use `title` attributes so the table needs no Radix tooltip provider.
- **Tests**: `core/test/url.test.ts` (table-driven split/parse/sync/round-trip/encode), new prepare cases, `ui/test/key-value-table.test.tsx`, `ui/test/params-headers.test.tsx`, and `e2e/web/params-headers.spec.ts` against `/echo` in Chromium, Firefox and WebKit. The desktop `--smoke` probe now types a `:id` path variable plus duplicate, disabled and `Cookie` headers and checks the request head echoed by its local server (`GET /smoke/42`, two `x-dup` lines, no `x-off`, `cookie` present).
- **Known limits**: in bulk edit a param key containing `:` with no `=` on the line is split at the `:` (each table prefers its own separator). A table value containing `&`/`#` is written into the URL as `%26`/`%23`, so re-reading the URL shows the escaped form.
