# PIGN-003 — Desktop shell (Tauri) on macOS/Windows/Linux

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-003 | 0 — Foundation | MVP | Todo | PIGN-002 |

## Goal
A Tauri 2 desktop app (`apps/desktop`) that hosts the same `@pigeon/ui` bundle and builds on all three desktop OSes in CI.

## User story
As a developer on macOS, Windows, or Linux, I want to launch Pigeon as a native desktop app, so I can use it offline without a browser.

## Context
- D-01 (Tauri 2): [architecture.md §11](../architecture.md#11-technical-decisions). **Confirm D-01 before starting.**
- Per-OS notes: [platform.md §5](../platform.md#5-desktop-tauri-2).

## Scope
**In scope**
- `apps/desktop` with `src/main.tsx` rendering `<PigeonApp />`, Vite config, `src-tauri/` (Cargo project, `tauri.conf.json`, `capabilities/default.json` with minimal permissions).
- App identifier placeholder (e.g. `dev.pigeon.app`, D-11 open), product name "Pigeon", window 1280×800 min 900×600, remembers nothing yet.
- macOS native menu with standard App/Edit/View/Window items (so copy/paste/undo work in inputs).
- Strict CSP in `tauri.conf.json`.
- Scripts: `pnpm --filter @pigeon/desktop dev` and `build`.
- CI job `desktop-build` (matrix macOS/Windows/Ubuntu 22.04) running `tauri build` (unsigned) and uploading artifacts; Linux installs WebKitGTK 4.1 deps.
- `--smoke` CLI flag: app starts, renders, writes `smoke-ok` to stdout (or a temp file), exits 0 — used by CI on all OSes.

**Out of scope**
- Native HTTP (PIGN-007), filesystem (PIGN-014), packaging/signing (PIGN-041), auto-update.

## Acceptance criteria
- [ ] `pnpm --filter @pigeon/desktop dev` opens a window showing the same shell as the web app.
- [ ] CI builds unsigned artifacts on macOS, Windows, Linux.
- [ ] The smoke run succeeds on all three CI runners.
- [ ] Copy/paste/select-all work in a text input on macOS (menu wired).
- [ ] No network access required to run the built app (fonts/assets bundled).

## Technical notes
- Keep Rust minimal: `main.rs` with builder, plugins added in later stories.
- Tauri 2 `capabilities` should start empty except core defaults; each later story adds only the permissions it needs.
- Linux CI: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`. Smoke test on Linux needs `xvfb-run`.

## Files / components likely affected
`apps/desktop/**`, `.github/workflows/ci.yml`, `docs/platform.md` (only if deviations).

## Tests required
- CI smoke launch on 3 OSes.
- `cargo test` placeholder in `src-tauri` (so the Rust test job exists).

## Definition of done
Standard DoD plus: desktop artifacts downloadable from CI for all three OSes.
