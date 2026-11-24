# Pigeon — Postman & Environment Compatibility

Implementation: `packages/formats/src/postman/` (collections, environments, globals), `packages/formats/src/apidog/`, `packages/formats/src/echoapi/` (later).

Confidence labels used below:
- **Confirmed** — publicly documented format (Postman Collection v2.1 JSON Schema) or widely observed in real exports.
- **Observed** — consistent in real exports but not formally specified (e.g. Postman environment files). Verify with fixtures.
- **Assumption** — not verified; importer must be built from real sample files first.

---

## Part A — Postman collections

### A.1 Versions

| Format | Import | Export | Detection |
|---|---|---|---|
| Collection v2.1.0 | ✅ | ✅ (only export target) | `info.schema` ends with `/collection/v2.1.0/collection.json` (hosts `schema.getpostman.com` or `schema.postman.com`) |
| Collection v2.0.0 | ✅ (converted to v2.1 semantics) | ❌ | `info.schema` contains `v2.0.0` |
| Collection v1 | ❌ — message: "Re-export from Postman as v2.1" | ❌ | has top-level `requests` + `order` |
| Postman data dump (`backup.json`, many collections + environments) | Later | ❌ | top-level `version` + `collections[]` |
| Postman file-based/Git collection format (newer Postman releases) | Future — **Assumption**: format reported but not evaluated | ❌ | — |

v2.0 → v2.1 differences handled by the importer: auth params are objects in v2.0 (`basic: { username, password }`) vs arrays of `{key,value,type}` in v2.1; header strings; URL string forms.

The official v2.1 JSON Schema is vendored in `packages/fixtures/postman/schema/collection-v2.1.0.json` and used in tests to validate every export.

### A.2 Import/export mapping

| Postman v2.1 | Pigeon domain | Project file | Support |
|---|---|---|---|
| `info._postman_id` | `Collection.id` | `collection.json info._postman_id` | Full |
| `info.name`, `description`, `version` | `name`, `description`, `version` | `collection.json` | Full |
| `info.schema` | — (fixed) | written as v2.1 URL | Full |
| `item[]` with `item` (item-group) | `Folder` | `<dir>/folder.json` | Full (any depth) |
| `item[]` with `request` | `Request` | `*.request.json` | Full |
| `item.id` | `id` | `id` | Full (generated when missing) |
| `request` as string URL | `method: GET`, `url.raw` | normalized to object | Full |
| `request.method` | `method` | | Full (custom methods allowed) |
| `request.url` string / object | `Url { raw, query, pathVariables }` | `raw`, `query`, `variable` | Full; `host/path/port/protocol` regenerated on export from `raw` |
| `url.hash` | `url.extra.hash` | preserved | Preserved |
| `request.header[]` / header string | `headers[]` | `header[]` | Full; string form normalized |
| `body.mode: raw` + `options.raw.language` | `Body.raw` | | Full |
| `body.mode: urlencoded` | `Body.urlencoded` | | Full |
| `body.mode: formdata` (text) | `FormDataParam kind:text` | | Full |
| `body.mode: formdata` (file, `src`) | `FormDataParam kind:file` | | Partial — absolute paths are machine-specific; see §A.4 |
| `body.mode: file` (`src`, `content`) | `Body.file` | | Partial — same path caveat |
| `body.mode: graphql` (`query`, `variables`) | `Body.graphql` | | Full. `variables` stays JSON text (an object from other tools becomes text). Postman has no operation name field: Pigeon keeps it in the item's `_pigeon.operationName`, or in `graphql.operationName` when the file already has it there |
| `body.disabled`, `body.options.*` | `extra` | | Preserved |
| `auth` noauth / basic / bearer / apikey | `Auth` typed | | Full (executed) |
| `auth` digest / awsv4 | `Auth` typed (all Postman params) | unchanged auth written verbatim | Full (executed, PIGN-046). Digest: MD5, MD5-sess, SHA-256, SHA-256-sess, `qop=auth` (not `auth-int`); on the web only when the server exposes `WWW-Authenticate` via CORS. AWS SigV4: header or query signing, session token |
| `auth` oauth2 | `Auth` typed (Postman params: `grant_type`, `authUrl`, `accessTokenUrl`, `clientId`, `clientSecret`, `scope`, `state`, `redirect_uri`, `username`, `password`, `challengeAlgorithm`, `code_verifier`, `client_authentication`, `addTokenTo`, `headerPrefix`, `accessToken`, `tokenName`; others kept) | unchanged auth written verbatim | Full (PIGN-047): client credentials and password (automatic on send), authorization code with/without PKCE ("Get new token"), refresh; implicit grant not run. Tokens live in the secret store, never in files or exports; a token Postman saved in the file is used when Pigeon has none |
| `auth` oauth1 / hawk / ntlm / akamai / edgegrid / jwt / asap / others | `Auth unsupported` | preserved verbatim | Preserved only; UI shows "Not supported yet — request sent without auth" |
| `event[]` prerequest / test | `ScriptEvent[]` | | Preserved + editable; pre-request and test scripts run (PIGN-043/044, §A.7) |
| `variable[]` (collection) | `Collection.variables` | | Full |
| `variable[]` (folder/request level) | preserved | | Preserved; folder vars resolved (see data-model §5) |
| `response[]` | `Example[]` | `examples/**` + body sidecars | Full |
| `response.originalRequest` | `RequestExample` | | Full |
| `response.code/status/header/cookie/body/_postman_previewlanguage` | `ResponseExample` | | Full |
| `response.responseTime` | preserved | | Preserved |
| `protocolProfileBehavior` | `RequestSettings` (known keys) + `extra` | | Partial: `followRedirects`, `maxRedirects`, `strictSSL`, `disableBodyPruning`, `disableCookies` (no cookie jar, PIGN-045) used; others preserved |
| `request.proxy`, `request.certificate` | `extra` | | Preserved, not used |
| `description` object `{content,type}` | `Description` | | Full |
| Any unknown key at any level | `extra` | written back | Preserved |

### A.3 Preservation of unknown fields

- Each normalized entity keeps `extra` for keys the importer does not model. The project writer emits them (sorted, see file-format §3); the Postman exporter emits them in place.
- Entities whose structure is not modeled at all (unsupported auth params, `proxy`, `certificate`, unknown body modes) are stored verbatim.
- An unknown **body mode** makes the request read-only for the body section (other sections editable) to avoid corrupting it.
- Preservation is best-effort for keys inside arrays Pigeon rewrites (e.g. a header's unknown key survives because headers keep `extra`; a query param removed by the user loses its extras, as expected).

### A.4 Normalizations (documented, not "loss")

Round-trip `import → Save for Commit → export` must be **semantically equal** to the input, modulo:
1. Key order and whitespace.
2. URL derived parts regenerated from `raw` (`host`, `path`, `protocol`, `port`); `raw` is authoritative. If the input's derived parts disagree with `raw`, Pigeon keeps `raw` and records a warning in the import report.
3. Missing `item.id` / example `id` generated.
4. Header string form → array form.
5. Empty/default values omitted (`disabled: false`, empty `description`).
6. v2.0 inputs exported as v2.1.
7. Form-data/binary absolute file paths inside the project folder rewritten to project-relative on import (warning listed).
8. Examples come back in file-key order: a project stores no example order (`response[]` is compared as a set).
9. File form-data rows: an empty `value` is the same as none (exports omit it, like Postman).

The compatibility test suite asserts `normalize(export(import(x))) deepEquals normalize(x)` for every fixture.

### A.5 Export options

| Option | Default | Effect |
|---|---|---|
| Include examples | on | writes `response[]` with bodies inlined as strings |
| Include Pigeon metadata | off | keeps `_pigeon` keys (Postman ignores unknown keys on import — **Assumption**: not yet checked in Postman, see PIGN-029 notes) |
| Scope | whole collection | also: a single folder as a collection |

Exported file name: `<collection name>.postman_collection.json`.

### A.6 Not supported (by design or by Postman format)

- Postman WebSocket, gRPC, Socket.IO, MQTT requests and Postman's newer standalone GraphQL request type are **not representable in v2.1 exports** and are out of scope.
- Postman flows, mocks, monitors, APIs/specs, workspaces, team data.
- Scripts run with the `pm` subset in §A.7 only (no `pm.sendRequest`, cookies, visualizer, `setNextRequest`, `require`).
- Postman vault references (`{{vault:…}}`) are left unresolved (highlighted).

### A.7 Scripts (PIGN-043/044)

Pre-request scripts run before each send and test scripts after the response (also in regression
runs) in a QuickJS sandbox in a Web Worker, the same on desktop and web: collection → folders
(outermost first) → request, sharing one state. Test results show in the response's **Tests** tab
and badge, and per request in runs. Each script stops after **5 s** and has a 64 MB heap; a failing script stops the send
with "Pre-request script error in <place>: …" and its output stays in the **Console** tab. The
sandbox has only JavaScript built-ins: no `fetch`/XHR/WebSocket, timers, DOM, storage, Node,
Tauri, file system or `require`. Settings → Scripts turns execution off per project.

| API | Support |
|---|---|
| `pm.environment`, `pm.collectionVariables`, `pm.globals`: `get`, `set`, `unset`, `has`, `toObject`, `replaceIn` | Yes. `set`/`unset` change **current values** (this machine), never shared values in files; this send sees them at once. `pm.environment.set` with no environment selected throws |
| `pm.variables`: `get`, `set`, `unset`, `has`, `toObject`, `replaceIn` | Yes. `get` resolves request-local → environment → folders → collection → globals; `set` makes a request-local variable for this send only |
| `pm.request`: `method`, `url` (`toString`, `update`, `getHost`, `getPath`; assignable), `headers` (`get`, `has`, `add`, `upsert`, `remove`, `toObject`, `each`, `count`), `addHeader`, `removeHeader`, `body.mode`, `body.raw` (read/write for raw bodies), `body.update` | Yes. Other body modes are read-only |
| `pm.info`: `requestName`, `requestId`, `eventName`, `iteration`, `iterationCount` | Yes |
| `console.log` / `info` / `warn` / `error` / `debug` | Yes → Console tab (per project, last 500 entries; secret values masked) |
| `postman.setEnvironmentVariable` / `getEnvironmentVariable` / `setGlobalVariable` / `getGlobalVariable` (legacy) | Yes |
| `pm.sendRequest`, `pm.cookies`, `pm.vault`, `pm.execution.*`, `require(...)`, `pm.environment.clear` | No: throws `NotSupportedInPigeon: <name>` |
| `pm.test(name, fn)` | Test scripts. A failed assertion is **fail**, any other thrown error **error**; the next tests still run. `pm.test.skip` records a skipped test. A script that throws outside `pm.test` (or times out) is an **error** result named after its place; the next script still runs |
| `pm.response`: `code`, `status`, `headers.get/has/toObject/each`, `json()`, `text()`, `responseTime`, `responseSize`, `to.have.status(code or text)`, `to.have.header(name[, value])`, `to.be.ok`, `to.have.jsonBody()` | Test scripts (the body is passed as text, at most 10 MB) |
| `pm.expect` (own chai-style subset, not chai): chains `to be been is that which and has have with at of same but does still also`; `not`, `deep`; `equal/equals/eq`, `eql`, `include/contain`, `a/an(type)`, `true`, `false`, `null`, `undefined`, `NaN`, `ok`, `exist`, `empty`, `property(name[, value])`, `length/lengthOf`, `above/gt`, `below/lt`, `least/gte`, `most/lte`, `within`, `match`, `oneOf`, `keys`; `pm.expect.fail` | Yes; messages read like chai's ("expected 1 to equal 2") |
| Other chai features (`satisfy`, `throw`, `members`, `closeTo`, plugins…) | Not available: calling them throws a TypeError, reported as an **error** result |

---

## Part B — Environments

### B.1 Pigeon ↔ Postman environment (Observed)

Postman environment export:
```json
{
  "id": "uuid",
  "name": "Staging",
  "values": [
    { "key": "baseUrl", "value": "https://staging.example.com", "type": "default", "enabled": true },
    { "key": "token", "value": "", "type": "secret", "enabled": true }
  ],
  "_postman_variable_scope": "environment",
  "_postman_exported_at": "2025-01-01T00:00:00.000Z",
  "_postman_exported_using": "Postman/11.x"
}
```

| Postman | Pigeon | Notes |
|---|---|---|
| `id` | `Environment.id` | generated if missing |
| `name` | `name` | |
| `values[].key` | `Variable.key` | |
| `values[].value` | `Variable.value` (shared/initial) | **Assumption to verify**: whether Postman exports write the *initial* or the *current* value has varied between Postman versions. Pigeon treats the imported `value` as the shared value and offers "Also use as my current values" in the import dialog. |
| `values[].type` `default` / `secret` / other | `type` | `secret` → masked + SecretStore; other types (`text`, `any`) preserved |
| `values[].enabled` | `enabled` | missing → `true` |
| `values[].description` | `description` | if present |
| `_postman_variable_scope` | — | `environment` / `globals` used for detection |
| `_postman_exported_*` | dropped in project files | regenerated on export (`_postman_exported_using: "Pigeon/<version>"`) |
| unknown keys | `extra` | preserved |

Globals (`*.postman_globals.json`, `_postman_variable_scope: "globals"`) map to project `globals`. Pigeon has **no cross-project globals** (project isolation); importing globals targets the current project.

Export: one Postman environment file per environment. Secret variables are exported with their **shared** value only (normally empty) — current values/secrets are never exported.

### B.2 Apidog (Observed — PIGN-048)

Observed from real exports (Apidog desktop, November 2026; project export format `$schema.version` **1.2.0**), sanitized into `packages/fixtures/apidog/`:

- **Environment export** (Environment Management → Export, `environment-export.apidog.json`): `{ "environments": [ … ], "servers": [ { "id", "name", "importSourceServerId"? } ] }`.
- **Project export** in Apidog format (`project-export.apidog.json`): `{ "apidogProject": "1.0.0", "$schema": { "app": "apidog", "type": "project", "version": "1.2.0" }, "info", "projectSetting": { "servers": [ { "id", "name", "moduleId" } ], … }, "moduleSettings": [ { "id", "name", "description" } ], "environments", "globalVariables": [ { "id", "variables": [] } ], "apiCollection", "requestCollection", "docCollection", "schemaCollection", … }`.

An environment holds `name`, `variables`, `baseUrl` (the main base URL), `baseUrls` (one per service: keyed by **module id** in project exports and by **server id**, incl. `default`, in environment exports), `parameters` (`cookie` / `query` / `header` / `body` lists), `advancedSettings` (proxy per service), `requestProxyAgentSettings`, `websocketBaseUrls`, `socketioBaseUrls`, `registrationCenters`, `type` (`normal`), and bookkeeping (`id`, `visibility`, `ordering`, `tags`, `projectType`). A variable holds `name`, `initialValue` (the shared value), `value` (the current one), `description`, `isSync` (`true` in all samples) and sometimes `securityType` (only `default` observed). Server names were all "Default Server"; module names come from `moduleSettings`.

Mapping (`formats/src/apidog/environments.ts`):

| Apidog | Pigeon |
|---|---|
| environment `name` | `Environment.name` (new id; Apidog ids are not kept) |
| variable `name` / `initialValue` | `Variable.key` / `Variable.value` (written to files) |
| variable `value` when it differs from `initialValue` | offered as the local current value ("use as my current values") |
| `isSync: false` (not observed) | value not written to files, only offered as the current value |
| `securityType` other than `default` (not observed) | `type: 'secret'`, reported |
| names ending like a credential (`…secret`, `…password`, `…token`, `…apiKey`, `…privateKey`, `…credentials`) with a value | `type: 'secret'` (value only on this machine), reported so it can be changed back |
| `baseUrl` (or the `default` service's URL) | variable `baseUrl` (name editable in the import dialog), first in the list |
| other non-empty `baseUrls` with a different URL | `baseUrl_<module name or service id>`; empty services are skipped and counted in the report |
| `globalVariables[].variables` (only empty lists observed) | project globals, same variable mapping |
| `parameters` (non-empty), WebSocket/Socket.IO base URLs, registration centers, non-default proxy settings, unknown `type`, unknown environment or variable fields | not imported; listed in the import report |
| `id`, `visibility`, `ordering`, `tags`, `projectType`, `servers`, `moduleSettings` | used for naming only or ignored (Apidog bookkeeping) |
| project APIs, docs, schemas, scripts (`apiCollection`, …) | not imported; the report says to export them as OpenAPI or Postman |

A base URL variable whose name is already used by an exported variable is not added (reported). Detection is structural: `$schema.app === "apidog"` or `apidogProject` (project export), or `environments` whose entries have `variables` plus `baseUrl`/`baseUrls` next to a `servers` list (environment export). Project exports without environments or global variables are rejected with a hint to export the APIs as OpenAPI or Postman.

Fallback: an Apidog-looking file that does not match shows "Unrecognized Apidog export. Export environments from Apidog in Postman format, or share a sample to add support."

### B.3 Echo API (Assumption — needs samples, PIGN-049)

What we believe (unverified):
- EchoAPI advertises Postman compatibility (import/export of Postman collections, possibly environments). If EchoAPI exports Postman-format environments, **no dedicated importer is needed** — the Postman importer handles them.
- EchoAPI's native export format (if any) is unknown.

Plan: PIGN-049 starts by collecting real export samples. If they are Postman-compatible, the story reduces to adding fixtures + tests + a detection hint. Otherwise a mapping table like B.2 is written from the samples before implementation.

### B.4 Detection order

`detectFormat()` checks, in order: Pigeon project zip → Postman collection v2.1 → v2.0 → v1 (reject) → Postman environment → Postman globals → Apidog (PIGN-048) → EchoAPI native (PIGN-049) → cURL text (PIGN-050) → unknown. Detection is structural (keys and schema URLs), never by file name alone.

### B.5 Compatibility summary

| Source | Collections | Environments | Globals | Status |
|---|---|---|---|---|
| Postman v2.1 | import + export | import + export | import + export | MVP, Confirmed/Observed |
| Postman v2.0 | import | — | — | MVP |
| Apidog | via Postman/OpenAPI export (not Pigeon's concern) | import (environment and project exports) | import (project export) | PIGN-048, Observed (format 1.2.0) |
| Echo API | via Postman export | via Postman export or native (planned) | ? | Later, Assumption |
| cURL command | one request (import); snippet out | — | — | Later (PIGN-050), Observed |

### B.6 cURL commands (PIGN-050)

`formats/src/curl/parse.ts` splits the text into words with the quoting of the shell it was written for, detected from its line continuations and escapes: **bash** (`'…'`, `"…"`, `$'…'`, `\` + newline — Chromium "Copy as cURL" on macOS/Linux and "Copy as cURL (bash)" on Windows), **cmd** (`^` escapes, `^"…^"` quoting, `\"` inside arguments, `^` + newline — "Copy as cURL (cmd)") and **PowerShell** (`curl.exe`, `'…'` with `''`, backtick continuations). Nothing is executed. Fixtures: `packages/fixtures/curl/`.

| cURL | Pigeon |
|---|---|
| URL, `--url` (no scheme → `http://`) | URL (query rows from it) |
| `-X/--request`, `-I/--head`, `-G/--get` | method (default GET, POST with data); `-G` moves data into the query |
| `-H/--header`, `-A`, `-e`, `-b/--cookie` (name=value) | headers (`User-Agent`, `Referer`, `Cookie`) |
| `-d/--data*`, `--data-raw`, `--data-binary`, `--data-urlencode`, `--json` | raw JSON/text/XML (by `Content-Type` or shape) or urlencoded rows (`key=value&…` with a form or no content type); `@file` → file body |
| `-F/--form`, `--form-string` | form-data rows; `@file`/`<file` → file rows (pick the file after import), `;type=` kept |
| `-u/--user`, `--oauth2-bearer` | Basic / Bearer auth on the request |
| `-k`, `-L`, `--max-redirs`, `-m/--max-time` | TLS verification off, follow redirects, max redirects, timeout |
| `--compressed`, `-s`, `-S`, `-v`, `-i`, `-o`, `-w`, `--http2`, … | ignored silently (no effect on the request) |
| `--proxy`, `--cert`, `-T`, `-c`, … and unknown options | ignored with a warning in the preview / toast |

Snippets (`formats/src/snippets/`): cURL (bash; `--form-string` for text parts so values starting with `@` stay text, `$'…'` for control characters), JavaScript `fetch`, Python `requests`, Go `net/http`. Generated cURL parses back to an equivalent request (tested).
