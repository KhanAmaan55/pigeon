# PIGN-021 — Multiple isolated projects

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-021 | 2 — Projects | MVP | Todo | PIGN-018 |

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
- [ ] Two projects open simultaneously; switching preserves each one's tabs and unsaved edits.
- [ ] Closing and reopening the app restores both projects and the active one.
- [ ] Saving in project A never changes project B's local state namespace (verified by test).
- [ ] Copied project folder (same id) opens with a separate local state and a warning banner.
- [ ] Works on desktop and web (web: fs-access + workspace mix).

## Technical notes
- No module-level singletons holding project data anywhere in `ui` or `core` (review checklist item; add a lint rule if cheap).

## Files / components likely affected
`packages/ui/src/stores/{app-store,project-store}.ts`, `packages/ui/src/app/ProjectTabs.tsx`, `packages/core/src/workspace/project-session.ts`, `packages/core/src/execution/executor.ts`, `apps/desktop/src-tauri/src/http.rs`.

## Tests required
- Integration: two sessions over one MemoryAppState, isolation assertions.
- Playwright: open two workspaces, switch, restore after reload.

## Definition of done
Standard DoD. Milestone **M2** reached.
