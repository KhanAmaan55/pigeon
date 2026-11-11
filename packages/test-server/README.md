# @pigeon/test-server

A deterministic local HTTP server for Pigeon's unit, integration, E2E and Rust tests, so no test depends on the public internet. It's built on `node:http`; its only dependency is `graphql`, for the `/graphql` endpoint.

## Usage

In Vitest (ephemeral port, loopback only):

```ts
import { startTestServer } from '@pigeon/test-server';

const server = await startTestServer(); // { url: 'http://127.0.0.1:51234', port, close() }
await fetch(`${server.url}/echo`);
await server.close(); // also drops open connections, e.g. a pending /delay
```

As a process (E2E, Rust `cargo test`): `pnpm --filter @pigeon/test-server start` serves on `http://127.0.0.1:4010` until stopped. To override, set `PIGEON_TEST_SERVER_PORT` (`0` = any free port) and `PIGEON_TEST_SERVER_HOST`; set `PIGEON_TEST_SERVER_HTTPS_PORT` to also serve HTTPS (see [HTTPS](#https)). With `PIGEON_TEST_SERVER_EXIT_ON_STDIN_END=1` it also exits when its stdin closes, so a parent process that spawns it (Rust `cargo test` does) can't leave it running. The script runs the TypeScript sources directly with Node's type stripping, so there's no build step. Playwright starts it as a `webServer` (see `playwright.config.ts`).

## Conventions

- **Deterministic**: no `Date` header, no timestamps or random ids, so the same request always gets the same bytes. The one exception is `/delay`, whose timing varies.
- JSON responses are pretty-printed (2 spaces), end with a newline, and use `application/json; charset=utf-8`.
- Bad parameters get `400 {"error": "..."}`. Unknown paths get `404 {"error": "No test endpoint at <path>"}`.
- **CORS**: every endpoint except `/cors/none` and `/cors/preflight-required` is permissive, so the web app can call it from the Vite preview origin:
  - `Access-Control-Allow-Origin` echoes the request's `Origin` (or `*` when there isn't one), with `Access-Control-Allow-Credentials: true` and `Vary: Origin`.
  - `Access-Control-Expose-Headers` lists every response header except `Set-Cookie`, which browsers never expose.
  - A preflight (`OPTIONS` with `Origin` + `Access-Control-Request-Method`) gets `204` that approves the requested method and headers.
  - An `OPTIONS` request that is not a preflight reaches the endpoint like any other method.
- Every endpoint accepts any method unless noted. `HEAD` gets the same headers as `GET` with no body.

## Endpoints

| Endpoint                    | Response                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/echo`, `/echo/*`          | `200` JSON reflection of the request (see below).                                                                                                                                                                                                                                                                        |
| `/json/:shape`              | Fixed JSON bodies. `user`: one user. `users`: three users. `nested`: objects and arrays 6 levels deep. `types`: one value of every JSON type, written as raw text so it keeps `9007199254740993` (above 2^53), `1.0` and `1.5e21` exactly. Any other shape → `404`.                                                      |
| `/status/:code`             | That status (200–599) with body `{"status": code}`; `204` and `304` have no body.                                                                                                                                                                                                                                        |
| `/delay/:ms`                | Waits `ms` (0–120000) and then answers `{"delayMs": ms}`. If the client disconnects, the timer is cancelled.                                                                                                                                                                                                             |
| `/redirect/:n`              | `n` (1–100) redirects with relative `Location`s: `/redirect/n-1`, …, ending at `/echo`. `?status=301\|302\|303\|307\|308` (default `302`) applies to every hop.                                                                                                                                                          |
| `/redirect-to?url=&status=` | One redirect to `url` (relative or absolute). `status` defaults to `302`.                                                                                                                                                                                                                                                |
| `/cookies/set?name=value&…` | `200 {"cookies": {…}}` with one `Set-Cookie: name=value; Path=/` per query parameter (URI-encoded). It does not redirect.                                                                                                                                                                                                |
| `/cookies`                  | `{"cookies": {…}}` parsed from the `Cookie` header (values URI-decoded; when a name repeats, the first one wins).                                                                                                                                                                                                        |
| `/gzip`                     | JSON body (`{"gzipped": true, "method", "message"}`) sent with `Content-Encoding: gzip`. The OS byte in the gzip header is pinned, so the compressed bytes are the same on every OS.                                                                                                                                     |
| `/bytes/:n`                 | `n` bytes (0–64 MiB) of `application/octet-stream`; byte `i` is `i % 256`.                                                                                                                                                                                                                                               |
| `/large/:mb`                | A JSON array of identical-shape items, at least `mb` MiB (decimal allowed, max 100) and less than 1 KiB over.                                                                                                                                                                                                            |
| `/html`                     | A small `text/html` page whose `<script>` and inline `onerror` handler would replace `#script-status` ("Scripts did not run.") and set `window.pigeonScriptRan`; used to prove the HTML preview runs no scripts. Also has a form and a `<pre>`.                                                                          |
| `/xml`                      | A compact `application/xml` document (attributes, nesting, a comment, an empty element).                                                                                                                                                                                                                                 |
| `/image/png`                | A 1×1 red PNG (`image/png`).                                                                                                                                                                                                                                                                                             |
| `/unicode`                  | UTF-8 JSON with several scripts, emoji (ZWJ sequences), astral characters, NFC vs NFD `é`, RTL text, a zero-width space and a non-ASCII key. `Content-Disposition` carries an RFC 5987 `filename*`.                                                                                                                      |
| `/auth/basic?user=&pass=`   | `200 {"authenticated": true, "user"}` when `Authorization: Basic` matches. `user`/`pass` default to `user`/`pass`. Otherwise `401 {"authenticated": false}` with `WWW-Authenticate: Basic realm="pigeon-test", charset="UTF-8"`.                                                                                         |
| `/auth/bearer?token=`       | `200 {"authenticated": true, "token"}` for `Authorization: Bearer <token>`. Without `?token=`, any non-empty token is accepted. Otherwise `401` with `WWW-Authenticate: Bearer realm="pigeon-test"`.                                                                                                                     |
| `/graphql`                  | GraphQL over HTTP (see below).                                                                                                                                                                                                                                                                                           |
| `/cors/allow-all`           | `{"cors": "allow-all", "method"}` plus an `X-Pigeon-Test: exposed` header that browsers can read because it is exposed. Permissive CORS, including preflights.                                                                                                                                                           |
| `/cors/none`                | `{"cors": "none", "method"}` with **no** CORS headers, on responses or preflights. Browsers block it, which is used to test the CORS error UX.                                                                                                                                                                           |
| `/cors/preflight-required`  | `{"cors": "preflight-required", "method"}`. Responses allow the origin, so simple requests (`GET`/`HEAD`/`POST` with safelisted headers) succeed. A preflight approves only `GET, HEAD, POST` and no request headers, so any request that needs a preflight (a custom header, a JSON content type, `PUT`, …) is blocked. |

### `/echo`

```jsonc
{
  "method": "POST",
  "url": "/echo/a%20b?x=1&x=2", // request target exactly as received
  "path": "/echo/a%20b", // raw, not decoded or normalised
  "query": { "x": ["1", "2"] }, // decoded; repeated names become arrays
  "headers": { "content-type": "…" }, // lower-cased, as Node combines them
  "rawHeaders": [["Content-Type", "…"]], // original names, order and duplicates
  "httpVersion": "1.1",
  "body": { "size": 3, "text": "a=1", "base64": "YT0x", "sha256": "…" }, // text is null if not valid UTF-8
  "parsed": { "kind": "urlencoded", "fields": [["a", "1"]] },
}
```

`parsed` is `null` for an empty body or any other content type. Otherwise it is one of:

- `{"kind": "json", "value"}` for `application/json` and `*+json`.
- `{"kind": "urlencoded", "fields": [[name, value], …]}`, in order with duplicates.
- `{"kind": "multipart", "parts": [...]}`. Each part is either `{"name", "kind": "text", "value"}` or `{"name", "kind": "file", "filename", "contentType", "size", "sha256"}`.
- `{"kind": "invalid", "contentType", "error"}` when the body doesn't parse as its declared type.

### `/graphql`

Send `POST` with a JSON body `{"query", "variables"?, "operationName"?}`, or `GET` with the same fields in the query string (`variables` as JSON). Schema:

```graphql
type User {
  id: ID!
  name: String!
  email: String!
  active: Boolean!
  roles: [String!]!
}
type Query {
  user(id: ID!): User # null for an unknown id
  users: [User!]!
  error: String # always fails: {"errors": [...], "data": {"error": null}}
}
```

Introspection works. GraphQL errors (syntax, validation, resolver) come back as `200` with an `errors` array. A malformed HTTP request (bad JSON, missing `query`) gets `400`, and any method other than `GET`/`POST` gets `405`. The users are exported as `USERS`, and the error message as `GRAPHQL_ERROR_MESSAGE`.

## HTTPS

`startTestServer({ https: true })` serves the same endpoints over TLS (`https://127.0.0.1:<port>`) with a committed self-signed certificate (`src/https.ts`, ECDSA P-256, valid for `localhost`, `127.0.0.1` and `::1` until 2126). Nothing trusts it, so a strict client fails with a certificate error, which is what TLS tests check; a client that disables verification (`strictSSL: false`), or trusts `TEST_SERVER_CERT` as a CA, gets normal responses.

The CLI also starts it when `PIGEON_TEST_SERVER_HTTPS_PORT` is set (`0` = any free port), printing a second `Pigeon test server listening on https://…` line. Rust `cargo test` uses this.
