# PIGN-015 — Open project on web (folder access & browser workspace)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-015 | 2 — Projects | MVP | Done | PIGN-014 |

## Goal
Give the web version real projects: open/create a local folder via the File System Access API in Chromium, or use an IndexedDB **browser workspace** in any browser, with zip import/export.

## User story
As a web user, I want to work on a real project folder (Chromium) or a browser-stored workspace (any browser), so I can use Pigeon without installing anything.

## Context
- Web filesystem: [platform.md §6.3, §6.6](../platform.md#63-local-filesystem-access); D-08.
- Welcome screen: [ui-ux.md §3.1](../ui-ux.md#31-welcome--project-switching).

## Scope
**In scope**
- `platform-web/src/fs-access-fs.ts`: `FsAccessFs` over `FileSystemDirectoryHandle` (atomic write via `createWritable`; rename via copy+delete when `move()` is unavailable).
- `platform-web/src/idb-fs.ts`: `IdbFs` storing files by path in IndexedDB (`workspaces` + `blobs` stores).
- `platform-web/src/idb-app-state.ts`: `AppStateStore` on IndexedDB; handles persisted in `handles` store.
- `ProjectLocator` (web): `pickProjectFolder` (Chromium), `createProject` (folder or workspace), `reopen` with `queryPermission`/`requestPermission` → Welcome shows **Reconnect** buttons for handles needing permission.
- `navigator.storage.persist()` request on first workspace creation; result shown in project settings.
- Project zip: **Export project (.zip)** and **Import project (.zip)** (managed paths only) using a small zip lib (e.g. `fflate`), for browser workspaces (and available for fs-access too).
- Capabilities wiring: `projectFolders`, `browserWorkspace`, `persistentFolderAccess`.

**Out of scope**
- Refresh/external change detection (PIGN-020), editing (PIGN-016+).

## Acceptance criteria
- [x] Chromium: Open folder → the fixture project tree renders; reload → Reconnect → tree renders again.
- [x] Firefox/WebKit: "Open folder" is not shown; "New browser workspace" creates a project that persists across reloads.
- [x] Export zip → import zip into a new workspace yields identical files (byte-equal).
- [x] `fsConformance` passes for `IdbFs` (fake-indexeddb) and `FsAccessFs` (Playwright Chromium via OPFS handle).

## Technical notes
- Test hook: in test builds expose `window.__pigeonTest.openHandle(handle)` to inject an OPFS handle (the native picker can't be automated).
- Zip import must validate paths (no `..`, no absolute paths) and only accept managed paths.

## Files / components likely affected
`packages/platform-web/src/{fs-access-fs,idb-fs,idb-app-state,project-locator,zip}.ts`, `packages/platform/src/conformance/fs.ts`, `packages/ui/src/features/projects/*`, `e2e/web/projects.spec.ts`.

## Tests required
- fs conformance (IdbFs, FsAccessFs), zip round trip, Playwright flows in 3 browsers (capability-dependent).

## Definition of done
Standard DoD.

## Implementation notes
- `platform-web`: `FsAccessFs` (File System Access handles; `createWritable()` writes, copy+delete renames, case-only renames through a temporary name, Chromium `.crswap` files hidden), `IdbFs` (browser workspace: loads the workspace into a `MemoryFs` for semantics and reads, writes every change through to the `blobs` store in one transaction), `IdbAppState`, `WebProjectLocator`, and the `pigeon` database helper (`idb.ts`). `createWebPlatform` wires them when IndexedDB exists.
- `ProjectLocator` gained optional `createBrowserWorkspace(name)` and `storagePersisted()`. On web, `createProject` creates `<picked parent>/<name>` when folders are available, else a workspace. `navigator.storage.persist()` is requested once on the first workspace, **not awaited** (Firefox answers through a prompt that can stay open); the explorer shows the result on a workspace badge (there is no project-settings screen yet).
- Reconnect: `reopen` returns `needs-permission` when `queryPermission` isn't `granted`; the recent-project row shows **Reconnect**, which calls `requestPermission` in the click.
- fs conformance is now framework-free (`fsConformanceCases()` in `@pigeon/platform/conformance/fs-cases`, wrapped for Vitest by `fsConformance`), so Playwright runs it in Chromium against `FsAccessFs` on OPFS. In Node it runs for `IdbFs` (fake-indexeddb) and `FsAccessFs` on fake handles.
- Project zips live in `core/workspace/project-zip.ts` (fflate): project files only (`isManagedPath` from `formats/project/managed.ts`, plus `.gitattributes`), fixed entry times so equal projects give equal zips, unsafe/unmanaged entries skipped on import, a single wrapping folder unwrapped. Import always creates a new browser workspace.
- E2E hooks (`apps/web/src/test-hooks.ts`, e2e builds only): `openHandle`, `preloadProject` (OPFS folder), `simulatePermissionPromptAfterReload`, `runFsConformance`. Chromium's export goes through the native save picker, so the zip round trip runs in Firefox/WebKit E2E (and in core unit tests everywhere).
