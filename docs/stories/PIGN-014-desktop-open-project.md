# PIGN-014 — Create/open project on desktop + explorer

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-014 | 2 — Projects | MVP | Todo | PIGN-007, PIGN-013 |

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
- [ ] Create project → folder contains `pigeon.json`, `collections/`, `environments/`, `examples/`, `.gitattributes`.
- [ ] Opening `packages/fixtures/projects/basic` shows the exact tree order defined by the files.
- [ ] Recent projects persist across app restarts and reopen without re-picking the folder.
- [ ] A broken request file shows ⚠ with the parse error; other items work.
- [ ] Sending a project request (read-only) works using the desktop transport.
- [ ] Works on macOS, Windows (paths with backslashes/spaces), Linux (verified in CI via desktop E2E or NodeFs-equivalent tests of the path conversion).

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
