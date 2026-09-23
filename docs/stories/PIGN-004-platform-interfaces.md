# PIGN-004 — Platform interfaces, capabilities & memory adapters

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-004 | 0 — Foundation | MVP | Todo | PIGN-002 |

## Goal
Define the `Platform` contract and capability model, provide in-memory implementations, inject the platform into the UI, and show capabilities in an About/Diagnostics panel on web and desktop.

## User story
As a user, I want Pigeon to know what my platform can and can't do, so features behave correctly on desktop and in the browser.

## Context
- Interfaces and capabilities: [platform.md §2–4](../platform.md#2-interfaces-packagesplatform).
- Platform object: [architecture.md §4](../architecture.md#4-platform-layer).

## Scope
**In scope**
- `packages/platform/src/`: `fs.ts`, `transport.ts`, `app-state.ts`, `secrets.ts`, `dialogs.ts`, `files.ts` (FileExchange), `projects.ts` (ProjectLocator), `capabilities.ts`, `platform.ts` (`Platform` interface), with types exactly as in platform.md (adjust only with doc update).
- `PreparedRequest` / `RawResponse` types (api-execution.md §2) in `transport.ts`.
- `packages/platform/src/memory/`: `MemoryFs` (full `ProjectFileSystem` incl. atomic write and watch emitting events), `MemoryAppState`, `MemorySecretStore`, `MockTransport` (programmable responses), `createMemoryPlatform()`.
- `packages/platform/src/conformance/fs.ts`: `fsConformance(createFs)` suite (initial cases: read/write text & bytes, overwrite, atomic write, list recursive, mkdirp, remove recursive, rename file & dir, unicode names, stat); run against MemoryFs.
- `packages/platform-web/src/`: `detectWebCapabilities()` (feature detection: `showDirectoryPicker`, etc.) and `createWebPlatform()` returning memory-backed fs/state for now + real capabilities.
- `packages/platform-desktop/src/`: `createDesktopPlatform()` with desktop capabilities and memory-backed services for now; OS detection via `@tauri-apps/plugin-os`.
- `PlatformProvider` React context + `usePlatform()`, `useCapabilities()` hooks in `ui`.
- Settings → **About / Diagnostics** panel listing platform kind, OS, and all capability values.

**Out of scope**
- Real transports, filesystems, and storage (later stories).

## Acceptance criteria
- [ ] `PigeonApp` requires a `platform` prop; `apps/web` passes `createWebPlatform()`, `apps/desktop` passes `createDesktopPlatform()`.
- [ ] Diagnostics panel shows `bypassesCors: false` on web and `true` on desktop, and `projectFolders: 'fs-access'` in Chromium vs `'none'` in Firefox/WebKit.
- [ ] `fsConformance` passes for MemoryFs.
- [ ] No UI code checks `platform.kind` (lint rule or grep check in CI: forbid `platform.kind ===` in `packages/ui/src/features`).

## Technical notes
- `MemoryFs` must reject absolute paths and `..` segments (shared `assertProjectPath()` helper in `platform`).
- Capabilities object is frozen.
- Keep interfaces async even where memory impls are sync.

## Files / components likely affected
`packages/platform/src/**`, `packages/platform-web/src/**`, `packages/platform-desktop/src/**`, `packages/ui/src/app/PlatformProvider.tsx`, `packages/ui/src/features/settings/Diagnostics.tsx`, `apps/web/src/main.tsx`, `apps/desktop/src/main.tsx`.

## Tests required
- `fsConformance(MemoryFs)`, MockTransport unit tests, path validation tests.
- Playwright: diagnostics panel shows expected capability values per browser.

## Definition of done
Standard DoD.
