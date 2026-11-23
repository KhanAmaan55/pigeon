# Pigeon — Platform Architecture

Pigeon runs on **macOS, Windows, Linux** (desktop, Tauri 2) and **Web** (static SPA). Everything except I/O is shared. This document defines the platform interfaces, what each platform implements, and the limitations of each.

## 1. What is shared vs platform-specific

| Concern | Shared (all platforms) | Platform-specific |
|---|---|---|
| Domain model, validation | ✅ `core/model` | — |
| Variable resolution, auth, body encoding | ✅ `core/execution` | — |
| Sending bytes over the network | — | `Transport` (Rust reqwest / browser fetch / Node undici) |
| Collection/environment import/export logic | ✅ `formats` | File pick/save UX (`FileExchange`) |
| Project file format read/write | ✅ `formats/project` | `ProjectFileSystem` implementation |
| Save / Save for Commit / conflicts | ✅ `core/workspace` | File watching (`ProjectFileSystem.watch`, optional) |
| Local state schema | ✅ | `AppStateStore` storage backend |
| Secrets | ✅ masking, "never write to files" rule | `SecretStore` backend |
| Comparison engine | ✅ `compare` | — |
| UI | ✅ `packages/ui` | Window chrome, menus, shortcuts mapping (`Cmd` vs `Ctrl`) |
| Script sandbox (later) | ✅ QuickJS in Worker | — |

## 2. Interfaces (`packages/platform`)

```ts
// Paths are POSIX-style, relative to the project root, never absolute, never containing "..".
type ProjectPath = string;

interface ProjectFileSystem {
  readonly root: ProjectLocation;
  readFile(path: ProjectPath): Promise<Uint8Array>;
  readText(path: ProjectPath): Promise<string>;           // UTF-8
  writeFileAtomic(path: ProjectPath, data: Uint8Array | string): Promise<void>;
  exists(path: ProjectPath): Promise<boolean>;
  stat(path: ProjectPath): Promise<{ kind: 'file' | 'dir'; size: number; mtimeMs?: number } | null>;
  list(dir: ProjectPath, opts?: { recursive?: boolean }): Promise<Array<{ path: ProjectPath; kind: 'file' | 'dir' }>>;
  mkdirp(dir: ProjectPath): Promise<void>;
  remove(path: ProjectPath, opts?: { recursive?: boolean }): Promise<void>;
  rename(from: ProjectPath, to: ProjectPath): Promise<void>;
  watch?(onEvent: (events: FsChangeEvent[]) => void): Unsubscribe;   // only if capabilities.fileWatch
}

type ProjectLocation =
  | { kind: 'native'; absolutePath: string }                 // desktop, node
  | { kind: 'fs-access'; handleKey: string; name: string }    // web Chromium, handle persisted in IndexedDB
  | { kind: 'browser-workspace'; workspaceId: string; name: string } // web, IndexedDB-backed
  | { kind: 'memory'; id: string };                           // tests

interface Transport {
  send(req: PreparedRequest, opts: { signal: AbortSignal }): Promise<RawResponse>;
}

interface AppStateStore {             // key/value JSON documents, namespaced
  get<T>(ns: 'app' | `project:${string}`, key: string): Promise<T | undefined>;
  set<T>(ns: 'app' | `project:${string}`, key: string, value: T): Promise<void>;
  delete(ns: string, key: string): Promise<void>;
  clearNamespace(ns: string): Promise<void>;
}

interface SecretStore {
  getAll(projectId: string): Promise<Record<string, string>>;   // one batch at project open
  get(projectId: string, key: string): Promise<string | undefined>;
  set(projectId: string, key: string, value: string): Promise<void>;
  delete(projectId: string, key: string): Promise<void>;
  clear(projectId: string): Promise<void>;                      // "Forget all secrets" (PIGN-053)
  readonly backend: 'os-keychain' | 'local-state' | 'indexeddb' | 'memory'; // current, after any fallback
  readonly notice?: string;                                     // why the preferred backend is not in use
}

interface HistoryStore {               // request history (PIGN-051), per project local key
  append(projectKey: string, records: { id: string; summary: unknown; entry: unknown }[]): Promise<void>;
  list(projectKey: string): Promise<unknown[]>;   // summaries, oldest first
  get(projectKey: string, id: string): Promise<unknown>;
  remove(projectKey: string, ids: string[]): Promise<void>;
  clear(projectKey: string): Promise<void>;
}   // desktop: app-data files (history.rs); web: IndexedDB; memory for tests

interface FileExchange {
  pickFiles(opts: { accept: string[]; multiple?: boolean }): Promise<PickedFile[]>; // name + bytes
  saveFile(suggestedName: string, data: Uint8Array | string, mime: string): Promise<'saved' | 'cancelled'>;
}

interface ProjectLocator {
  pickProjectFolder(): Promise<ProjectLocation | null>;
  createProject(name: string): Promise<ProjectLocation | null>;   // desktop: folder picker; web: fs-access or workspace
  reopen(loc: ProjectLocation): Promise<'ok' | 'needs-permission' | 'missing'>;
  requestPermission?(loc: ProjectLocation): Promise<boolean>;      // web fs-access, needs user gesture
}
```

`PreparedRequest` / `RawResponse` are defined in [api-execution.md](api-execution.md).

Supporting types (added in PIGN-004; source of truth is `packages/platform/src`):

```ts
type Unsubscribe = () => void;
interface FsChangeEvent { kind: 'created' | 'modified' | 'removed'; path: ProjectPath } // rename = removed + created
interface PickedFile { name: string; bytes: Uint8Array; mime?: string }

interface Dialogs {                   // modal prompts; file/folder pickers live in FileExchange / ProjectLocator
  confirm(opts: { title: string; message: string; confirmLabel?: string; destructive?: boolean }): Promise<boolean>;
  message(opts: { title: string; message: string; kind?: 'info' | 'warning' | 'error' }): Promise<void>;
}

class FsError extends Error {          // the only rejection type for expected filesystem failures
  code: 'invalid-path' | 'not-found' | 'already-exists' | 'not-a-directory' | 'is-a-directory' | 'not-empty';
  path: ProjectPath;
}
```

`ProjectFileSystem` semantics every implementation shares (enforced by `fsConformance` from `@pigeon/platform/conformance`):
- **Paths**: `assertProjectPath()` rejects absolute paths (`/x`, `C:/x`), empty / `.` / `..` segments, backslashes and NUL with `FsError('invalid-path')`. `''` is the project root.
- `writeFileAtomic` creates missing parent directories, copies the data, never leaves temp files, and readers see the old or the new content only. It refuses to replace a directory (`is-a-directory`) or write below a file (`not-a-directory`).
- `list` returns full project paths sorted by path; `recursive` includes nested entries.
- `remove` needs `recursive` for non-empty directories (`not-empty`), rejects missing paths (`not-found`) and the root.
- `rename` replaces an existing file, creates missing parents of the target, allows case-only renames, and rejects existing directory targets (`already-exists`) and moves into itself (`invalid-path`).
- `watch` delivers one batch per operation, asynchronously, never inside the call that caused it.

## 3. Capabilities

The UI branches on capabilities only — never on `platform.kind`.

```ts
interface Capabilities {
  transport: 'native' | 'fetch' | 'node';
  bypassesCors: boolean;
  canSetAnyHeader: boolean;          // false in browsers (forbidden headers)
  canReadAllResponseHeaders: boolean;// false in browsers (Set-Cookie, non-exposed headers)
  canControlRedirects: boolean;      // observe each hop / stop at 3xx
  canDisableTlsVerification: boolean;
  canSendBodyWithGet: boolean;       // fetch throws for GET/HEAD with body
  detailedTimings: boolean;
  projectFolders: 'native' | 'fs-access' | 'none';   // can open a real folder
  browserWorkspace: boolean;
  fileWatch: boolean;
  persistentFolderAccess: boolean;   // reopen folder without re-prompt
  fileReferencesByPath: boolean;     // form-data/binary file by path at send time
  secretStorage: SecretStore['backend'];
  gitStatus: boolean;                // read-only Git status of project folders (PIGN-057)
  multiWindow: boolean;
  offline: boolean;                  // full offline for local workflows
}
```

## 4. Capability matrix

| Capability | macOS | Windows | Linux | Web (Chromium) | Web (Firefox) | Web (Safari) |
|---|---|---|---|---|---|---|
| transport | native (reqwest) | native | native | fetch | fetch | fetch |
| bypassesCors | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canSetAnyHeader | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canReadAllResponseHeaders | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canControlRedirects | ✅ | ✅ | ✅ | ❌ (follow only) | ❌ | ❌ |
| canDisableTlsVerification | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canSendBodyWithGet | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| detailedTimings | total + TTFB | total + TTFB | total + TTFB | total only | total only | total only |
| projectFolders | native | native | native | fs-access | none | none |
| browserWorkspace | ❌ (not needed) | ❌ | ❌ | ✅ | ✅ | ✅ |
| fileWatch | ✅ (notify) | ✅ | ✅ (inotify) | ❌ (refresh on focus) | ❌ | ❌ |
| persistentFolderAccess | ✅ (persisted scope) | ✅ | ✅ | ⚠️ re-prompt per session unless browser grants persistent permission | n/a | n/a |
| fileReferencesByPath | ✅ | ✅ | ✅ | ⚠️ only files inside the opened project folder | ❌ re-pick | ❌ re-pick |
| secretStorage | os-keychain (Keychain) | os-keychain (Credential Manager) | os-keychain (Secret Service; local-state fallback) | indexeddb | indexeddb | indexeddb |
| gitStatus | ✅ (installed `git`) | ✅ | ✅ | ❌ | ❌ | ❌ |
| multiWindow | later | later | later | browser tabs | browser tabs | browser tabs |
| offline | ✅ full | ✅ full | ✅ full | ⚠️ app must be loaded; PWA future | ⚠️ | ⚠️ |

"Chromium" = Chrome, Edge, Opera, Arc. Brave disables the File System Access API by default and behaves like Firefox unless enabled. Browser support evolves; `platform-web` must feature-detect (`'showDirectoryPicker' in window`) rather than sniff user agents.

## 5. Desktop (Tauri 2)

### 5.1 Shared desktop implementation
All three OSes use the same `platform-desktop` package and the same Rust code:
- **Transport**: Rust `http_send` command (reqwest + rustls; native-tls optional later). Returns status, raw header list, body bytes, timings, redirect chain, HTTP version. `http_cancel(requestId)` aborts.
- **FileSystem**: `TauriFs` over app commands `project_fs_*` (`src-tauri/src/project_fs.rs`; read/write/stat/list/mkdirp/remove/rename). Atomic write = write `.<name>.pigeon-<pid>-<n>.tmp` in the same directory, then `rename` (retried on Windows locks). Watching arrives with PIGN-020.
- **Dialogs**: folder pickers run in Rust (`project_pick_folder`, `project_create`; tauri-plugin-dialog used from Rust only). The webview has no fs or dialog permission.
- **Scope**: a folder becomes reachable only after the user picked or created it; Rust stores these roots in `<app-data>/project-roots.json`, so recent projects reopen without re-picking (`project_reopen`), and checks the root and path of every call (D-15).
- **AppState**: JSON files under `appDataDir()` (see [file-format.md §6](file-format.md#6-local-app-state)).
- **Watch**: Rust `notify` watcher (`project_watch`, `src-tauri/src/watch.rs`; recursive, debounced 250 ms) → `project-fs-change` events → `FsChangeEvent[]`; the session verifies by hash.
- **Secrets** (PIGN-053): `KeychainSecretStore` over Rust `keychain_status/get_all/set/delete/clear` (`src-tauri/src/keychain.rs`, `keyring` crate behind a `KeyStore` trait; an in-memory store in tests and `--smoke` runs). The availability probe runs once per launch; any keychain error switches to `FileSecretStore` (`secrets.json`) for the rest of the run, with the reason in Settings → Secrets and Diagnostics. Capability `secretStorage` is `os-keychain`; `platform.secrets.backend` reports what is in use now. Storage layout, migration and "Forget all secrets": [file-format.md §7](file-format.md#7-secrets).
- **Git status** (PIGN-057, read-only): `DesktopGitStatus` → Rust `git_status(root)` (`src-tauri/src/git.rs`) for a granted project root only. It runs the user's installed `git` (none is bundled) and can only build the allow-listed read-only invocations `git --version`, `git rev-parse --show-prefix` and `git status --porcelain=v2 -z --branch --untracked-files=all -- .` (a `cargo test` checks the allowlist), each with `--no-optional-locks` and `-c core.fsmonitor=false`, no terminal prompts, and no console window on Windows. `-z` output keeps unicode and spaces in paths. When `git` is missing (on macOS also the Xcode shim without the command line tools, which would otherwise open an install dialog) the status is `available: false` and the UI shows nothing; outside a work tree it is `repository: null`. The UI reads it when the project opens, on window focus and shortly after project changes (Save for Commit, external changes), and shows the branch and changed-file count in the status bar and a dot per changed entity in the explorer (a request counts its example files). Capability `gitStatus` is `true` on desktop; whether `git` is installed is only known from the status. Pigeon never runs a Git command that writes.
- **Keychain prompts**: on macOS an unsigned build is a different app to the Keychain after every rebuild, so reading entries written by an earlier build asks "Pigeon wants to use your confidential information" (choose *Always Allow*). Signed releases (D-11) keep one identity and do not ask again.

### 5.2 macOS
- WebView: WKWebView (WebKit). UI must be tested in WebKit (Playwright WebKit covers most rendering issues).
- Keyboard: `Cmd` modifier; native app menu (Pigeon / File / Edit / View / Window / Help) with standard Edit items so copy/paste works (`src-tauri/src/menu.rs`).
- Packaging: `.app` + `.dmg`, universal binary (arm64 + x86_64), macOS 11+. Signing + notarization when the release secrets are set, unsigned otherwise (D-11; [release-checklist.md](release-checklist.md)).
- App data: `~/Library/Application Support/<app-id>/`.
- Filesystem: APFS is case-insensitive by default → slug rules produce lowercase names only.

### 5.3 Windows
- WebView: WebView2 (Chromium). Installer must bootstrap WebView2 if missing (Tauri `webviewInstallMode`).
- Keyboard: `Ctrl`; an in-window menu bar with File / View / Help (no Edit menu: the webview handles editing keys) — shortcuts never depend on it. Menu commands reach the UI as `pigeon:menu` events → `pigeon:command` DOM events (`ui/src/app/commands.ts`); zoom (`CmdOrCtrl+= / - / 0`) is handled in Rust.
- Packaging: NSIS `-setup.exe` (per-user install, WebView2 download bootstrapper) and `.msi`. Authenticode signing when the release secrets are set (D-11) avoids SmartScreen warnings.
- App data: `%APPDATA%\<app-id>\`.
- Filesystem: paths converted from POSIX to `\` only inside `platform-desktop`; reserved names (`CON`, `NUL`, `COM1`…) and trailing dots/spaces avoided by slug rules; MAX_PATH (260) — warn when project root + longest managed path > 240 chars (the write is still attempted); rename-over-existing is supported by Rust `std::fs::rename` (cargo-tested). Files may be locked by other processes (editors, antivirus) → writes, renames and removes retry up to 3 times with backoff (50/100/150 ms; Rust `with_retry`, NodeFs `withRetry`), then Save for Commit reports the file and goes on with the others.
- Line endings: Pigeon always writes LF; project `.gitattributes` (`* text=auto eol=lf` for managed paths) prevents `core.autocrlf` churn.

### 5.4 Linux
- WebView: WebKitGTK (4.1). Rendering/perf differ from Chromium — keep animations cheap; test in Playwright WebKit and on a real Linux CI runner.
- Keyboard: `Ctrl`.
- Packaging: AppImage (needs FUSE 2 on some distributions, or `--appimage-extract-and-run`) and `.deb`.
- App data: `$XDG_DATA_HOME/<app-id>/` (usually `~/.local/share/`).
- Filesystem: case-sensitive; inotify watch limits — on watch failure fall back to "refresh on window focus" and show a status-bar notice.
- Secrets (PIGN-053): Secret Service (GNOME Keyring/KWallet); fall back to local-state backend when unavailable.

### 5.4.1 Versions, windows and releases (PIGN-041)
- One version: the root `package.json` (`pnpm version:sync` copies it to the crate, the packages and `PIGEON_VERSION`/`User-Agent`; Tauri reads it via `tauri.conf.json` `"version": "../../../package.json"`).
- The main window's size, position and maximized state are saved on close to `<app-data>/window-state.json` and restored at start (a position no longer on any monitor is ignored).
- Releases: `.github/workflows/release.yml` on `v*` tags builds and smoke-tests all installers and drafts a GitHub release with `SHA256SUMS`; steps and manual checks in [release-checklist.md](release-checklist.md).

### 5.4.2 OAuth 2.0 redirects (PIGN-047)
- Desktop: `src-tauri/src/oauth.rs` binds a loopback listener (`oauth_begin`; a loopback redirect URI from the auth, with its port and path, is honoured, else a free port and `/callback`), opens the system browser (`oauth_complete`, http/https URLs only) and returns the redirect's query parameters; 5-minute timeout. Register `http://127.0.0.1:<port>/callback` (or the URI you entered) with the provider.
- Web: a popup to the provider; it redirects to `oauth-callback.html` (served next to `index.html`), which posts the parameters to the opener (same origin only) and closes. Register that page's URL. Token endpoints must allow CORS.

### 5.5 Offline
Desktop works fully offline: no sign-in, no remote config, fonts and assets bundled, no update checks unless enabled by the user (later). Only user-initiated requests touch the network.

## 6. Web

### 6.1 Deployment
- `pnpm --filter @pigeon/web build` → static files (`index.html`, hashed assets, `_headers`). Host on any static host. No server, no account. Deploy instructions: [apps/web/README.md](../apps/web/README.md).
- Base path: relative by default (`./`), so one build works from the root and from a sub-path; `PIGEON_BASE` sets an absolute one. `PIGEON_DESKTOP_URL` (build time) shows "Get the desktop app"; source maps only with `PIGEON_SOURCEMAP=true`.
- Strict CSP: `default-src 'self'; connect-src *; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'self'; form-action 'none'` (`wasm-unsafe-eval` needed for QuickJS later). `connect-src *` is required because users call arbitrary APIs. The CSP `<meta>` is injected into the **built** `index.html` only (`apps/web/vite.config.ts`). The Vite dev server needs an inline React Fast Refresh script, so it runs without the CSP; the E2E suite tests the production build with it (an injected inline script does not run).
- HTTP headers for hosts (`dist/_headers`, nginx snippet in the README): the CSP plus `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, a restrictive `Permissions-Policy`. No third-party scripts or fonts.
- Bundle budget: the first page load's JavaScript (entry + module preloads) ≤ **500 KB gzip**; CodeMirror languages, the response viewer, workers and the zip library load on demand. `apps/web/scripts/check-bundle.ts` (run by `build`) enforces the budget and fails on Tauri or Node code in the bundle.
- Also runnable locally (`pnpm --filter @pigeon/web preview`), which avoids mixed-content issues for `http://` APIs.
- In-app **Web limitations** help (`ui/src/features/help/WebLimitations.tsx`) mirrors §6.2–6.6; every web hint and disabled control links to its section, and the status bar shows "Browser mode — CORS applies". A first-run notice on the Welcome screen explains storage persistence and secrets.

### 6.2 Making API requests (CORS and friends)
The web version uses `fetch()`. The browser, not Pigeon, decides what is allowed:

| Limitation | Effect in Pigeon | UX |
|---|---|---|
| **CORS** — target must return `Access-Control-Allow-Origin` (and allow methods/headers via preflight) | Request fails with an opaque `TypeError`; the real status is invisible | Error classified as `cors-suspected`; panel explains CORS, suggests the desktop app, a CORS-enabled dev server, or a self-hosted proxy (§6.2.1, PIGN-052) |
| Preflight (`OPTIONS`) for non-simple requests | Extra round trip; server must answer it | Mentioned in the CORS help |
| **Forbidden request headers** (`Host`, `Cookie`, `Content-Length`, `Origin`, `Referer`, `Connection`, `Accept-Encoding`, `Sec-*`, `Proxy-*`, …) | Silently dropped or error | Header editor shows a warning icon on forbidden headers when `!canSetAnyHeader` (`isForbiddenHeader` in `@pigeon/platform`, the list FetchTransport drops) |
| **Response headers** limited to CORS-safelisted + `Access-Control-Expose-Headers`; `Set-Cookie` never readable | Headers tab incomplete | Notice: "Some headers are hidden by the browser" |
| Cookies managed by the browser (`credentials: 'include'` optional per request) | No cookie jar control | Cookie manager explains; per-request "Send browser cookies" (`_pigeon.includeCredentials`) sends and stores the browser's own cookies (PIGN-045) |
| **Redirects** followed transparently; `redirect: 'manual'` yields an opaque response | No redirect chain; "follow redirects: off" unsupported | Setting disabled with tooltip |
| **GET/HEAD with body** throws | Cannot send | Validation error before send |
| **Mixed content**: an `https://` Pigeon page cannot call `http://` APIs (except `localhost`/`127.0.0.1` in most browsers) | Blocked | Error classified `mixed-content` with explanation; suggest running web locally or desktop |
| **Private Network Access** (Chromium): public origin → private/localhost may require preflight with `Access-Control-Allow-Private-Network` | Blocked on some setups | Included in network-error help (browser behaviour evolving) |
| **TLS**: cannot ignore invalid/self-signed certs; no client certificate selection by Pigeon | Fails | TLS verify toggle disabled |
| Proxy: browser/system proxy only | — | Proxy settings hidden (the self-hosted CORS proxy of §6.2.1 is a separate opt-in) |
| Timings: total only (Resource Timing needs `Timing-Allow-Origin`) | — | Timing tab shows total |
| Content-Encoding decoded by browser; raw compressed size unknown | Size = decoded size | Size tooltip explains |

#### 6.2.1 Optional self-hosted CORS proxy (PIGN-052)

Users whose APIs lack CORS can run a small proxy themselves — never a Pigeon-hosted service:

```bash
pnpm --filter @pigeon/cors-proxy start        # prints URL (127.0.0.1:8787) and a random token
```

Options: `--port`, `--host` (default `127.0.0.1`), `--allow-origin <url>` (repeatable; defaults to the local dev/preview origins — add your deployed Pigeon origin), `--token` (default random), `--quiet`; or `PIGEON_PROXY_*` environment variables. `node packages/cors-proxy/dist/cli.js` runs the built single-file script anywhere Node 22+ is installed.

- **Protocol**: `POST <proxy>/v1/forward` with header `x-pigeon-proxy-token` and a JSON envelope (method, URL, headers in order with duplicates, body as base64 bytes or multipart parts, timeout/redirect/TLS settings). The proxy sends it with `NodeTransport` (same semantics as the desktop/CLI transport: any header including `Host`/`Cookie`/`Origin`, manual redirects with hops, TLS verification toggle) and answers `{ ok, status, statusText, headers, base64, url, redirects, timings }` — every response header, `Set-Cookie` included — or `{ ok: false, error: { kind, message } }`. Forbidden headers therefore travel inside the envelope, not as real browser headers. `GET /v1/health` checks URL and token.
- **Web app**: Settings → **CORS proxy** (per project; URL + token kept in this browser's local state, never in project files). While on, `platform.transport` sends through `ProxyTransport` and `platform.capabilities` switch to `transport: 'proxy'` with `bypassesCors`, `canSetAnyHeader`, `canReadAllResponseHeaders`, `canControlRedirects`, `canDisableTlsVerification`, `canSendBodyWithGet` true (UI re-renders through `useCapabilities()`). Results show a **Proxy** transport badge; the status bar shows "Proxy mode". The CORS error card offers "Use a local proxy".
- **Threats and mitigations**: a proxy is an SSRF gateway — whoever can drive it sends requests from your machine's network position (intranet hosts, cloud metadata endpoints, `localhost` services). Hence: it binds to `127.0.0.1` by default (other hosts print a warning); every request needs the random token (compared in constant time); only allow-listed `Origin`s are served (a request without `Origin` is refused, so other web pages and blind cross-site requests cannot use it, and CORS responses only name allowed origins); request/response bodies and headers are never logged (one line per request: method, origin+path, status); envelopes over 64 MB are refused; only `http:`/`https:` targets. Don't expose it beyond your machine without your own access control, and stop it when not needed. An `https://` Pigeon page may call a proxy on `http://127.0.0.1` (browsers treat loopback as secure); other `http://` hosts are mixed content.

### 6.3 Local filesystem access
- **Chromium**: `showDirectoryPicker({ mode: 'readwrite' })` gives a `FileSystemDirectoryHandle` → `FsAccessFs`. The handle is persisted in IndexedDB. On reload, `queryPermission` may return `prompt`; calling `requestPermission` requires a user gesture → the Welcome screen shows "Reconnect to <folder>" buttons. Some Chromium versions offer persistent permission ("Allow on every visit").
- **No file watching**. On window focus and on explicit **Refresh**, Pigeon re-scans managed files (compare size + `lastModified` + content hash) to detect external changes.
- **Firefox / Safari**: no directory picker → **browser workspace** (`IdbFs`): project files stored in IndexedDB with the same layout (loaded into memory on open, every change written through). Users move data in/out via **Export project (.zip)** / **Import project (.zip)** (project files only; `core/workspace/project-zip.ts`) and single-file Postman import/export.
- Storage may be evicted under pressure; Pigeon calls `navigator.storage.persist()` once, on the first workspace (without waiting: Firefox asks the user), and shows the result on the workspace badge. Users are told to export regularly in browser-workspace mode.

### 6.4 Environment variables and secrets
- Current values and secrets are stored in IndexedDB for the Pigeon origin. They are **not encrypted at rest** and are readable by any script running on that origin — hence strict CSP and no third-party scripts.
- No OS keychain access from the browser.
- Secrets are never written into project files regardless of platform.
- The UI shows a one-time notice on web: "Secrets are stored in this browser profile. Don't use production credentials on shared machines."

### 6.5 Importing / exporting files
- Import: `<input type="file">` / drag & drop / `showOpenFilePicker` (Chromium). Works everywhere.
- Export: `showSaveFilePicker` where available; otherwise `Blob` + `<a download>` (`WebFileExchange`, `platform-web/src/files.ts`; a dismissed picker is `'cancelled'`).
- Desktop `FileExchange` (`platform-desktop/src/files.ts`): `saveFile` sends one binary frame (`[u32 LE JSON length][{ suggestedName, mime }][bytes]`, like `http_send`) to the Rust `save_file` command (`src-tauri/src/files.rs`), which shows the native Save dialog (tauri-plugin-dialog, used from Rust only) and writes the bytes itself through a temporary file and a rename. The webview gets no filesystem or dialog permission, only `allow-save-file`. `pickFiles` uses the webview's file input.
- Form-data/binary file bodies: the browser can't re-read a file by path. With an fs-access project, files inside the project folder are read through the handle (PIGN-015); otherwise the user re-picks the file (kept in memory for the session only, `Platform.pickedFiles`). The desktop editor uses the same `<input type="file">` picker for now, so its picked files travel to Rust as bytes; native dialogs with real paths (`absolute` refs) come with the dialog work.

### 6.6 Git / local repository access
- The browser cannot run Git or read `.git` meaningfully. Pigeon on web never touches Git.
- In Chromium with an fs-access folder that is inside a Git checkout, Save for Commit writes into the working tree; users run Git themselves. This is the full Git workflow on web.
- In browser-workspace mode there is no Git; export a zip and commit elsewhere.
- Desktop shows read-only Git status (branch, changed files; §5.1, PIGN-057); capability `gitStatus` is `false` on web.

## 7. Node (tests, CLI)

`platform-node` implements `NodeFs` (node:fs/promises; recursive `fs.watch`; locked-file retries; symlinked directories not followed) and `NodeTransport` (node:http/https: raw header order and duplicates, manual redirects with every hop, gzip/deflate/br, `strictSSL`, timeouts, aborts; `NODE_CAPABILITIES`). Both pass the shared conformance suites. They are used by the cross-OS integration suite (`packages/core/test/cross-os.test.ts`, PIGN-040) and the CLI (`apps/cli`, PIGN-054, [cli.md](cli.md)), which reads projects through a read-only wrapper and keeps app state and secrets in memory (`MemoryAppState`, `MemorySecretStore`). Capabilities mirror desktop (no CORS, all headers).

## 8. Conformance suites

`packages/platform/src/conformance/` contains reusable test suites that every adapter must pass:
- `fsConformance(createFs)` — read/write/atomic write/rename/list/remove/unicode names/nested dirs; the cases are framework-free (`fsConformanceCases()`, export `@pigeon/platform/conformance/fs-cases`). Run against MemoryFs, TauriFs (IPC contract), NodeFs (all 3 OSes in CI, PIGN-040), IdbFs (fake-indexeddb), FsAccessFs (fake handles in Vitest; Playwright Chromium using OPFS `navigator.storage.getDirectory()`, which returns the same handle type).
- `transportConformance(name, createTransport, caps, { baseUrl, expectedFailures? })` — against `@pigeon/test-server`; `createTransport(pickedFiles)` gets the `PickedFileStore` the cases put files in (multipart, binary file body, missing file → `file-unavailable`); assertions are capability-aware (e.g. forbidden headers only asserted when `canSetAnyHeader`). The cases themselves (`transportConformanceCases(caps)`, export `@pigeon/platform/conformance/transport-cases`) import no test framework, so Playwright runs them too. Run against MockTransport (a test-server double, `packages/platform/test`), FetchTransport (Playwright, `e2e/web/transport-conformance.spec.ts`: the browser makes every `fetch` from the app's origin) and later NodeTransport. The Rust transport has equivalent `cargo test` cases against the same test server (`src-tauri/src/http/tests.rs`). Cases a transport can't pass yet are listed as expected failures with the story that fixes them (none at the moment).
