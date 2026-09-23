# Pigeon — Domain / Data Model

The domain model lives in `packages/core/src/model/`. It is a **normalized, Postman-semantics model**: every concept maps to a Postman v2.1 concept where one exists, but shapes are normalized (e.g. URL is always an object, headers always an array) so that the rest of the code never handles Postman's alternative encodings. Mapping to/from files is done in `packages/formats`.

Every Postman-derived entity has `extra: Record<string, unknown>` holding unknown keys from the source JSON, so they are written back unchanged (see [compatibility.md](compatibility.md)).

## 1. Relationships

```text
Project (pigeon.json)
 ├── globals: VariableSet                         (environments/globals.postman_globals.json)
 ├── comparisonDefaults: ComparisonDefaults
 ├── Collection[]  (ordered)                      (collections/<c>/collection.json)
 │    ├── variables: Variable[]
 │    ├── auth?, events[]
 │    └── children: (Folder | Request)[] ordered
 │         Folder                                 (collections/<c>/<f>/folder.json)
 │          └── children: (Folder | Request)[]
 │         Request                                (collections/<c>/.../<r>.request.json)
 │          ├── examples: Example[]               (examples/<c>/.../<r>/<e>.example.json + body sidecar)
 │          │    ├── RequestExample  (originalRequest)
 │          │    └── ResponseExample (status, headers, body)
 │          └── comparison: ComparisonConfig?     (examples/<c>/.../<r>/compare.json)
 │                └── rules: FieldRule[]
 └── Environment[]                                (environments/<env>.postman_environment.json)
      └── values: Variable[]

Local (never in project files, per project):
 LocalProjectState ── drafts[], tabs, selectedEnvironmentId, variable current values,
                      last ExecutionResults, ComparisonResults, RunReports, SchemaSnapshot cache
App-wide local: AppState ── recent projects, open projects, preferences
```

## 2. Identity

- `Id = string` — UUID v4 (`crypto.randomUUID()`).
- Postman ids (`info._postman_id`, `item.id`, `response.id`, environment `id`) are preserved on import when present and unique within the project; otherwise a new UUID is generated (the import report lists regenerated ids).
- Ids are stable forever; renames and moves never change ids.
- `EntityRef = { kind: EntityKind; id: Id }` where `EntityKind = 'project' | 'collection' | 'folder' | 'request' | 'example' | 'compareConfig' | 'environment' | 'globals'`.
- File location is **not** part of identity. Each file-backed entity carries `fileKey` (its slug, e.g. `get-user`) assigned at creation/rename (see [file-format.md §4](file-format.md#4-naming-rules)).

## 3. Project

```ts
interface ProjectModel {
  id: Id;
  name: string;
  formatVersion: 1;
  collections: Collection[];          // ordered
  environments: Environment[];        // ordered by fileKey on load; UI may sort by name
  globals: VariableSet;
  comparisonDefaults: ComparisonDefaults;
  extra: Record<string, unknown>;     // unknown keys in pigeon.json
}
```

## 4. Collection, Folder, Request

```ts
interface Collection {
  id: Id; fileKey: string;
  name: string;
  description?: Description;          // string | { content: string; type?: string }
  version?: string;                   // info.version, preserved
  auth?: Auth;                        // undefined = none at root (Postman semantics)
  events: ScriptEvent[];
  variables: Variable[];
  children: Item[];                   // ordered
  extra: Record<string, unknown>;     // unknown keys on collection root + info.*
}

type Item = Folder | Request;

interface Folder {
  kind: 'folder';
  id: Id; fileKey: string;
  name: string;
  description?: Description;
  auth?: Auth;                        // undefined = inherit
  events: ScriptEvent[];
  variables: Variable[];              // preserved; Postman folders rarely use this
  children: Item[];
  extra: Record<string, unknown>;
}

interface Request {
  kind: 'request';
  id: Id; fileKey: string;
  name: string;
  description?: Description;
  method: string;                     // uppercase; custom methods allowed
  url: Url;
  headers: KeyValue[];
  body: Body;
  auth?: Auth;                        // undefined = inherit from parent
  events: ScriptEvent[];
  settings: RequestSettings;
  examples: Example[];                // ordered
  comparison?: ComparisonConfig;
  extra: Record<string, unknown>;     // unknown keys on item + request (namespaced, see formats)
}

interface Url {
  raw: string;                        // source of truth for host/path; e.g. "{{baseUrl}}/users/:id?x=1"
  query: QueryParam[];                // kept in sync with raw by the editor
  pathVariables: KeyValue[];          // ":id" → { key: 'id', value: '42' }
  extra: Record<string, unknown>;     // e.g. hash, unknown keys
}

interface KeyValue {
  key: string;
  value: string;
  disabled?: boolean;
  description?: Description;
  type?: string;                      // preserved Postman "type" when present
  extra?: Record<string, unknown>;
}
type QueryParam = KeyValue;           // value may be null in Postman ("?flag") → value '' + extra.valueNull

type Body =
  | { mode: 'none' }
  | { mode: 'raw'; raw: string; language: 'json' | 'text' | 'xml' | 'html' | 'javascript'; extra?: Rec }
  | { mode: 'urlencoded'; params: KeyValue[]; extra?: Rec }
  | { mode: 'formdata'; params: FormDataParam[]; extra?: Rec }
  | { mode: 'file'; src?: string; extra?: Rec }                    // binary body
  | { mode: 'graphql'; query: string; variables: string; operationName?: string; extra?: Rec };
// every body variant may also carry `disabled?: boolean` (Postman body.disabled)

interface FormDataParam extends KeyValue {
  kind: 'text' | 'file';
  src?: string | string[];            // file paths: project-relative preferred
  contentType?: string;
}

interface RequestSettings {           // maps to protocolProfileBehavior + Pigeon settings
  followRedirects?: boolean;          // default true
  maxRedirects?: number;              // default 10
  strictSSL?: boolean;                // default true (desktop only)
  disableBodyPruning?: boolean;       // allow body on GET (desktop only)
  timeoutMs?: number;                 // Pigeon-only, default from preferences
}
```

**Protocol** is derived: `body.mode === 'graphql'` → GraphQL request; otherwise HTTP. (Postman v2.1 has no separate request type.) Future protocols add a `protocol` discriminator stored under `_pigeon.protocol`.

### 4.1 Auth

```ts
type Auth =
  | { type: 'noauth' }
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string }
  | { type: 'apikey'; key: string; value: string; in: 'header' | 'query' }
  | { type: string; params: KeyValue[]; unsupported: true };   // digest, oauth2, awsv4, ... preserved verbatim
// All variants may carry extra params preserved from Postman arrays.
```
Inheritance: `auth === undefined` on a folder/request means "inherit from parent"; the effective auth is the nearest defined ancestor; `noauth` stops inheritance. Collection root `undefined` = no auth.

### 4.2 Scripts

```ts
interface ScriptEvent {
  listen: 'prerequest' | 'test' | string;
  script: { id?: string; type?: string; exec: string[]; src?: unknown; name?: string };
  disabled?: boolean;
  extra?: Record<string, unknown>;
}
```
MVP: stored, displayed, editable; **not executed** (PIGN-031). Execution: PIGN-043/044.

## 5. Variables and environments

```ts
interface Variable {
  key: string;
  value: string;                      // SHARED / initial value — the only value written to files
  type: 'default' | 'secret' | string;// Postman env types; collection vars may be 'string'|'boolean'|'number'|'any'
  enabled: boolean;                   // Postman env "enabled" / collection var !disabled
  description?: Description;
  extra?: Record<string, unknown>;
}

interface Environment {
  id: Id; fileKey: string;
  name: string;
  values: Variable[];                 // ordered as in file
  extra: Record<string, unknown>;
}

interface VariableSet {               // project globals
  id: Id;
  values: Variable[];
  extra: Record<string, unknown>;
}
```

**Current values** are local-only overrides: `LocalProjectState.currentValues[scopeKey][variableKey] = string`, where `scopeKey` is `env:<envId>`, `collection:<collectionId>`, or `globals`. The effective value of a variable is `currentValue ?? value`.

**Secret variables** (`type: 'secret'`): the shared `value` in files is whatever the user explicitly set as the shared value (normally empty); the current value is stored in `SecretStore`. The UI masks both. See [file-format.md §7](file-format.md#7-secrets).

**Scope precedence** (highest first, Postman-compatible): request-local (scripts, later) → iteration data (later) → environment → collection → globals. Folder variables are preserved but resolved as collection-scope overrides for items inside that folder (nearest folder wins) — documented Pigeon behaviour.

**Dynamic variables** (`{{$name}}`): MVP set `$guid`, `$randomUUID`, `$timestamp` (unix seconds), `$isoTimestamp`, `$randomInt` (0–1000). Unknown `$` variables stay unresolved and are highlighted.

## 6. Examples

Postman stores an example as a `response` object that contains an `originalRequest`. Pigeon models the two halves explicitly.

```ts
interface Example {
  id: Id; fileKey: string;
  requestId: Id;
  name: string;
  request: RequestExample;
  response: ResponseExample;
  extra: Record<string, unknown>;
}

interface RequestExample {            // Postman "originalRequest"
  method: string;
  url: Url;
  headers: KeyValue[];
  body: Body;
  auth?: Auth;                        // copied definition (variables unresolved; secrets never resolved)
  extra: Record<string, unknown>;
}

interface ResponseExample {
  code: number;
  status: string;                     // status text, e.g. "OK"
  headers: KeyValue[];
  cookies: unknown[];                 // Postman "cookie" array preserved
  body: ExampleBody;
  previewLanguage?: string;           // _postman_previewlanguage
  responseTimeMs?: number | null;     // not written to files by default (volatile); preserved if imported
}

type ExampleBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string; format: 'json' | 'xml' | 'html' | 'text' | 'javascript' }
  | { kind: 'binary'; bytes: Uint8Array };
```

When saving a live response as an example, `RequestExample` is built from the **request definition** (unresolved `{{vars}}`), not the resolved prepared request, so secrets never leak into files.

## 7. Comparison

```ts
interface ComparisonConfig {
  requestId: Id;
  baseline: { mode: 'auto' } | { mode: 'example'; exampleId: Id } | { mode: 'none' };
  status?: 'exact' | 'class' | 'ignore';            // default from ComparisonDefaults
  headers?: HeaderComparison;
  body?: BodyComparison;
  rules: FieldRule[];                                // sorted by path on write
}

interface ComparisonDefaults {                       // pigeon.json "comparison"
  status: 'exact' | 'class' | 'ignore';              // default 'exact'
  headers: HeaderComparison;                         // default { compare: ['content-type'], mode: 'media-type' }
  body: BodyComparison;                              // default { mode: 'schema', additionalFields: 'warn', distinguishIntegers: false }
  rules: FieldRule[];                                // project-wide, e.g. { path: '$..requestId', dynamic: true }
}

interface HeaderComparison {
  compare: string[];                                 // lowercase header names checked
  mode: 'presence' | 'value' | 'media-type';         // media-type = compare type/subtype, ignore params
  ignore?: string[];
}

interface BodyComparison {
  mode: 'schema' | 'values' | 'none';
  additionalFields: 'ignore' | 'warn' | 'fail';
  distinguishIntegers: boolean;
  arrays?: 'schema' | 'index' | { matchBy: string }; // value mode array matching
}

interface FieldRule {
  path: string;                                      // path pattern, see response-comparison.md
  optional?: boolean;                                // absence → warning
  nullable?: boolean;                                // null ↔ value → pass
  ignore?: boolean;                                  // skip path and descendants
  dynamic?: boolean;                                 // value changes allowed (value mode)
  type?: JsonType | JsonType[] | 'any';              // explicit allowed types
  note?: string;
}

type JsonType = 'null' | 'boolean' | 'number' | 'integer' | 'string' | 'array' | 'object';
```

### 7.1 Schema snapshot (derived, local)

```ts
interface SchemaSnapshot {
  exampleId: Id;
  sourceHash: string;                  // hash of example body + rules; cache key
  root: SchemaNode;
}
interface SchemaNode {
  types: JsonType[];                   // sorted
  properties?: Record<string, { node: SchemaNode; seen: number; of: number }>; // object keys; seen<of ⇒ optional within arrays
  items?: SchemaNode;                  // merged schema of all array elements
  emptyArray?: boolean;                // baseline array had no items
}
```
Snapshots are **derived** from the baseline example body; they are cached in local state and never committed. Export as JSON Schema is PIGN-056.

### 7.2 Results (local)

```ts
interface ComparisonResult {
  requestId: Id; exampleId: Id; executionId: Id;
  outcome: 'pass' | 'warn' | 'fail';
  findings: Finding[];
  counts: { fail: number; warn: number; info: number; ignored: number };
}
interface Finding {
  kind: 'status.changed' | 'header.missing' | 'header.changed' | 'header.added'
      | 'body.field.added' | 'body.field.removed' | 'body.type.changed'
      | 'body.value.changed' | 'body.array.length' | 'body.contentType.changed' | 'body.parse.failed';
  path?: string;                       // concrete path, e.g. $.data.items[3].id
  schemaPath?: string;                 // generalized, e.g. $.data.items[*].id (used for "mark as ..." actions)
  severity: 'fail' | 'warn' | 'info' | 'ignored';
  baseline?: unknown; actual?: unknown;
  rule?: FieldRule;                    // rule that changed the severity
  count?: number;                      // de-duplicated array findings: number of occurrences
  examplePaths?: string[];             // first 3 concrete paths when count > 1
  message: string;
}
```

## 8. Execution

`PreparedRequest`, `RawResponse`, `ExecutionResult` — see [api-execution.md](api-execution.md). `ExecutionResult` is local state only.

## 9. Local state

```ts
interface LocalProjectState {
  schemaVersion: 1;
  projectId: Id;
  location: ProjectLocation;
  drafts: Draft[];
  currentValues: Record<string /* scopeKey */, Record<string, string>>; // non-secret current values
  selectedEnvironmentId?: Id | null;
  tabs: { open: TabRef[]; activeIndex: number; previewTab?: TabRef };
  explorer: { expanded: Id[] };
  layout: { responsePanel: 'bottom' | 'right'; sizes: Record<string, number> };
  lastResults: Record<Id /* requestId */, StoredExecutionResult>; // bounded, see file-format.md
  lastComparisons: Record<Id, ComparisonResult>;
  runReports: RunReportSummary[];     // bounded (last 20)
  conflicts: Conflict[];
}

interface Draft {
  ref: EntityRef;
  op: 'create' | 'update' | 'delete';
  data?: unknown;                      // full entity (without children) for create/update
  parentId?: Id | null;                // for create/move
  index?: number;                      // position among siblings
  baseHash?: string;                   // sha-256 of the entity's file bytes when the draft started (conflict detection)
  savedAt: string;                     // ISO time (local only)
}

interface AppState {
  schemaVersion: 1;
  recentProjects: Array<{ projectId: Id; name: string; location: ProjectLocation; lastOpenedAt: string }>;
  openProjects: Id[];
  activeProjectId?: Id;
  preferences: Preferences;            // theme, fontSize, defaultTimeoutMs, responsePanel, sendOnEnter, ...
}
```

Unsaved (in-memory) edits are **not** part of `LocalProjectState`: they live in the `ProjectSession` until the user Saves. (Crash recovery / autosave is a later preference.)

## 10. Change states of an entity

```text
clean ──edit──▶ unsaved ──Save──▶ saved-local (draft) ──Save for Commit──▶ clean
  ▲                │                     │
  └──discard───────┴────discard──────────┘
files changed externally while draft exists ──▶ conflict ──resolve──▶ saved-local | clean
```

| State | Indicator |
|---|---|
| unsaved | tab dot ● |
| saved-local | explorer badge **M** (or **A** new, **D** deleted) + counted in Pending Changes |
| conflict | explorer badge **!** + banner |
