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
  get(projectId: string, key: string): Promise<string | undefined>;
  set(projectId: string, key: string, value: string): Promise<void>;
  delete(projectId: string, key: string): Promise<void>;
  readonly backend: 'os-keychain' | 'local-state' | 'indexeddb' | 'memory';
}

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
| secretStorage | local-state (MVP) → os-keychain (PIGN-053) | same | same (Secret Service) | indexeddb | indexeddb | indexeddb |
| multiWindow | later | later | later | browser tabs | browser tabs | browser tabs |
| offline | ✅ full | ✅ full | ✅ full | ⚠️ app must be loaded; PWA future | ⚠️ | ⚠️ |

"Chromium" = Chrome, Edge, Opera, Arc. Brave disables the File System Access API by default and behaves like Firefox unless enabled. Browser support evolves; `platform-web` must feature-detect (`'showDirectoryPicker' in window`) rather than sniff user agents.

## 5. Desktop (Tauri 2)

### 5.1 Shared desktop implementation
All three OSes use the same `platform-desktop` package and the same Rust code:
- **Transport**: Rust `http_send` command (reqwest + rustls; native-tls optional later). Returns status, raw header list, body bytes, timings, redirect chain, HTTP version. `http_cancel(requestId)` aborts.
- **FileSystem**: `@tauri-apps/plugin-fs` (read/write/rename/remove/readDir/stat/watch). Atomic write = write `.<name>.pigeon-tmp` in same directory, then `rename`.
- **Dialogs**: `@tauri-apps/plugin-dialog` (folder picker, open/save file).
- **Scope**: user-selected folders are added to the fs scope by the dialog plugin; `tauri-plugin-persisted-scope` restores access for recent projects.
- **AppState**: JSON files under `appDataDir()` (see [file-format.md §6](file-format.md#6-local-app-state)).
- **Watch**: plugin-fs `watch` (debounced, recursive) → `FsChangeEvent[]`.

### 5.2 macOS
- WebView: WKWebView (WebKit). UI must be tested in WebKit (Playwright WebKit covers most rendering issues).
- Keyboard: `Cmd` modifier; native app menu (Pigeon / File / Edit / View / Window / Help) with standard Edit items so copy/paste works.
- Packaging: `.app` + `.dmg`, universal binary (arm64 + x86_64). Signing + notarization required for frictionless distribution (D-11).
- App data: `~/Library/Application Support/<app-id>/`.
- Filesystem: APFS is case-insensitive by default → slug rules produce lowercase names only.

### 5.3 Windows
- WebView: WebView2 (Chromium). Installer must bootstrap WebView2 if missing (Tauri `webviewInstallMode`).
- Keyboard: `Ctrl`; menu in-window (or none) — shortcuts must not depend on a native menu.
- Packaging: NSIS `.exe` and/or `.msi`. Authenticode signing (D-11) avoids SmartScreen warnings.
- App data: `%APPDATA%\<app-id>\`.
- Filesystem: paths converted from POSIX to `\` only inside `platform-desktop`; reserved names (`CON`, `NUL`, `COM1`…) and trailing dots/spaces avoided by slug rules; MAX_PATH (260) — warn when project root + longest managed path > 240 chars; rename-over-existing is supported by Rust `std::fs::rename`. Files may be locked by other processes (editors, antivirus) → retry write up to 3 times with backoff, then report.
- Line endings: Pigeon always writes LF; project `.gitattributes` (`* text=auto eol=lf` for managed paths) prevents `core.autocrlf` churn.

### 5.4 Linux
- WebView: WebKitGTK (4.1). Rendering/perf differ from Chromium — keep animations cheap; test in Playwright WebKit and on a real Linux CI runner.
- Keyboard: `Ctrl`.
- Packaging: AppImage and `.deb` (rpm optional).
- App data: `$XDG_DATA_HOME/<app-id>/` (usually `~/.local/share/`).
- Filesystem: case-sensitive; inotify watch limits — on watch failure fall back to "refresh on window focus" and show a status-bar notice.
- Secrets (PIGN-053): Secret Service (GNOME Keyring/KWallet); fall back to local-state backend when unavailable.

### 5.5 Offline
Desktop works fully offline: no sign-in, no remote config, fonts and assets bundled, no update checks unless enabled by the user (later). Only user-initiated requests touch the network.

## 6. Web

### 6.1 Deployment
- `pnpm --filter @pigeon/web build` → static files (`index.html`, hashed assets). Host on any static host. No server, no account.
- Strict CSP: `default-src 'self'; connect-src *; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'` (`wasm-unsafe-eval` needed for QuickJS later). `connect-src *` is required because users call arbitrary APIs. The CSP `<meta>` is injected into the **built** `index.html` only (`apps/web/vite.config.ts`). The Vite dev server needs an inline React Fast Refresh script, so it runs without the CSP; the E2E suite tests the production build with it.
- Also runnable locally (`pnpm --filter @pigeon/web preview`), which avoids mixed-content issues for `http://` APIs.

### 6.2 Making API requests (CORS and friends)
The web version uses `fetch()`. The browser, not Pigeon, decides what is allowed:

| Limitation | Effect in Pigeon | UX |
|---|---|---|
| **CORS** — target must return `Access-Control-Allow-Origin` (and allow methods/headers via preflight) | Request fails with an opaque `TypeError`; the real status is invisible | Error classified as `cors-suspected`; panel explains CORS, suggests the desktop app, a CORS-enabled dev server, or (later) a self-hosted proxy (PIGN-052) |
| Preflight (`OPTIONS`) for non-simple requests | Extra round trip; server must answer it | Mentioned in the CORS help |
| **Forbidden request headers** (`Host`, `Cookie`, `Content-Length`, `Origin`, `Referer`, `Connection`, `Accept-Encoding`, `Sec-*`, `Proxy-*`, …) | Silently dropped or error | Header editor shows a warning icon on forbidden headers when `!canSetAnyHeader` |
| **Response headers** limited to CORS-safelisted + `Access-Control-Expose-Headers`; `Set-Cookie` never readable | Headers tab incomplete | Notice: "Some headers are hidden by the browser" |
| Cookies managed by the browser (`credentials: 'include'` optional per request) | No cookie jar control | Cookie UI hidden/limited |
| **Redirects** followed transparently; `redirect: 'manual'` yields an opaque response | No redirect chain; "follow redirects: off" unsupported | Setting disabled with tooltip |
| **GET/HEAD with body** throws | Cannot send | Validation error before send |
| **Mixed content**: an `https://` Pigeon page cannot call `http://` APIs (except `localhost`/`127.0.0.1` in most browsers) | Blocked | Error classified `mixed-content` with explanation; suggest running web locally or desktop |
| **Private Network Access** (Chromium): public origin → private/localhost may require preflight with `Access-Control-Allow-Private-Network` | Blocked on some setups | Included in network-error help (browser behaviour evolving) |
| **TLS**: cannot ignore invalid/self-signed certs; no client certificate selection by Pigeon | Fails | TLS verify toggle disabled |
| Proxy: browser/system proxy only | — | Proxy settings hidden |
| Timings: total only (Resource Timing needs `Timing-Allow-Origin`) | — | Timing tab shows total |
| Content-Encoding decoded by browser; raw compressed size unknown | Size = decoded size | Size tooltip explains |

### 6.3 Local filesystem access
- **Chromium**: `showDirectoryPicker({ mode: 'readwrite' })` gives a `FileSystemDirectoryHandle` → `FsAccessFs`. The handle is persisted in IndexedDB. On reload, `queryPermission` may return `prompt`; calling `requestPermission` requires a user gesture → the Welcome screen shows "Reconnect to <folder>" buttons. Some Chromium versions offer persistent permission ("Allow on every visit").
- **No file watching**. On window focus and on explicit **Refresh**, Pigeon re-scans managed files (compare size + `lastModified` + content hash) to detect external changes.
- **Firefox / Safari**: no directory picker → **browser workspace** (`IdbFs`): project files stored in IndexedDB with the same layout. Users move data in/out via **Export project (.zip)** / **Import project (.zip)** and single-file Postman import/export.
- Storage may be evicted under pressure; Pigeon calls `navigator.storage.persist()` and shows the result. Users are told to export regularly in browser-workspace mode.

### 6.4 Environment variables and secrets
- Current values and secrets are stored in IndexedDB for the Pigeon origin. They are **not encrypted at rest** and are readable by any script running on that origin — hence strict CSP and no third-party scripts.
- No OS keychain access from the browser.
- Secrets are never written into project files regardless of platform.
- The UI shows a one-time notice on web: "Secrets are stored in this browser profile. Don't use production credentials on shared machines."

### 6.5 Importing / exporting files
- Import: `<input type="file">` / drag & drop / `showOpenFilePicker` (Chromium). Works everywhere.
- Export: `showSaveFilePicker` where available; otherwise `Blob` + `<a download>`.
- Form-data/binary file bodies: the browser can't re-read a file by path. With an fs-access project, files inside the project folder are read through the handle; otherwise the user re-picks the file (kept in memory for the session only).

### 6.6 Git / local repository access
- The browser cannot run Git or read `.git` meaningfully. Pigeon on web never touches Git.
- In Chromium with an fs-access folder that is inside a Git checkout, Save for Commit writes into the working tree; users run Git themselves. This is the full Git workflow on web.
- In browser-workspace mode there is no Git; export a zip and commit elsewhere.

## 7. Node (tests, future CLI)

`platform-node` implements `NodeFs` (node:fs/promises) and `NodeTransport` (undici). It is used by the cross-OS filesystem conformance suite (PIGN-040) and the CLI runner (PIGN-054). Capabilities mirror desktop (no CORS, all headers).

## 8. Conformance suites

`packages/platform/src/conformance/` contains reusable test suites that every adapter must pass:
- `fsConformance(createFs)` — read/write/atomic write/rename/list/remove/unicode names/nested dirs; run against MemoryFs, NodeFs (all 3 OSes in CI), IdbFs (fake-indexeddb), FsAccessFs (Playwright Chromium using OPFS `navigator.storage.getDirectory()`, which returns the same handle type).
- `transportConformance(createTransport, caps)` — against `@pigeon/test-server`; assertions are capability-aware (e.g. forbidden headers only asserted when `canSetAnyHeader`). Run against MockTransport, NodeTransport, FetchTransport (Playwright). The Rust transport has equivalent `cargo test` cases against the same test server.
