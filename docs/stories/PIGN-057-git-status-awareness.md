# PIGN-057 — Read-only Git status awareness (desktop)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-057 | 9 — Later | Later | Todo | PIGN-041 |

## Goal
On desktop, show which Pigeon project files are modified/untracked relative to Git `HEAD`, and the current branch — read-only. Pigeon still never commits, pushes, or pulls.

## User story
As a developer, I want to see which requests I've changed since my last commit, so I know what my next Git commit will contain.

## Context
- Git is out of scope for writing: [product.md §4](../product.md#4-non-goals). Web cannot access Git: [platform.md §6.6](../platform.md#66-git--local-repository-access).

## Scope
**In scope**
- Detect a Git repository containing the project folder (walk up to find `.git`), via the user's installed `git` binary (`git status --porcelain=v2 -z -- <project paths>`, `git rev-parse --abbrev-ref HEAD`) through a Rust command with a strict allowlist of read-only subcommands; no bundled Git.
- Explorer decoration: Git state (modified/untracked/staged) per entity file — distinct from Pigeon's draft badges (`M` local draft vs Git dot).
- Status bar: branch name, count of changed Pigeon files; refresh on file watcher events and window focus.
- "Open in Git client" / "Reveal in terminal" helpers (optional).
- Capability `gitStatus: boolean` (false on web; false when `git` isn't installed).

**Out of scope**
- Any Git write operation, diffs from history, blame.

## Acceptance criteria
- [ ] After Save for Commit, changed files show as Git-modified; after the user commits externally, decorations clear on refresh.
- [ ] No Git subcommand other than the allowlisted read-only ones can be invoked (Rust test).
- [ ] Missing `git` → feature hidden, no errors.
- [ ] Works on macOS, Windows, Linux.

## Technical notes
- Use `-z` output parsing to handle unicode/space paths safely.

## Files / components likely affected
`apps/desktop/src-tauri/src/git.rs`, `packages/platform-desktop/src/git.ts`, `packages/platform/src/capabilities.ts`, `packages/ui/src/features/explorer/*`, status bar, `docs/platform.md`.

## Tests required
`cargo test` (allowlist), integration with a temp Git repo (Node), desktop E2E on Linux/Windows.

## Definition of done
Standard DoD.
