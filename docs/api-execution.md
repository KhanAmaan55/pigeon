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
   │     3c. default headers (Content-Type, User-Agent: Pigeon/<v> where the transport can set it, Accept: */*)
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
  projectId: Id | null;            // null for the scratch request (no project)
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
  meta: { requestId?: Id; projectId?: Id; protocol: 'http' | 'graphql'; unresolved: string[]; secretValues: string[] }; // projectId absent for scratch
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
  warnings?: string[];               // e.g. forbidden headers the transport dropped
}

// Transports reject with `signal.reason` when aborted and throw `TransportError` (platform)
// for every other failure; core maps it to `ExecutionError`, keeping `warnings`.
class TransportError extends Error {
  kind: ExecutionError['kind']; detail?: string; hint?: string; warnings: string[];
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
  cookies: ParsedSetCookie[];        // desktop only (web can't see Set-Cookie); added with PIGN-045
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
- Raw URL parsing (`core/model/url.ts`): `URL` can't parse `{{baseUrl}}/users/:id`, so a tolerant splitter cuts on `#`, then `?`, `&` and `=` and never looks inside `{{…}}`. The path starts at the first `/` after `scheme://` (or after the first segment when there is no scheme), so a port (`host:8080`) is never a path variable.
- Query: `raw` is the source of truth for what is sent. The editor keeps `url.query` in sync both ways: typing in the URL re-reads the enabled params (disabled rows stay in `query` where they were, descriptions are kept), and editing the table rewrites only the query part of `raw` (`syncQueryIntoRaw`; disabled rows left out, the `?` dropped when none is enabled, `#hash` kept). `?flag` (no `=`) is `{ value: '', extra: { valueNull: true } }` and stays `flag` on write. Values are shown and stored as typed, never decoded; writing a table value into `raw` escapes only `&`, `#` (and `=` in keys) so the URL still splits the same way.
- Path variables: `:name` segments (whole segment) in the URL path are replaced by `url.pathVariables` values (after resolution). Unknown names and empty values → left as is. Path variable rows follow the URL: values are kept by name, and a renamed segment keeps the value of the row it replaces.
- URL encoding happens only on send (`buildRequestUrl`): query keys and values are percent-encoded as UTF-8 except characters RFC 3986 allows in a query (unreserved, sub-delims, `:@/?`), minus `&` (and `=` in keys); `+` is kept as typed. Path (path variable values included) is encoded except RFC 3986 `pchar` and `/`. Valid `%XX` sequences are preserved and a stray `%` becomes `%25`. The `#hash` is not sent. Scheme and host are left as typed.
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
Implemented in `apps/desktop/src-tauri/src/http.rs` (Rust) and `packages/platform-desktop/src/native-transport.ts` (`NativeTransport`).
- **IPC framing**: both directions use one binary frame, `[u32 little-endian JSON length][JSON][body bytes]`. The request JSON is `PreparedRequest` without the body bytes (`body: { kind: 'bytes' }` marks that bytes follow); serde field names are identical to the TS types. `NativeTransport` passes the frame as a `Uint8Array` argument and Rust answers with `tauri::ipc::Response`, so bodies never go through base64 or JSON number arrays; the TS response body is a view into the received `ArrayBuffer`. Failures reject with `{ kind, message, detail? }`, which `NativeTransport` turns into a `TransportError`. File parts (PIGN-009) will be passed as absolute paths (TS resolves project paths to absolute) or bytes.
- `reqwest` client per project id (`meta.projectId`; scratch requests share a default pool) and TLS mode, rustls TLS; `tls_danger_accept_invalid_certs` + `…_hostnames` when `strictSSL === false`. No system proxy (proxies are a later preference).
- Redirects: policy `none`; the command follows redirects manually up to `maxRedirects` to record each hop (`{ status, url: URL that redirected, location: Location header as sent }`); more → `network` error "Too many redirects". 301/302 turn methods other than GET/HEAD into GET, 303 turns everything except HEAD into GET (dropping the body and `Content-Type`/`Content-Length`/`Content-Encoding`/`Transfer-Encoding`); 307/308 keep method & body. A redirect to another origin drops `Authorization`, `Cookie`, `Proxy-Authorization` and `Host`.
- No cookie store in reqwest; cookies are handled in TS (PIGN-045) so logic is shared.
- Decompression (gzip, br, deflate — zlib or raw —, zstd, chained codings) is done in `http.rs`, not by reqwest, because reqwest strips `Content-Encoding`/`Content-Length` from the response: headers stay exactly as the server sent them. `Accept-Encoding: gzip, deflate, br, zstd` is sent unless the request sets its own. An unknown or corrupt coding keeps the body as received, with a warning.
- Request headers are sent as given (duplicates as separate lines, UTF-8 values as raw bytes); custom `Host`, `Cookie`, `Origin`, … reach the server. HTTP/1.1 header names go out lowercased (hyper). Response headers come back in order per name with duplicates kept.
- Timeout (`timeoutMs`, `0` = none) via `tokio::time::timeout` over the whole exchange (all hops + body); cancellation via `http_cancel(id)` using an abort-handle map (`State<HttpState>`). A cancel that arrives before its send still aborts it. `NativeTransport` rejects with `signal.reason` as soon as the signal aborts and sends `http_cancel` in the background.
- Errors: coarse reqwest classification into `timeout`, `connection-refused`, `dns`, `tls`, `network`, `invalid-url`, `invalid-request` (PIGN-011 refines wording and hints).
- Timings: `ttfbMs` (headers of the final response received, redirect hops included) and `totalMs`; `httpVersion` as `HTTP/1.1`, `HTTP/2`, …; `statusText` is the server's reason phrase.
- Max response size 100 MB (decoded; becomes a preference later); beyond → truncated + warning.
- Permissions: `build.rs` declares the app commands, so `capabilities/default.json` grants exactly `allow-http-send`, `allow-http-cancel` and `allow-smoke-report`.

### 7.2 Web — `FetchTransport`
- `fetch(url, { method, headers, body, redirect: 'follow', signal, credentials: 'omit' | 'include' (per-request setting, default omit), cache: 'no-store' })`.
- Forbidden headers (list in `@pigeon/platform` `headers.ts`, shared with the header editor) are removed before calling fetch; each removal becomes a warning (`RawResponse.warnings` / `TransportError.warnings`). `User-Agent` is always dropped: Chromium ignores it although the Fetch spec no longer forbids it. `prepareRequest` therefore adds no default `User-Agent` when `!canSetAnyHeader`, so only headers the user added are reported.
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
