# PIGN-003 — Desktop shell (Tauri) on macOS/Windows/Linux

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-003 | 0 — Foundation | MVP | In review (CI pending) | PIGN-002 |

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
- [x] `pnpm --filter @pigeon/desktop dev` opens a window showing the same shell as the web app. *(Verified on macOS with `pnpm tauri dev -- -- --smoke`.)*
- [ ] CI builds unsigned artifacts on macOS, Windows, Linux. *(Built `.app` + `.dmg` locally on macOS arm64; CI `desktop-build` pending.)*
- [ ] The smoke run succeeds on all three CI runners. *(Passes locally on macOS; failure paths checked too: a thrown error, a missing font and a CSP-blocked `fetch` each exit 1 with the reason.)*
- [ ] Copy/paste/select-all work in a text input on macOS (menu wired). *(Menu wired; needs a manual check, since the shell has no text input yet. Try it in DevTools or with PIGN-006's URL bar.)*
- [x] No network access required to run the built app (fonts/assets bundled). *(The smoke run loads the bundled font, and the CSP blocks any remote `connect-src`.)*

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

## Implementation notes

- **D-01 → Accepted** (Tauri 2). Versions: `tauri` 2.12, `tauri-build` 2.7, `@tauri-apps/cli` 2.12.
- **Frontend** (`apps/desktop`): `index.html`, `src/main.tsx` and `tsconfig*.json` mirror `apps/web`. The Vite dev server runs on port 1420 (`strictPort`) and ignores `src-tauri/`. Fonts are never inlined, which keeps them same-origin under the CSP. `dev:web`/`build:web` are the Tauri `beforeDevCommand`/`beforeBuildCommand`; `dev`/`build` run `tauri dev`/`tauri build`. ESLint lets `apps/desktop` import `@pigeon/ui`, `platform` and `platform-desktop`; Tauri APIs are allowed and Node built-ins are not.
- **Root `pnpm build` skips `@pigeon/desktop`**, so `pnpm verify` doesn't need Rust. `tsc -b` still typechecks the desktop frontend, and CI's `desktop-build` job builds it.
- **Identifier `dev.pigeon.desktop`** (placeholder, D-11 still open). We chose it over `dev.pigeon.app` because Tauri warns that a `.app` suffix clashes with the macOS bundle extension.
- **Window**: `main`, 1280×800, min 900×600, centred, no state persistence.
- **Capabilities**: `capabilities/default.json` grants only `core:default` to the `main` window.
- **CSP** (`tauri.conf.json`): `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'` (Tauri adds hashes for its own scripts); `connect-src ipc: http://ipc.localhost` only, because the webview never makes network requests itself (native HTTP arrives in PIGN-007); `object-src`/`base-uri`/`form-action 'none'`. `devCsp` is the same plus `ws://localhost:1420` for Vite HMR. `cargo test` guards that both stay strict.
- **macOS menu** (`src/menu.rs`): Pigeon (About, Services, Hide/Hide Others/Show All, Quit), Edit (Undo, Redo, Cut, Copy, Paste, Select All), View (Full Screen) and Window (Minimize, Zoom, Close; registered as the system Window menu). Windows and Linux get no native menu (platform.md §5).
- **`--smoke`** (`src/smoke.rs` + `src/smoke.js`): an inline plugin injects a probe as an initialization script. The probe records `error`/`unhandledrejection`/CSP violations/`console.error`, waits for `[data-testid="app-shell"]`, checks that the bundled JetBrains Mono loads, then calls the `smoke_report` command. That prints `smoke-ok` and exits 0. Any error exits 1, and a 60s watchdog exits 1 if nothing reports. Because the smoke check loads the bundled font, it also covers the offline-assets criterion.
- **Icons**: placeholder (Lucide bird on the accent colour) generated with `pnpm tauri icon app-icon.svg -o src-tauri/icons`, desktop sizes only. Final artwork comes with PIGN-041.
- **CI** `desktop-build` (macOS, Windows, Ubuntu 22.04): installs WebKitGTK 4.1 deps + xvfb on Linux, runs `cargo test --locked`, `tauri build` (unsigned, all default bundle targets), then the smoke launch of `target/release/pigeon` (`xvfb-run` on Linux), and uploads `dmg`/`nsis`/`msi`/`deb`/`rpm`/`AppImage` as `pigeon-desktop-<OS>`.
- **Gotcha**: a plain `cargo build --release` leaves out Tauri's `custom-protocol` feature, so the binary loads `devUrl` (the Vite server) and `--smoke` times out. Always build through the CLI (`pnpm --filter @pigeon/desktop build`, or `pnpm tauri build --no-bundle` for a quick binary). `cargo test` is unaffected.
