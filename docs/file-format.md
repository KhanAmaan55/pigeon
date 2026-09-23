# Pigeon — File Format & Git Model

Project files are the **source of truth for shared API definitions**. They must be human-readable, deterministic, Git-friendly, and Postman-shaped. Implementation: `packages/formats/src/project/` and `packages/formats/src/canonical-json.ts`.

## 1. Directory structure

```text
my-api/                                   # the folder the user opens
  pigeon.json                             # project manifest (required; marks the folder as a Pigeon project)
  .gitattributes                          # written once on project creation (optional, user-owned afterwards)
  collections/
    users-api/                            # one directory per collection (fileKey)
      collection.json                     # collection root: info, auth, events, variables, order
      list-users.request.json
      admin/                              # folder (fileKey)
        folder.json                       # folder: name, description, auth, events, order
        delete-user.request.json
  environments/
    local.postman_environment.json        # Postman environment export format (minus volatile keys)
    staging.postman_environment.json
    globals.postman_globals.json          # project globals (optional)
  examples/
    users-api/                            # mirrors collections/ tree
      list-users/                         # one directory per request (request fileKey)
        compare.json                      # comparison config + field rules (optional)
        200-ok.example.json               # Postman response object, body moved to sidecar
        200-ok.body.json                  # example body (pretty-printed JSON)
        404-not-found.example.json
        404-not-found.body.json
      admin/
        delete-user/
          204-no-content.example.json     # no body → no sidecar
```

### 1.1 Managed paths

Pigeon reads and writes only:
- `pigeon.json`
- `collections/**/collection.json`, `collections/**/folder.json`, `collections/**/*.request.json`
- `environments/*.postman_environment.json`, `environments/globals.postman_globals.json`
- `examples/**/compare.json`, `examples/**/*.example.json`, `examples/**/*.body.*`

Anything else (READMEs, fixtures, `.gitignore`, files users drop into these folders) is ignored, never modified, never deleted. A directory is removed by Save for Commit only if it becomes empty.

### 1.2 Source-of-truth summary

| Data | Source of truth | File |
|---|---|---|
| Project name, id, format version, collection order, comparison defaults | project file | `pigeon.json` |
| Collection metadata, auth, scripts, variables, child order | project file | `collection.json` |
| Folder metadata, auth, scripts, child order | project file | `folder.json` |
| Request definition, scripts, settings | project file | `*.request.json` |
| Environment shared values | project file | `*.postman_environment.json` |
| Globals shared values | project file | `globals.postman_globals.json` |
| Examples (baselines) | project file | `*.example.json` + `*.body.*` |
| Comparison config & field rules | project file | `compare.json` |
| Drafts, current values, secrets, tabs, selected env, last responses, run reports, schema snapshots | local state | app data (see §6) |

## 2. File contents

All Postman-shaped files use Postman v2.1 field names. Pigeon-only data inside a Postman-shaped object goes under a single `_pigeon` key (mirroring Postman's own `_postman_*` convention). On Postman export, `_pigeon` is stripped by default.

### 2.1 `pigeon.json`
```json
{
  "pigeon": { "formatVersion": 1 },
  "id": "6f1c1f0e-3a61-4f0f-9a39-7c3f2b9f4d10",
  "name": "Users API",
  "collections": ["users-api", "billing"],
  "comparison": {
    "status": "exact",
    "headers": { "compare": ["content-type"], "mode": "media-type" },
    "body": { "mode": "schema", "additionalFields": "warn", "distinguishIntegers": false },
    "rules": [{ "path": "$..requestId", "dynamic": true }]
  }
}
```
`collections` = order of collection directories. Directories not listed are appended in alphabetical order; listed-but-missing entries are dropped (with a warning).

### 2.2 `collection.json`
```json
{
  "info": {
    "_postman_id": "0b4d…",
    "name": "Users API",
    "description": "…",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "auth": { "type": "bearer", "bearer": [{ "key": "token", "value": "{{token}}", "type": "string" }] },
  "event": [],
  "variable": [{ "key": "baseUrl", "value": "http://localhost:3000" }],
  "_pigeon": { "order": ["list-users", "admin"] }
}
```

### 2.3 `folder.json`
```json
{
  "id": "a1f0…",
  "name": "Admin",
  "description": "Admin-only endpoints",
  "auth": { "type": "noauth" },
  "_pigeon": { "order": ["delete-user"] }
}
```
`_pigeon.order` lists child fileKeys (requests and folders share one namespace per directory). Children missing from `order` are appended alphabetically — this makes hand edits and Git merges tolerant.

### 2.4 `*.request.json` (Postman v2.1 `item`, without `response`)
```json
{
  "id": "c9d2…",
  "name": "List users",
  "request": {
    "method": "GET",
    "header": [{ "key": "Accept", "value": "application/json" }],
    "url": {
      "raw": "{{baseUrl}}/users?limit=20",
      "query": [{ "key": "limit", "value": "20" }]
    },
    "description": "Returns a page of users."
  },
  "event": [
    { "listen": "test", "script": { "type": "text/javascript", "exec": ["pm.test('ok', () => pm.response.to.have.status(200));"] } }
  ],
  "protocolProfileBehavior": { "followRedirects": true }
}
```
URL rule: project files store `raw` plus `query` and `variable` (path variables) and any preserved unknown URL keys. Derived parts (`protocol`, `host`, `path`, `port`) are **omitted** in project files and regenerated on Postman export.

### 2.5 `*.postman_environment.json`
```json
{
  "id": "e3b1…",
  "name": "Local",
  "values": [
    { "key": "baseUrl", "value": "http://localhost:3000", "type": "default", "enabled": true },
    { "key": "token", "value": "", "type": "secret", "enabled": true }
  ],
  "_postman_variable_scope": "environment"
}
```
Volatile Postman keys `_postman_exported_at` and `_postman_exported_using` are not written to project files (re-added on export). Globals use the same shape with `"_postman_variable_scope": "globals"`.

### 2.6 `*.example.json` (Postman v2.1 `response`, body in sidecar)
```json
{
  "id": "7aa0…",
  "name": "200 OK",
  "originalRequest": {
    "method": "GET",
    "header": [{ "key": "Accept", "value": "application/json" }],
    "url": { "raw": "{{baseUrl}}/users?limit=20", "query": [{ "key": "limit", "value": "20" }] }
  },
  "status": "OK",
  "code": 200,
  "_postman_previewlanguage": "json",
  "header": [{ "key": "Content-Type", "value": "application/json; charset=utf-8" }],
  "cookie": [],
  "_pigeon": { "requestId": "c9d2…", "bodyFile": "200-ok.body.json" }
}
```
- Body sidecar extension from content type: `.body.json`, `.body.xml`, `.body.html`, `.body.txt`, `.body.js`, else `.body.bin` (raw bytes).
- JSON bodies are written **pretty-printed (2 spaces), keys in original order** (not sorted — order is meaningful to readers and cheap to diff). Invalid JSON with a JSON content type is written as `.body.txt`.
- Volatile response headers (`Date`, `Age`, `X-Request-Id`, `Set-Cookie`, `ETag`, `Last-Modified`, `CF-Ray`, `X-Amzn-Trace-Id`, …) are **dropped by default** when saving an example from a live response (configurable list in preferences), because they create noisy diffs. Imported examples keep all headers.
- `responseTime` is not written (volatile) unless it came from an import.

### 2.7 `compare.json`
```json
{
  "pigeonCompare": 1,
  "requestId": "c9d2…",
  "baseline": { "mode": "auto" },
  "body": { "additionalFields": "fail" },
  "rules": [
    { "path": "$.data[*].avatarUrl", "optional": true, "nullable": true },
    { "path": "$.meta.generatedAt", "ignore": true }
  ]
}
```
Only keys that override `pigeon.json` defaults are written. `rules` sorted by `path`, then by JSON of the rule.

## 3. Deterministic serialization

`canonicalJson.stringify` guarantees byte-identical output for equal models:

1. UTF-8, no BOM, `\n` line endings, final newline.
2. 2-space indentation; one key per line; arrays of objects one element per block. Empty arrays/objects written as `[]` / `{}`.
3. **Key order**: known keys in the canonical order defined per object type in `formats/src/project/key-order.ts` (e.g. item: `id, name, description, request, event, protocolProfileBehavior, …unknown, _pigeon`); unknown keys sorted by code-point order, placed before `_pigeon`; `_pigeon` last.
4. **Omit defaults**: optional keys with `undefined`, empty string, empty array, or default booleans (`disabled: false`) are omitted — except where Postman requires them (`values` in environments, `header` in examples). Normalization on read turns absent into default, so read→write is stable.
5. **No volatile data**: no timestamps, no export metadata, no response times, no machine paths (form-data/binary file paths are stored project-relative when inside the project; absolute paths are kept but flagged with a warning).
6. Non-ASCII characters written literally (not `\u` escaped); `/` not escaped; numbers as JS `JSON.stringify` produces.
7. Scripts are stored as Postman `exec: string[]` (one line per element) → line-level diffs.
8. Array order is semantic and preserved (headers, params, variables, rules sorted as specified above).

**Invariant (tested):** `serialize(read(files)) === files` for any files Pigeon wrote, and Save for Commit with no drafts is a no-op.

## 4. Naming rules

`fileKey` (slug) is derived from the entity name when created or renamed:
1. Unicode NFKD, strip combining marks, lowercase.
2. Replace any run of chars outside `[a-z0-9]` with `-`; trim `-`; truncate to 48 chars (at a `-` boundary when possible).
3. Empty result → `<kind>-<first 8 chars of id>` (e.g. `request-c9d2a1b0`) — covers non-Latin names.
4. Windows reserved names (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`) get a `-1` suffix.
5. Uniqueness within the directory (requests and folders share the namespace; examples unique per request dir): append `-2`, `-3`, …
6. Renaming an entity re-slugs it (Git sees a rename). Moving keeps the slug unless it collides.

Because slugs are lowercase ASCII, case-insensitive filesystems (macOS, Windows) cannot produce collisions Git would see differently.

## 5. Save vs Save for Commit

| | Save (`Cmd/Ctrl+S`) | Save for Commit (`Cmd/Ctrl+Shift+S`) |
|---|---|---|
| Writes to | Local app state (drafts) | Project files |
| Scope | Current tab (or "Save all") | Current entity, a selection in Pending Changes, or all |
| Modifies Git working tree | No | Yes |
| Survives restart | Yes | Yes |
| Visible to teammates | No | After the user commits & pushes |

Rules:
- Every edit starts **unsaved** in memory. Save turns it into a **draft** in local state. Save for Commit on an unsaved edit performs Save first.
- Variable **current values** and secrets are written to local state immediately; they never become drafts and never reach files.
- Structural edits (create, rename, move, delete, reorder) are drafts too, so the whole project can be reorganized and reviewed before files change.
- Import creates drafts; the import dialog defaults to "Write files now" (= Save for Commit of the imported entities).
- Discarding a draft restores the file version.

### 5.1 Commit planning

```text
1. model   = base model + selected drafts           (all drafts for "Save all for commit")
2. desired = project.serialize(model)                → Map<path, bytes>   (managed paths only)
3. actual  = scan managed paths on disk              → Map<path, sha256>
4. plan    = { write: desired paths whose bytes' hash ≠ actual,
               delete: actual managed paths absent from desired
                       (only paths owned by entities touched by the selection when partial),
               rmdir:  directories left empty }
5. Pre-check: for each touched entity with a draft, sha256(current file) must equal draft.baseHash,
              else → conflict (plan blocked for that entity).
6. Pre-check: never write over a managed file that failed to parse on load unless the user chose "Overwrite".
7. Show plan (A/M/D/R list + per-file diff) in Pending Changes → apply.
8. Apply: writes via writeFileAtomic (temp + rename), then deletes, then rmdir.
9. Update base model and file hashes; clear committed drafts; record own-write hashes so the watcher ignores them.
```
Renames are displayed as `R old → new` when a deleted and a written path have the same content hash or belong to the same entity id.

Partial commits: selecting one entity commits it plus any structural prerequisites (e.g. committing a request inside a newly created folder also commits the folder's creation). The planner computes and shows these.

## 6. Local app state

Local state never lives inside the project folder.

| Platform | Location |
|---|---|
| macOS | `~/Library/Application Support/<app-id>/` |
| Windows | `%APPDATA%\<app-id>\` |
| Linux | `$XDG_DATA_HOME/<app-id>/` (default `~/.local/share/<app-id>/`) |
| Web | IndexedDB database `pigeon` (object stores: `app`, `projects`, `handles`, `workspaces`, `blobs`) |

Desktop layout:
```text
<app-data>/
  app.json                               # AppState
  projects/<projectId>/state.json        # LocalProjectState (drafts, tabs, current values, ...)
  projects/<projectId>/results/<requestId>.json   # last response per request (bounded)
  projects/<projectId>/runs/<runId>.json          # run reports (last 20)
  logs/pigeon.log
```
Limits (defaults): last-response bodies stored up to 1 MB each, 50 MB per project on desktop, 20 MB on web; older entries evicted LRU. State files have `schemaVersion` and are migrated forward; unreadable state is backed up (`state.json.bak-<ts>`) and reset — project files are unaffected.

Keying: local state is keyed by `projectId` from `pigeon.json`. If two folders have the same id (copied project), the second opened gets a local-state key of `<projectId>@<hash(location)>` and a warning suggesting "Regenerate project id".

## 7. Secrets

- Variables of `type: "secret"`: current values are stored in `SecretStore`, never in `state.json` (desktop MVP uses a separate `secrets.json` with `0600` permissions; OS keychain in PIGN-053), never in project files, never in exported files (export writes the shared value only).
- Auth fields (passwords, tokens) are just strings in request files. Users should reference variables (`{{token}}`). When a user types a literal value into a password/token field, the editor shows a hint: "This value will be committed. Use a secret variable instead?" with a one-click "Move to secret variable".
- Logs, last-result storage, examples, and run reports mask resolved secret values (`••••`).

## 8. Filesystem changes and conflicts

Sources of external change: `git pull/checkout/merge`, editors, other Pigeon windows.

Detection:
- Desktop: recursive watcher on managed paths, debounced 250 ms; events for files whose hash matches a recent own write are ignored.
- Web (fs-access): re-scan on window focus and on **Refresh**; browser workspace: no external changes possible.

Reload algorithm:
1. Re-read changed managed files; rebuild the base model (incrementally per file where possible, full reload for `pigeon.json` changes).
2. For each changed entity:
   - no draft → working model updates silently (open tabs refresh; unsaved in-memory edits prompt).
   - draft exists and file hash ≠ `draft.baseHash` → **conflict**.
   - entity deleted on disk and draft exists → conflict ("deleted on disk").
3. Parse failure (e.g. Git merge conflict markers) → the entity is marked **broken** with the error; it is read-only, never overwritten, and the explorer shows it with an error badge. Fixing the file on disk clears it.

Conflict resolution (per entity): **Keep mine** (rebase draft onto new file: `baseHash` := new hash), **Take theirs** (discard draft), **Compare** (side-by-side JSON diff of file vs draft). Save for Commit is blocked for conflicted entities.

Order conflicts (`_pigeon.order` merge conflicts) are the most common Git conflict; because missing children are appended alphabetically and unknown entries are dropped, a user can resolve by deleting the conflicting lines.

## 9. Versioning and migration

- `pigeon.json.pigeon.formatVersion` is an integer (MVP: `1`).
- Opening a project with a **newer** formatVersion → read-only mode with a banner ("Created by a newer Pigeon").
- Opening an **older** version → migrate in memory; the migration becomes a draft set the user can Save for Commit (Pigeon never rewrites files silently).
- Migrations live in `formats/src/project/migrations/<from>-to-<to>.ts` with fixtures.

## 10. `.gitattributes`

Written once at project creation (never updated automatically):
```text
pigeon.json text eol=lf
collections/** text eol=lf
environments/** text eol=lf
examples/** text eol=lf
examples/**/*.body.bin binary
```
