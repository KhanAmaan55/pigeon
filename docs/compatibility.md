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
| `body.mode: graphql` (`query`, `variables`) | `Body.graphql` | | Full |
| `body.disabled`, `body.options.*` | `extra` | | Preserved |
| `auth` noauth / basic / bearer / apikey | `Auth` typed | | Full (executed) |
| `auth` digest / awsv4 / oauth2 | `Auth unsupported` | preserved verbatim | Preserved; executed in PIGN-046/047 |
| `auth` oauth1 / hawk / ntlm / akamai / edgegrid / jwt / asap / others | `Auth unsupported` | preserved verbatim | Preserved only; UI shows "Not supported yet — request sent without auth" |
| `event[]` prerequest / test | `ScriptEvent[]` | | Preserved + editable (MVP); executed later (PIGN-043/044) |
| `variable[]` (collection) | `Collection.variables` | | Full |
| `variable[]` (folder/request level) | preserved | | Preserved; folder vars resolved (see data-model §5) |
| `response[]` | `Example[]` | `examples/**` + body sidecars | Full |
| `response.originalRequest` | `RequestExample` | | Full |
| `response.code/status/header/cookie/body/_postman_previewlanguage` | `ResponseExample` | | Full |
| `response.responseTime` | preserved | | Preserved |
| `protocolProfileBehavior` | `RequestSettings` (known keys) + `extra` | | Partial: `followRedirects`, `maxRedirects`, `strictSSL`, `disableBodyPruning` used; others preserved |
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

The compatibility test suite asserts `normalize(export(import(x))) deepEquals normalize(x)` for every fixture.

### A.5 Export options

| Option | Default | Effect |
|---|---|---|
| Include examples | on | writes `response[]` with bodies inlined as strings |
| Include Pigeon metadata | off | keeps `_pigeon` keys (Postman ignores unknown keys on import — **Observed**, verify in PIGN-029) |
| Scope | whole collection | also: a single folder as a collection |

Exported file name: `<collection name>.postman_collection.json`.

### A.6 Not supported (by design or by Postman format)

- Postman WebSocket, gRPC, Socket.IO, MQTT requests and Postman's newer standalone GraphQL request type are **not representable in v2.1 exports** and are out of scope.
- Postman flows, mocks, monitors, APIs/specs, workspaces, team data.
- `pm.*` script execution in MVP (preserved only).
- Postman vault references (`{{vault:…}}`) are left unresolved (highlighted).

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

### B.2 Apidog (Assumption — needs samples, PIGN-048)

What we believe (unverified):
- Apidog projects can be exported in an Apidog-specific JSON format that includes environments; Apidog environments contain a list of variables (name, initial/current value, description) and one or more **base URLs** ("services"/"front URLs") per environment.
- Apidog can also export in other formats (OpenAPI, possibly Postman) — whether environments are included in a Postman-format export is unknown.

Planned mapping (to be confirmed against real files):

| Apidog (assumed) | Pigeon |
|---|---|
| environment name | `Environment.name` |
| variables `name` / `value` (initial) | `Variable.key` / `Variable.value` |
| variable current value | offered as local current value (not written to files) |
| secret/sensitive flag (if present) | `type: 'secret'` |
| base URL (single) | variable `baseUrl` (name configurable in import dialog) |
| multiple base URLs (per service/module) | variables `baseUrl`, `baseUrl_<serviceSlug>`; import report lists them |
| globals (if present) | project globals |

Fallback: if the file is not recognized, show: "Unrecognized Apidog export. Export environments from Apidog in Postman format, or share a sample to add support."

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
| Apidog | via Postman/OpenAPI export (not Pigeon's concern) | import (planned) | import (planned) | Later, Assumption |
| Echo API | via Postman export | via Postman export or native (planned) | ? | Later, Assumption |
