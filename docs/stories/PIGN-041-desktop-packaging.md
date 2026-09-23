# PIGN-041 — Desktop packaging & release builds

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-041 | 8 — Hardening | MVP | Todo | PIGN-040 |

## Goal
Produce installable, versioned desktop builds for macOS, Windows, and Linux from CI on tags, with signing hooks ready and a per-OS release checklist.

## User story
As a user on any desktop OS, I want a normal installer that just works offline, so adopting Pigeon is frictionless.

## Context
- Per-OS packaging: [platform.md §5.2–5.4](../platform.md#52-macos).
- D-11 (identifier, signing, auto-update) is **Open** — confirm the app identifier before this story; signing secrets may be absent (build unsigned then).

## Scope
**In scope**
- Versioning: single source (root `package.json` version) propagated to Tauri config and `User-Agent`.
- Targets: macOS universal `.dmg` (+ `.app`), Windows NSIS `.exe` (and `.msi` if cheap) with WebView2 bootstrapper, Linux AppImage + `.deb`.
- App icons for all platforms (placeholder art acceptable), product name, identifier, copyright.
- Signing hooks: macOS codesign + notarization via env secrets; Windows Authenticode via env secrets; skipped with a warning when secrets are missing.
- `release.yml` workflow on `v*` tags: build matrix, attach artifacts to a draft GitHub release, checksums (`SHA256SUMS`).
- Desktop menus complete: File (New request, Open project, Import, Export, Close project), Edit, View (toggle sidebar, response layout, zoom), Window, Help (Docs, Web limitations, About with version).
- Window state persistence (size/position) per OS.
- Release checklist `docs/release-checklist.md` (install, first launch, open folder permission, send request offline to localhost, Save for Commit, shortcuts, dark mode, uninstall) — per OS.
- `--smoke` run in CI on built artifacts (not only dev builds).

**Out of scope**
- Auto-update (decide under D-11; later), store distribution (Mac App Store, winget, Flathub — future).

## Acceptance criteria
- [ ] Tagging `v0.1.0` produces a draft release with artifacts for all three OSes and checksums.
- [ ] Built artifacts pass the smoke run on each OS.
- [ ] App works fully offline on each OS (manual checklist, recorded in implementation notes).
- [ ] Unsigned builds clearly documented (how to open on macOS/Windows) when signing is not configured.

## Technical notes
- Linux AppImage needs `libfuse2` on some distros — document.
- Keep the release workflow separate from CI to avoid slowing PRs.

## Files / components likely affected
`apps/desktop/src-tauri/{tauri.conf.json,icons/**}`, `.github/workflows/release.yml`, `docs/release-checklist.md`, menu setup in `apps/desktop/src-tauri/src/main.rs`.

## Tests required
Smoke runs on built artifacts; manual checklist per OS.

## Definition of done
Standard DoD plus a draft release produced from a test tag.
