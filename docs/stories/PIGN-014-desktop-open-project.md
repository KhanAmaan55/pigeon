# PIGN-014 — Create/open project on desktop + explorer

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-014 | 2 — Projects | MVP | Done | PIGN-007, PIGN-013 |

## Goal
On desktop, create a new project folder or open an existing one, see its collections in the explorer tree, and open requests (read-only for now) — plus the Welcome screen and recent projects.

## User story
As a desktop user, I want to open my repo's `pigeon/` folder and browse its collections, so I can work with API definitions stored in Git.

## Context
- ProjectSession: [architecture.md §3.2](../architecture.md#32-projectsession-coreworkspace).
- Desktop FS: [platform.md §5.1](../platform.md#51-shared-desktop-implementation).
- Welcome & explorer UI: [ui-ux.md §3.1–3.2](../ui-ux.md#31-welcome--project-switching).

## Scope
**In scope**
- `core/workspace/project-session.ts`: `ProjectSession.open(location, platform)` (read-only operations only in this story: load, working model = base, `onChange`).
- `platform-desktop`: `TauriFs` (plugin-fs, POSIX↔native path conversion, atomic write temp+rename), `ProjectLocator` (folder picker via plugin-dialog; create = pick parent + name), persisted scope plugin; `AppStateStore` backed by `app.json` in app-data (only `recentProjects` used now).
- Welcome screen: Create project, Open folder, recent projects (desktop), with "missing folder" state.
- Opening a folder without `pigeon.json` → dialog "Initialize Pigeon project here?" (creates files via `createEmptyProject`).
- Explorer tree (virtualized) showing collections/folders/requests with method badges; broken files with ⚠ and the problem message.
- Clicking a request shows it in the (single) editor, read-only banner "Editing arrives in PIGN-016" is acceptable — or reuse the scratch editor in read-only mode.
- `FileRef { kind: 'project' }` resolution in executor (for form-data/binary paths relative to project root).
- Scratch request remains available when no project is open.

**Out of scope**
- Web (PIGN-015), tabs (PIGN-016), editing/CRUD (PIGN-017), save (PIGN-018), watch (PIGN-020), multiple projects (PIGN-021).

## Acceptance criteria
- [x] Create project → folder contains `pigeon.json`, `collections/`, `environments/`, `examples/`, `.gitattributes`.
- [x] Opening `packages/fixtures/projects/basic` shows the exact tree order defined by the files.
- [x] Recent projects persist across app restarts and reopen without re-picking the folder.
- [x] A broken request file shows ⚠ with the parse error; other items work.
- [x] Sending a project request (read-only) works using the desktop transport.
- [x] Works on macOS, Windows (paths with backslashes/spaces), Linux (verified in CI via desktop E2E or NodeFs-equivalent tests of the path conversion).

## Technical notes
- Path conversion utilities in `platform-desktop/src/paths.ts` with unit tests for Windows drive letters and UNC paths.
- Keep `ProjectSession` free of UI; the UI's `createProjectStore(session)` subscribes to it.

## Files / components likely affected
`packages/core/src/workspace/project-session.ts`, `packages/platform-desktop/src/{tauri-fs,project-locator,app-state,paths}.ts`, `apps/desktop/src-tauri/{Cargo.toml,capabilities/default.json,src/main.rs}`, `packages/ui/src/features/{projects,explorer}/*`, `packages/ui/src/stores/{app-store,project-store}.ts`.

## Tests required
- Unit: path conversion, ProjectSession open on MemoryFs.
- Desktop E2E (Linux/Windows): open fixture project, tree visible, send a request.
- Web Playwright unaffected (explorer tested with memory platform + fixture preloaded via test hook).

## Definition of done
Standard DoD plus desktop build green on all OSes.

## Implementation notes
- **Desktop filesystem without plugin-fs (deviation, D-15).** Like `save_file`, project access goes through app commands in `src-tauri/src/project_fs.rs` (`project_fs_read/write/stat/list/mkdirp/remove/rename`, `project_pick_folder`, `project_create`, `project_reopen`) instead of `@tauri-apps/plugin-fs` + `tauri-plugin-persisted-scope`. Rust shows the folder dialogs, remembers granted roots in `<app-data>/project-roots.json` (so recent projects reopen without re-picking) and re-validates every project path; the webview gets no general fs or dialog permission. The `--smoke` probe checks that an ungranted folder is refused.
- `TauriFs` passes `fsConformance` through a MemoryFs-backed fake of the IPC contract; the Rust operations have their own `cargo test` cases (errors, atomic writes, sorting, case-only renames). Locked-file retry on Windows: 3 attempts with backoff on rename.
- App state: `FileAppState` keeps one JSON document per namespace (`app.json`, `projects/<id>/state.json`) via `app_state_read/write`.
- Path conversion: `platform-desktop/src/paths.ts` (`toNativePath`, `fromNativePath`, `nativeBaseName`) with drive-letter, UNC and space tests; Rust joins segments with `PathBuf`.
- `ProjectSession` (read side), `initializeProject` and `isPigeonProject` live in `core/workspace/project-session.ts`. Project file references (`FileRef { kind: 'project' }`) are read through `ExecutionContext.projectFs` and handed to the transport as temporary picked files (`resolveProjectFiles`), so native and fetch transports behave the same.
- UI: `stores/app-store.ts` (open project, recent projects persisted under `app`/`recentProjects`, max 10), `stores/project-store.ts`, Welcome panel in the Collections sidebar, init dialog, virtualized explorer (`@tanstack/react-virtual`). Selecting a request loads a copy into the existing editor with a banner; edits are not saved (PIGN-016/018). Broken files show ⚠ and a panel with the path and parse error.
- The in-app confirm is a Radix dialog, not `Platform.dialogs`, because webviews don't implement `window.confirm` consistently.
- Web: until PIGN-015 the web platform keeps the memory locator. E2E builds (`pnpm --filter @pigeon/web build:e2e`, `.env.e2e`) install `window.__pigeonTest.preloadProject(files)`; production bundles don't contain it. `e2e/web/projects.spec.ts` runs on Chromium.
- Follow-up: desktop E2E with WebdriverIO + tauri-driver on Linux/Windows CI is not set up yet; macOS is covered by build + `--smoke`.
