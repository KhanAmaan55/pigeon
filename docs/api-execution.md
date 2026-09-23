# Pigeon — API Execution Model

Implementation: `packages/core/src/execution/` (shared), `Transport` implementations in `platform-*`, Rust `http_send` in `apps/desktop/src-tauri/src/http.rs`.

## 1. Pipeline

```text
Request (definition, with {{vars}})
   │  1. collect scopes (env, collection, folder chain, globals, dynamic)      core/variables
   │  2. resolve variables in url, params, headers, body, auth                  core/variables
   │  3. protocol handler: prepare (http | graphql)                             core/execution/protocols
   │     3a. effective auth (inheritance) → AuthHandler.apply()                 core/execution/auth
   │     3b. body encoding (json/text/urlencoded/multipart/file)                core/execution/body
   │     3c. default headers (Content-Type, User-Agent: Pigeon/<v>, Accept: */*)
   │  4. validate against capabilities (e.g. GET+body on web)                   core/execution/validate
   ▼
PreparedRequest ──▶ Transport.send(prepared, { signal })                          platform-*
   ▼
RawResponse ──▶ normalize: decode text, detect content type, size, cookies        core/execution/response
   ▼
ExecutionResult ──▶ (optional) compare against baseline                           compare
```

Everything above `Transport.send` is shared by desktop, web, and Node.

## 2. Types

```ts
interface ExecutionContext {
  projectId: Id;
  environmentId: Id | null;
  scopes: VariableScopes;          // built by core from the working model + local current values/secrets
  preferences: { timeoutMs: number; followRedirects: boolean; maxRedirects: number; strictSSL: boolean };
  capabilities: Capabilities;
}

interface PreparedRequest {
  id: Id;                          // execution id (used for cancel)
  method: string;
  url: string;                     // fully resolved, encoded
  headers: Array<[string, string]>;// ordered, duplicates allowed
  body?: PreparedBody;
  settings: { timeoutMs: number; followRedirects: boolean; maxRedirects: number; strictSSL: boolean };
  meta: { requestId?: Id; protocol: 'http' | 'graphql'; unresolved: string[]; secretValues: string[] };
}

type PreparedBody =
  | { kind: 'bytes'; bytes: Uint8Array }                    // json/text/xml/urlencoded/graphql
  | { kind: 'multipart'; parts: MultipartPart[] }            // transport builds boundary (browser: FormData)
  | { kind: 'file'; ref: FileRef };                          // binary body from a file

type MultipartPart =
  | { name: string; kind: 'text'; value: string; contentType?: string }
  | { name: string; kind: 'file'; file: FileRef; filename: string; contentType?: string };

type FileRef =
  | { kind: 'project'; path: ProjectPath }                   // read through ProjectFileSystem
  | { kind: 'absolute'; path: string }                       // desktop only
  | { kind: 'picked'; id: string };                          // web: in-memory File picked this session

interface RawResponse {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;  // raw order, duplicates kept (Set-Cookie)
  body: Uint8Array;                  // decoded (content-encoding removed)
  url: string;                       // final URL after redirects
  redirects: Array<{ status: number; url: string; location: string }>; // empty on web
  httpVersion?: string;
  timings: { startedAt: number; totalMs: number; ttfbMs?: number };
  headersRestricted: boolean;        // true on web: some headers invisible
}

interface ExecutionResult {
  id: Id;
  requestId?: Id;
  environmentId: Id | null;
  startedAt: string;
  transport: Capabilities['transport'];
  request: { method: string; url: string; headers: Array<[string, string]>; bodyPreview?: string }; // secrets masked
  response?: NormalizedResponse;     // absent on error
  error?: ExecutionError;
  warnings: string[];                // unresolved variables, dropped forbidden headers, …
}

interface NormalizedResponse extends RawResponse {
  contentType?: string;              // media type lowercased
  bodyText?: string;                 // when textual (utf-8 / charset from header)
  json?: unknown;                    // parsed when media type is JSON (+json suffix) and parse succeeds
  sizeBytes: number;
  cookies: ParsedSetCookie[];        // desktop only (web can't see Set-Cookie)
}

interface ExecutionError {
  kind: 'network' | 'timeout' | 'aborted' | 'cors-suspected' | 'mixed-content'
      | 'tls' | 'dns' | 'connection-refused' | 'invalid-url' | 'invalid-request' | 'file-unavailable' | 'unknown';
  message: string;
  detail?: string;                   // raw transport error
  hint?: string;                     // user-facing guidance
}
```

## 3. Variable resolution

- Syntax `{{name}}`; whitespace inside braces trimmed; nested resolution up to depth 10 (`{{a}}` → `"{{b}}"` → value); cycles → unresolved + warning.
- Applied to: URL raw, query keys/values, path variable values, header keys/values, body raw text, urlencoded/form-data keys & text values, GraphQL query & variables, auth fields.
- Not applied to: file paths in form-data (to avoid surprises) — **exception**: resolved if the whole value is a single `{{var}}`.
- Unresolved `{{x}}` remains literally in the output and is listed in `meta.unresolved`; the UI shows a warning (not a blocking error).
- Path variables: `:name` segments in the URL path are replaced by `url.pathVariables` values (after resolution). Unknown `:name` → left as is.
- URL encoding: query keys/values are percent-encoded (RFC 3986 unreserved kept; existing valid `%XX` sequences preserved). Path segments are encoded except `/`. The raw URL typed by the user is otherwise preserved.
- `secretValues` collects resolved values of secret variables so logs/results can mask them.

## 4. Auth handlers

```ts
interface AuthHandler<A extends Auth = Auth> {
  type: A['type'];
  apply(auth: A, req: MutablePreparedRequest, ctx: ExecutionContext): Promise<void> | void;
}
```
MVP handlers: `noauth`, `basic` (`Authorization: Basic base64(user:pass)`, UTF-8), `bearer` (`Authorization: Bearer <token>`), `apikey` (header or query param). An explicit user header with the same name takes precedence over auth-generated headers (Postman behaviour) and a warning is added. Unsupported types: request sent without auth + warning. Later: digest (needs challenge round trip → handler gets access to `transport`), AWS SigV4 (signs final bytes), OAuth 2.0 (token acquisition flow, token cached in local state).

## 5. Body encoding

| Mode | Encoding | Default Content-Type (if user didn't set one) |
|---|---|---|
| none | no body | — |
| raw json | UTF-8 text as typed (not re-serialized) | `application/json` |
| raw text / xml / html / javascript | UTF-8 | `text/plain` / `application/xml` / `text/html` / `application/javascript` |
| urlencoded | `application/x-www-form-urlencoded` encoding of enabled params | `application/x-www-form-urlencoded` |
| formdata | `multipart` parts (transport builds boundary) | set by transport (`multipart/form-data; boundary=…`) |
| file | bytes of file | from file extension or `application/octet-stream` |
| graphql | JSON `{"query","variables","operationName"}`; `variables` parsed as JSON (invalid → validation error) | `application/json` |

Disabled params/headers are skipped. `body.disabled` → no body.

## 6. Protocol handlers

```ts
interface ProtocolHandler {
  id: 'http' | 'graphql' | string;
  matches(req: Request): boolean;
  prepare(req: Request, ctx: ExecutionContext): Promise<Result<PreparedRequest, ExecutionError>>;
  interpret?(res: NormalizedResponse): ProtocolView;    // e.g. GraphQL: split data/errors
}
```
- **http**: default.
- **graphql**: `body.mode === 'graphql'`. Method defaults to POST; GET supported by encoding `query`/`variables`/`operationName` as query params. `interpret` exposes `data` and `errors` so the response viewer can show GraphQL errors prominently even with HTTP 200. Introspection & autocomplete: PIGN-055.
- **Future streaming protocols** (WebSocket, SSE, gRPC): a separate interface, defined now but unimplemented, so HTTP types stay simple:

```ts
interface StreamingTransport {
  open(req: PreparedStreamRequest, handlers: { onMessage(m: StreamMessage): void; onClose(c: CloseInfo): void }): StreamHandle;
}
```

## 7. Transports

### 7.1 Desktop — Rust `http_send` (all three OSes)
- Command input: `PreparedRequest` serialized; file parts passed as absolute paths (TS resolves project paths to absolute) or bytes.
- `reqwest` client per project (connection pooling, isolation), rustls TLS; `danger_accept_invalid_certs` when `strictSSL === false`.
- Redirects: policy `none`; the command follows redirects manually up to `maxRedirects` to record each hop; 301/302/303 → GET without body (Postman default), 307/308 keep method & body.
- No cookie store in reqwest; cookies are handled in TS (PIGN-045) so logic is shared.
- Automatic decompression (gzip, br, deflate, zstd).
- Timeout via `tokio::time::timeout`; cancellation via `http_cancel(id)` using an abort handle map.
- Timings: `ttfbMs` (headers received) and `totalMs`.
- Returns body as bytes (binary IPC via `tauri::ipc::Response`) to avoid base64 overhead for large bodies.
- Max response size default 100 MB (preference); beyond → truncated + warning.

### 7.2 Web — `FetchTransport`
- `fetch(url, { method, headers, body, redirect: 'follow', signal, credentials: 'omit' | 'include' (per-request setting, default omit), cache: 'no-store' })`.
- Forbidden headers are removed before calling fetch; each removal becomes a warning.
- GET/HEAD with body → validation error before sending.
- Error classification (fetch only gives `TypeError`):
  - `AbortError` → `aborted` or `timeout` (Pigeon's own timer).
  - page is `https:` and URL is `http:` (not localhost/127.0.0.1/[::1]) → `mixed-content`.
  - otherwise `TypeError` → `cors-suspected` with hint text listing CORS, network down, DNS, self-signed TLS as possible causes (the browser does not say which).
- `redirects: []`, `headersRestricted: true`, timings total only.
- Multipart: build `FormData` (browser sets boundary); `project` file refs read through `FsAccessFs`; `picked` refs from memory; otherwise `file-unavailable` error.

### 7.3 Node — `NodeTransport` (tests, CLI)
undici with manual redirects; mirrors the Rust behaviour; used by the conformance suite as the reference implementation.

### 7.4 Desktop vs web differences (summary)

| Behaviour | Desktop | Web |
|---|---|---|
| CORS | not applicable | enforced by browser |
| Custom `Host`, `Cookie`, `Origin`, `Content-Length` headers | sent | dropped + warning |
| All response headers incl. `Set-Cookie` | visible | limited |
| Redirect chain / don't follow | ✅ | follow only, final URL only |
| Disable TLS verification | ✅ | ❌ |
| Body on GET | ✅ (with `disableBodyPruning`) | ❌ |
| Timings | total + TTFB | total |
| Files by path | ✅ | project folder (fs-access) or re-pick |
| http:// from https:// | n/a | blocked (mixed content) |
| Proxy | preference (later) | browser/system only |

## 8. Cancellation, timeouts, concurrency

- Every execution gets an `AbortController`; the Send button becomes Cancel while in flight.
- Default timeout 30 s (preference), overridable per request (`settings.timeoutMs`); `0` = no timeout.
- A request tab can have one in-flight execution; sending again cancels the previous one.
- Runner executes sequentially (MVP); concurrency is a later option.

## 9. Scripts (later: PIGN-043/044)

Order: collection pre-request → folder pre-request(s) → request pre-request → **send** → collection test → folder test(s) → request test. Scripts run in a QuickJS sandbox (Worker) with a `pm` subset: `pm.environment`, `pm.collectionVariables`, `pm.globals`, `pm.variables` (get/set/unset), `pm.request` (read + header/url/body mutation before send), `pm.response` (status, headers, json(), text(), responseTime), `pm.test`, `pm.expect` (chai-style subset), `console.log`. No `pm.sendRequest`, no `require` in the first iteration. Variable mutations from scripts are written as **current values** (local), never shared values. Scripts time out after 5 s.

## 10. Results storage

The latest `ExecutionResult` per request is kept in memory and persisted (bounded, see file-format §6) so reopening a request shows its last response. Results are never written to project files; the only way a response reaches files is **Save as example** or **Accept as new baseline**.
