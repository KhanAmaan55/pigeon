# PIGN-041 — Desktop packaging & release builds

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-041 | 8 — Hardening | MVP | Done | PIGN-040 |

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
- [ ] Tagging `v0.1.0` produces a draft release with artifacts for all three OSes and checksums. — workflow written; not run (needs a pushed tag)
- [ ] Built artifacts pass the smoke run on each OS. — macOS DMG verified locally; Windows/Linux in the release workflow (not run yet)
- [ ] App works fully offline on each OS (manual checklist, recorded in implementation notes). — checklist written; manual runs pending
- [x] Unsigned builds clearly documented (how to open on macOS/Windows) when signing is not configured.

## Technical notes
- Linux AppImage needs `libfuse2` on some distros — document.
- Keep the release workflow separate from CI to avoid slowing PRs.

## Files / components likely affected
`apps/desktop/src-tauri/{tauri.conf.json,icons/**}`, `.github/workflows/release.yml`, `docs/release-checklist.md`, menu setup in `apps/desktop/src-tauri/src/main.rs`.

## Tests required
Smoke runs on built artifacts; manual checklist per OS.

## Definition of done
Standard DoD plus a draft release produced from a test tag.

## Implementation notes
- **Version**: the root `package.json` (`0.1.0`) is the single source. `tauri.conf.json` reads it (`"version": "../../../package.json"`); `pnpm version:sync` (`scripts/sync-version.mjs`) copies it to the workspace packages, `Cargo.toml` and `PIGEON_VERSION` (the `User-Agent`); `--check` fails on drift and the release workflow runs it; `packages/core/test/version.test.ts` keeps them equal in `pnpm test`.
- **Bundles**: explicit targets (`app`, `dmg`, `nsis`, `msi`, `deb`, `appimage`; rpm dropped), publisher, copyright, category (developer tools), descriptions, macOS 11 minimum, NSIS per-user install with the WebView2 download bootstrapper. The existing placeholder icons are kept. The identifier stays `dev.pigeon.desktop` until D-11 confirms it (documented).
- **Release workflow** (`.github/workflows/release.yml`, separate from CI): on `v*` tags (or by hand) builds macOS universal (`--target universal-apple-darwin`, checked with `lipo`), Windows and Linux; signing steps use the Apple / Authenticode secrets when present (Tauri's own env-based signing and notarization on macOS; a generated `--config` with the certificate thumbprint on Windows) and warn otherwise; smoke-tests what users install (the mounted DMG, a silent NSIS install, the AppImage and the installed `.deb`); uploads the artifacts; a `publish` job adds `SHA256SUMS` and creates (or updates) a draft release with `gh`.
- **Menus** (`src-tauri/src/menu.rs`): File (New Request, Open Project…, Import…, Export Project…, Close Project), Edit (macOS), View (Toggle Sidebar, Toggle Response Layout, Zoom In/Out/Actual Size, Full Screen on macOS), Window (macOS), Help (Documentation, Web Limitations, About with the version and copyright). Windows and Linux now get a native menu bar too (File / View / Help, without Edit so the webview keeps its editing keys). App commands are emitted as `pigeon:menu` events; `@pigeon/platform-desktop`'s `onMenuCommand` forwards them to the UI as `pigeon:command` DOM events (`runAppCommand`, `ui/src/app/commands.ts`), which AppShell handles (the sidebar can now be hidden; the main area listens for `pigeon:toggle-dock`). Custom items carry no accelerators so they never steal the UI's own shortcuts; zoom (`CmdOrCtrl+= / - / 0`) is handled in Rust with `set_zoom`, Documentation opens the repository README with the OS opener (fixed URL).
- **Window state** (`src-tauri/src/window_state.rs`, no new crate): size (logical), position (physical) and maximized state saved on close to `<app-data>/window-state.json`, restored at start; positions off every monitor are ignored; a maximized window keeps its previous normal bounds.
- **Docs**: `docs/release-checklist.md` (cutting a release, signing secrets, opening unsigned builds on macOS/Windows, AppImage FUSE 2, checksums, an 11-item manual checklist per OS), platform.md §5.2–5.4.1.
- **Verified here (macOS)**: `tauri build` produces `Pigeon.app` and `Pigeon_0.1.0_aarch64.dmg` with version 0.1.0, copyright and category in Info.plist; `--smoke` passes from the mounted DMG (including the PIGN-040 project flow); cargo 86 tests (menu zoom/labels, window state round trip and off-screen positions); a UI test drives every menu command. **Not verified**: the release workflow itself (needs a pushed tag — not done without your go-ahead), Windows/Linux artifacts, signing, the universal build, and the manual per-OS checklist (offline use, menus, window restore).
