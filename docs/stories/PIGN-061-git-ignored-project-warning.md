# PIGN-061 — Warn when the project folder is ignored by Git (desktop)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-061 | 9 — Later | Later | Done | PIGN-057 |

## Goal
On desktop, warn when a project is created, initialized or opened inside a folder that Git ignores, so nobody keeps working in a project whose files will never be committed.

## User story
As a developer, I want Pigeon to tell me when my project sits in a gitignored folder (for example a project created under the repository's `dist/` by mistake), so I move it before I think my collections and environments are saved and shared when Git, my editor and my teammates never see them, and a build step may delete them.

## Context
- Project files are meant to be committed and shared through Git; Pigeon never runs a Git command that writes ([product.md §4](../product.md#4-non-goals)). Git status is read-only and desktop-only ([platform.md §5.1](../platform.md), PIGN-057).
- Reported case: Create project with the repository's `dist/` picked as the parent folder; `/dist` is in `.gitignore`, so nothing Pigeon wrote showed up in Git or the editor.

## Scope
**In scope**
- `git check-ignore -q -- .` from the project root (read-only, added to the Rust allowlist); covers the folder itself and any ignored parent.
- The Git status carries `repository.ignored` and `repository.path` (the project folder inside the repository).
- A non-blocking warning in the explorer: "This folder is ignored by Git (dist/Pigeon): changes here won't be committed. Move the project out of it to share it."
- Hidden on web (no `gitStatus` capability), without `git`, and outside a repository; it goes away on the next refresh (window focus, project changes) once the folder is no longer ignored.

**Out of scope**
- Moving the project or changing `.gitignore` for the user; checking the picked parent folder before Create project writes anything; naming the `.gitignore` rule that matched.

## Acceptance criteria
- [x] Only `check-ignore -q -- .` (no other paths, `--stdin`, `-v` or `--no-index`) can be run, alongside the existing read-only queries (Rust test).
- [x] A project under a gitignored folder, or a gitignored folder itself, is reported ignored; a tracked folder and the repository root are not (temporary-repository test).
- [x] The warning shows after opening, creating or initializing a project in an ignored folder, and leaves the explorer usable (UI tests with a fake Git status).
- [x] No warning when not ignored, without `git`, outside a repository, or on web.

## Implementation notes
- **Rust** (`src-tauri/src/git.rs`): `GitQuery::CheckIgnore` (`check-ignore -q -- .`), listed in `GitQuery::ALL` and `ALLOWED_SUBCOMMANDS`; `GitRun::Exited` now carries the exit code. `status()` runs it after `status` succeeds; only exit 0 counts as ignored (1 is not ignored, anything else is not reported). `GitRepository` gained `path` (the `--show-prefix` value) and `ignored`.
- **Platform**: `GitStatus.repository.path` / `.ignored` in `platform/src/git.ts`; `DesktopGitStatus` passes them through unchanged.
- **UI**: `GitIgnoredBanner` in `features/git/git-status.tsx`, a `warn` `Callout` with `role="status"` in the explorer under the filter. It reads the same per-session Git store as the status bar, so it refreshes with it.
- **Tests**: cargo — allowlist (refused `check-ignore` variants) and the temporary repository (`/dist` and `scratch/` ignored, parent-ignored `dist/Pigeon`, files under it never listed as changed). TS — `packages/ui/test/git-status.test.tsx` (open, create, init, cleared on focus, hidden states).
