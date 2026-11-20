# PIGN-021 — Multiple isolated projects

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-021 | 2 — Projects | MVP | Done | PIGN-018 |

## Goal
Open several projects at once as top-level project tabs, each completely isolated (model, drafts, tabs, environment selection, current values, results, HTTP client).

## User story
As a developer working on several services, I want each project open in its own tab without anything leaking between them, so I can switch contexts safely.

## Context
- Isolation principle: [product.md §5 W7](../product.md#w7--multiple-projects), [architecture.md §8](../architecture.md#8-ui--state-management).
- Local state keying and duplicate ids: [file-format.md §6](../file-format.md#6-local-app-state).

## Scope
**In scope**
- `appStore`: `openProjects`, `activeProjectId`; one `ProjectSession` + one project store per open project; restored on restart.
- Project tabs in top bar: name, close (prompt on unsaved), `Cmd/Ctrl+Alt+←/→`, "+" opens Welcome/project picker.
- Transport isolation: executor passes `projectId`; Rust keeps one reqwest client per project (connection pool isolation).
- Duplicate project id handling: second project with same id gets local-state key `<id>@<hash(location)>` + banner with **Regenerate project id** (creates a draft for `pigeon.json`).
- Opening an already-open project focuses its tab.
- Isolation test suite: two projects with overlapping entity names/ids → edits, saves, and (later) env selections don't cross.

**Out of scope**
- Multi-window (later), cross-project copy/paste of requests (nice-to-have later).

## Acceptance criteria
- [x] Two projects open simultaneously; switching preserves each one's tabs and unsaved edits.
- [x] Closing and reopening the app restores both projects and the active one.
- [x] Saving in project A never changes project B's local state namespace (verified by test).
- [x] Copied project folder (same id) opens with a separate local state and a warning banner.
- [x] Works on desktop and web (web: fs-access + workspace mix).

## Technical notes
- No module-level singletons holding project data anywhere in `ui` or `core` (review checklist item; add a lint rule if cheap).

## Files / components likely affected
`packages/ui/src/stores/{app-store,project-store}.ts`, `packages/ui/src/app/ProjectTabs.tsx`, `packages/core/src/workspace/project-session.ts`, `packages/core/src/execution/executor.ts`, `apps/desktop/src-tauri/src/http.rs`.

## Tests required
- Integration: two sessions over one MemoryAppState, isolation assertions.
- Playwright: open two workspaces, switch, restore after reload.

## Definition of done
Standard DoD. Milestone **M2** reached.

## Implementation notes
- App store: `projects` (tab order, keyed by `locationKey`), `project` = the active one (or `null` while Welcome shows via "+"), `switchProject`, `cycleProject` (Cmd/Ctrl+Alt+←/→), `closeProject(key?)` (prompt when there are unsaved edits; drafts stay), `showWelcome`. Opening an already-open folder focuses its tab. Open projects and the active one persist in `app`/`openProjects` + `activeProject` and reopen silently on start (folders that need permission or are missing stay in the recent list).
- Each open project keeps its own session, store, watcher and editors; the main area is keyed by project so per-project UI state never leaks.
- Duplicate ids: `app`/`projectLocations` remembers the first folder seen per project id. Another folder with that id gets the local-state key `<id>@<sha256(location)[0..8]>` (`ProjectSession.fromFs({ localKey })`, `session.localKey`) and a banner with **Regenerate project id**, which is a project-level edit (`setProjectInfo`, pseudo entity `PROJECT_ENTITY_ID = '$project'`) saved/committed like any other change (writes `pigeon.json`).
- Transport isolation: editors send with `projectId = session.localKey`; the Rust transport already keeps one reqwest client per project id.
- No module-level singletons hold project data: the editor registry is a `WeakMap` keyed by session; the only module-level value is the pending "focus URL" request id (UI-only, consumed on mount).
- The PIGN-018/019 E2E reload flows now rely on auto-restore instead of clicking the recent entry.
