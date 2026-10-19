# Pigeon — Architecture

This document defines the components, package boundaries, and the decisions that must be confirmed before implementation. Details live in the topic docs linked from each section.

## 1. Overview

```text
┌───────────────────────────────────────────────────────────────────────┐
│ apps/desktop (Tauri 2 shell)            apps/web (static Vite SPA)    │
│  wires: ui + platform-desktop            wires: ui + platform-web     │
└──────────────┬───────────────────────────────────────┬────────────────┘
               │                                       │
┌──────────────▼───────────────────────────────────────▼────────────────┐
│ packages/ui  — React UI, per-project Zustand stores, feature modules  │
│   talks ONLY to core services + the injected Platform object           │
└──────────────┬────────────────────────────────────────────────────────┘
               │
┌──────────────▼────────────────────────────────────────────────────────┐
│ packages/core     domain model, variables, request preparation,       │
│                   executor, ProjectSession (drafts, save, commit),    │
│                   runner                                               │
│ packages/formats  canonical JSON, Pigeon project format, Postman,     │
│                   environment importers (Apidog/Echo later), cURL     │
│ packages/compare  schema inference, diff engine, field rules          │
│ packages/platform interfaces: FileSystem, Transport, AppStateStore,   │
│                   SecretStore, Dialogs, Capabilities + memory impls   │
└──────────────┬────────────────────────────────────────┬───────────────┘
               │ implements                             │ implements
┌──────────────▼──────────────────┐   ┌─────────────────▼───────────────┐
│ packages/platform-desktop (TS)  │   │ packages/platform-web (TS)      │
│  TauriFs, NativeTransport,      │   │  FetchTransport, FsAccessFs,    │
│  FileAppState, NativeDialogs    │   │  IdbFs (browser workspace),     │
│        │ invoke()               │   │  IdbAppState, WebDialogs        │
│ apps/desktop/src-tauri (Rust)   │   └─────────────────────────────────┘
│  http_send command (reqwest),   │
│  fs + dialog + watch plugins    │
└─────────────────────────────────┘
```

Rule: **core, formats, compare, platform must not import React, DOM APIs, Tauri, or Node built-ins.** They are pure TypeScript (ES2022 + `TextEncoder`, `crypto.randomUUID`, `URL`) and run unchanged in the browser, the Tauri webview, and Node (tests, future CLI).

## 2. Repository layout

```text
/                              # Pigeon source repo (NOT a user project)
  package.json                 # pnpm workspace root; scripts: verify, lint, typecheck, test, build, e2e
  pnpm-workspace.yaml
  tsconfig.base.json
  apps/
    web/                       # Vite entry; wires packages/ui + packages/platform-web
      src/main.tsx
      index.html
      vite.config.ts
    cli/                       # Node CLI runner `pigeon run` (PIGN-054, later)
    desktop/                   # Tauri app
      src/main.tsx             # wires packages/ui + packages/platform-desktop
      src-tauri/
        Cargo.toml
        tauri.conf.json
        capabilities/*.json    # Tauri permission sets
        src/main.rs
        src/http.rs            # http_send / http_cancel commands
  packages/
    core/src/
      model/                   # domain types + factories + validation (zod)
      variables/               # scopes, resolver, dynamic variables
      execution/               # prepare, auth/, body/, protocols/, executor
      workspace/               # ProjectSession, drafts, commit planner, conflicts
      runner/                  # collection/folder runs (PIGN-038)
    formats/src/
      canonical-json.ts
      slug.ts
      project/                 # read/write Pigeon project folder
      postman/                 # collection v2.0/v2.1, environment, globals, detect
      apidog/ echoapi/ curl/   # later
    compare/src/
      infer.ts diff.ts rules.ts path.ts status.ts headers.ts result.ts
    platform/src/
      fs.ts transport.ts app-state.ts secrets.ts dialogs.ts capabilities.ts
      memory/                  # MemoryFs, MemoryAppState, MockTransport (tests + demo)
      conformance/             # shared conformance test suites (fs, transport)
    platform-web/src/
    platform-desktop/src/
    platform-node/src/         # NodeFs (PIGN-019), NodeTransport (PIGN-040), CLI use (PIGN-054)
    ui/src/
      app/                     # AppShell, providers, routing between welcome/project
      stores/                  # app-store.ts, project-store.ts (factory per project)
      features/                # explorer, request-editor, response-viewer, environments,
                               # examples, compare, pending-changes, import-export,
                               # runner, projects, settings, command-palette
      components/              # design-system primitives
    test-server/src/           # local HTTP test server
    cors-proxy/src/            # optional self-hosted proxy for the web version (PIGN-052, later)
    fixtures/                  # Postman samples, sample projects, golden files
  e2e/
    web/                       # Playwright specs
    desktop/                   # WebdriverIO + tauri-driver specs (Windows/Linux)
  docs/
```

Package names: `@pigeon/core`, `@pigeon/formats`, `@pigeon/compare`, `@pigeon/platform`, `@pigeon/platform-web`, `@pigeon/platform-desktop`, `@pigeon/platform-node`, `@pigeon/ui`, `@pigeon/test-server`, `@pigeon/fixtures`.

Allowed dependencies (enforced by ESLint `no-restricted-imports` + per-package `tsconfig` `lib` settings):

| Package | May depend on |
|---|---|
| platform | — |
| formats | platform (types only) |
| compare | — |
| core | platform, formats, compare |
| ui | core, formats, compare, platform |
| platform-web / platform-desktop / platform-node | platform |
| apps/web, apps/desktop | ui, platform-* |
| apps/cli (later) | core, formats, compare, platform, platform-node |

The rules live in `eslint.config.js` (the `packages` table at the top). Tests (`packages/*/test`) follow the same package rules but may import Node built-ins, because they run in Node under Vitest.

### 2.1 Build & type-check setup (PIGN-001)

- **Source exports.** Internal packages are private and never published. Each `package.json` has `"exports": { ".": "./src/index.ts" }`, so Vite, Vitest, and later the apps consume TypeScript source directly — no pre-build step in dev or tests.
- **Project references.** Every package has a composite `tsconfig.json` (`rootDir: src`, `outDir: dist`) with `references` matching its `@pigeon/*` dependencies. `packages/<pkg>/test/tsconfig.json` is a composite `noEmit` project that type-checks tests against the package. The root `tsconfig.json` is a solution file referencing all of them. A missing reference shows up as a `rootDir` error, which keeps `references` and the dependency table in sync.
- **`pnpm typecheck`** = `tsc -b` (incremental; emits `dist/` + `*.tsbuildinfo`, both git-ignored). **`pnpm build`** = each package's `build` script (`tsc -b` for libraries; apps will use `vite build`).
- **Pure packages** (`core`, `formats`, `compare`, `platform`, `fixtures`) compile with `lib: ["ES2022"]`, `types: []` and the shared `types/web-globals.d.ts` (TextEncoder/Decoder, URL, URLSearchParams, AbortSignal/Controller, structuredClone, crypto.randomUUID/subtle.digest). DOM and Node globals are type errors there. Extend `web-globals.d.ts` only with APIs available in browsers, Tauri webviews **and** Node. DOM packages (`platform-web`, `platform-desktop`, `ui`) add `DOM` and `DOM.Iterable`. Test projects use `types: ["node"]`.
- **Vitest** runs every package as a project via `test.projects: ['packages/*']` in the root `vitest.config.ts`. A package that needs another environment (jsdom for `ui`) adds its own `vitest.config.ts`.
- **Apps** (PIGN-002) are `noEmit` composite projects in the root solution. `apps/web/tsconfig.json` covers `src/` (`types: ["vite/client"]`) and `apps/web/tsconfig.node.json` covers `vite.config.ts`. `e2e/tsconfig.json` type-checks the Playwright specs and `playwright.config.ts`. `pnpm build` runs `vite build` for apps.
- **Styles.** `@pigeon/ui` exports its stylesheet as `@pigeon/ui/styles.css` (Tailwind v4 + design tokens + bundled JetBrains Mono). The app imports it, and the app's Vite build compiles it (`@source` in the stylesheet points Tailwind at the ui sources). Components use token-backed Tailwind names (`bg-surface`, `text-fg-muted`, `text-method-get`, `text-pass`, …), never raw colours. Dark mode is `data-theme="dark"` on `<html>`, set by `ThemeProvider`.

## 3. Shared / core layer

### 3.1 Domain model (`core/model`)
Plain serializable TypeScript types (see [data-model.md](data-model.md)). Validated at boundaries with **zod** schemas. No classes with hidden state in the model; behaviour lives in services.

### 3.2 ProjectSession (`core/workspace`)
One instance per open project. Owns:
- **base model** — what the project files on disk say;
- **drafts** — locally saved changes (persisted via `AppStateStore`);
- **working model** = base + drafts (what the UI shows);
- file hashes for conflict detection.

API sketch:
```ts
class ProjectSession {
  static open(loc: ProjectLocation, platform: Platform): Promise<ProjectSession>;
  getWorkingModel(): ProjectModel;
  apply(cmd: EditCommand): void;              // unsaved (in-memory) edit
  save(ids?: EntityRef[]): Promise<void>;     // Save → local state drafts
  planCommit(ids?: EntityRef[]): Promise<CommitPlan>;
  commit(plan: CommitPlan): Promise<CommitResult>; // Save for Commit → files
  reload(): Promise<ReloadResult>;            // re-read files; detect conflicts
  resolveConflict(ref, choice): void;
  onChange(listener): Unsubscribe;
}
```
Edit commands are typed (`updateRequest`, `createItem`, `renameItem`, `moveItem`, `deleteItem`, `upsertEnvironment`, `setVariableCurrentValue`, `upsertExample`, `updateCompareConfig`…) so undo/redo can be added later without redesign.

### 3.3 Request execution (`core/execution`)
`RequestExecutor.execute(requestRef, context)` → `ExecutionResult`. Pipeline: resolve variables → apply auth → encode body → build `PreparedRequest` → `Transport.send()` → normalize response. Protocol handlers (`http`, `graphql`) are pluggable. See [api-execution.md](api-execution.md).

### 3.4 Comparison engine (`compare`)
Pure functions: `inferSchema(json)`, `compare(baseline, actual, config) → ComparisonResult`. No I/O. See [response-comparison.md](response-comparison.md).

### 3.5 Formats (`formats`)
- `canonicalJson.stringify(value, keyOrder)` — deterministic output.
- `project.read(fs) → ProjectModel` and `project.serialize(model) → Map<path, bytes>`.
- `postman.importCollection(json) → { collection, examples, report }`, `postman.exportCollection(model, opts) → json`.
- `postman.importEnvironment`, `exportEnvironment`, globals equivalents.
- `detectFormat(fileContent) → FormatId | unknown`.
See [file-format.md](file-format.md) and [compatibility.md](compatibility.md).

### 3.6 Runner (`core/runner`)
Executes an ordered list of requests (folder/collection) sequentially with one environment, runs comparison for each, emits progress events, returns a `RunReport`. (PIGN-038)

## 4. Platform layer

The UI receives one `Platform` object at startup:

```ts
interface Platform {
  kind: 'desktop' | 'web' | 'node' | 'memory';
  os: 'macos' | 'windows' | 'linux' | 'unknown';
  capabilities: Capabilities;               // see platform.md
  projects: ProjectLocator;                 // pick/create/reopen project locations
  openProjectFs(loc: ProjectLocation): Promise<ProjectFileSystem>;
  transport: Transport;
  appState: AppStateStore;
  secrets: SecretStore;
  dialogs: Dialogs;                         // open/save file pickers, confirm
  files: FileExchange;                      // import (pick/drop) and export (save/download) single files
}
```
Interfaces are defined in `packages/platform`; see [platform.md](platform.md) for each implementation and the capability matrix.

### 4.1 Desktop layer
- **Tauri 2** shell hosting the same UI bundle.
- TypeScript adapters in `platform-desktop` call Tauri plugins (`fs`, `dialog`, `fs` watch, `store`/files) and custom Rust commands.
- Rust is kept minimal: `http_send`/`http_cancel` (reqwest), plus plugin configuration. No business logic in Rust.

### 4.2 Web layer
- Static SPA built by Vite; deployable to any static host; no Pigeon backend.
- `FetchTransport` (subject to CORS), `FsAccessFs` (Chromium File System Access API), `IdbFs` (browser workspace in IndexedDB), `IdbAppState`.

## 5. Local storage

Two kinds of data with a hard boundary:

| | Project files | Local app state |
|---|---|---|
| Purpose | Shared, versioned API definitions | Personal, machine-specific state |
| Location | The project folder (user-chosen) | Desktop: OS app-data dir. Web: IndexedDB |
| Written by | **Save for Commit** only | **Save**, and automatically for UI state |
| Contains | collections, folders, requests, environments (shared values), globals, examples, comparison rules | drafts, open tabs, selected env, variable current values, secrets, last responses, run reports, recent projects, preferences |
| In Git | Yes | Never |

Local state is never stored inside the project folder, so it can't be committed by accident. Details: [file-format.md §6](file-format.md#6-local-app-state).

## 6. Filesystem / project model

A project is a folder containing `pigeon.json`. Pigeon manages only these paths: `pigeon.json`, `collections/**`, `environments/**`, `examples/**`, and optionally writes `.gitattributes` on project creation. All other files are ignored and never modified. Core code uses POSIX-style paths relative to the project root; adapters convert. See [file-format.md](file-format.md).

## 7. Import / export

- Import: `FileExchange.pickFiles()` or drag & drop → `detectFormat` → importer → preview (`ImportPlan`) → apply as drafts → user may Save for Commit immediately (the import dialog offers "Write files now").
- Export: `formats` produces a JSON object → `FileExchange.saveFile(name, bytes)` (desktop: save dialog; web: download).
See [compatibility.md](compatibility.md).

## 8. UI / state management

- **React + TypeScript**, **Zustand** stores.
- `appStore` (single): open projects, active project, recent projects, preferences.
- `createProjectStore(session)` (one per open project): mirrors `ProjectSession` working model via `onChange`, plus UI state (tabs, explorer expansion, selection, last results). Stores are never shared between projects → isolation by construction.
- Editors: **CodeMirror 6** (JSON/GraphQL/JS/XML modes, large documents).
- Styling: **Tailwind CSS** + **Radix UI** primitives; command palette via **cmdk**; virtualized lists/trees via **@tanstack/react-virtual**.
- UI never calls `Platform` I/O for project data directly; it calls `ProjectSession`/`RequestExecutor`. UI may call `Platform.dialogs`, `Platform.files`, and read `capabilities`.
See [ui-ux.md](ui-ux.md).

## 9. Extensibility (without over-engineering)

| Extension point | Mechanism |
|---|---|
| New protocol (WebSocket, gRPC, SSE) | `ProtocolHandler` interface + separate `StreamingTransport` interface (defined but unimplemented in MVP) |
| New auth type | `AuthHandler` registry keyed by Postman auth `type` |
| New import format | `Importer` registry with `detect()` + `import()` |
| New body comparison (XML, text) | `BodyComparator` registry keyed by media type |
| New platform | Implement `Platform` |
| CLI | `platform-node` + core runner (PIGN-054) |

No plugin loading at runtime in MVP; registries are static.

## 10. Cross-cutting concerns

- **Errors**: core returns typed results (`Result<T, PigeonError>`) for expected failures (parse errors, conflicts, network errors); exceptions only for bugs.
- **Logging**: `platform.log` (console on web, file in app-data on desktop). Never log secret values; `maskSecrets()` helper in core.
- **Security**: strict CSP on web and desktop; no remote scripts; Tauri capabilities restricted to needed plugins; user scripts (later) run in a QuickJS sandbox in a Worker.
- **No telemetry** in MVP. No network calls except user-initiated requests.
- **i18n**: English only in MVP; keep strings in components simple to extract later.

## 11. Technical decisions

Status: **Proposed** = recommended, confirm before the dependent story starts. **Open** = must be decided by the product owner.

| ID | Decision | Recommendation | Status | Needed by |
|---|---|---|---|---|
| D-01 | Desktop shell | **Tauri 2** (small binaries, low memory → "lightweight"; native HTTP in Rust bypasses CORS). Alternative: Electron (single language, Node HTTP, larger footprint). The adapter boundary keeps this swappable. | Proposed | PIGN-003 |
| D-02 | Language & tooling | TypeScript 6.0 (strict), pnpm 11 workspaces, Vite, Vitest 5, Playwright, ESLint 10 (flat) + typescript-eslint + Prettier, Node 24 LTS (`.nvmrc`; engines ≥ 22.12), Rust stable. TypeScript 7 is not used yet: typescript-eslint 8 supports TS < 6.1. | **Accepted** (PIGN-001) | PIGN-001 |
| D-03 | Desktop HTTP | Custom Rust commands `http_send`/`http_cancel` using `reqwest` (full control of redirects, raw multi-value headers, timings, TLS options, cancellation). `tauri-plugin-http` acceptable as a spike only. | Proposed | PIGN-007 |
| D-04 | UI stack | React 19, Zustand, CodeMirror 6, Tailwind v4, Radix (`radix-ui` package), react-resizable-panels v4, lucide-react icons, cmdk, @tanstack/react-virtual. PIGN-002 adopted React, Tailwind, Radix, resizable panels and lucide; the rest are added by the stories that need them. | **Accepted** (PIGN-002) | PIGN-002 |
| D-05 | On-disk format | Exploded **Postman v2.1 fragments** as JSON: one file per collection root, folder, request, environment, example. Pigeon-only data under `_pigeon` or in Pigeon-only files. Alternatives rejected: single v2.1 file per collection (huge diffs, merge conflicts); YAML (diverges from Postman, harder determinism). | Proposed | PIGN-012 |
| D-06 | Example bodies | Stored in sidecar files (`*.body.json` pretty-printed, `*.body.txt`, …) for readable diffs; inlined on Postman export. | Proposed | PIGN-027 |
| D-07 | Local state storage | Desktop: JSON files in app-data dir (one per project + app file). Web: IndexedDB. SQLite deferred until needed (history, large caches). | Proposed | PIGN-018 |
| D-08 | Web filesystem | File System Access API (Chromium) for real folders; IndexedDB browser workspace + zip import/export elsewhere. | Proposed | PIGN-015 |
| D-09 | Validation | zod for file/import validation | Proposed | PIGN-006 |
| D-10 | Script sandbox (later) | `quickjs-emscripten` in a Web Worker, identical on desktop and web | Proposed | PIGN-043 |
| D-11 | Distribution | App identifier (e.g. `dev.pigeon.app`), code-signing certificates (Apple Developer ID, Windows Authenticode), auto-update policy | **Open** | PIGN-041 |
| D-12 | Web hosting | Target host/domain for the static site | **Open** | PIGN-039 |
| D-13 | License | Open-source license (if any) | **Open** | before public release |
| D-14 | Apidog / Echo API formats | Collect real export samples before implementing importers | **Open** (needs samples) | PIGN-048/049 |

When a story deviates from a Proposed decision, the implementer updates this table (status → *Changed*, with a one-line reason) in the same change.
