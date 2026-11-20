# Pigeon — Release checklist

How a desktop release is made (PIGN-041) and what to check by hand on each OS before publishing
the draft.

## 1. Cut the release

1. Set the version once, in the root `package.json` (`"version": "0.2.0"`), then run
   `pnpm version:sync`. It copies the version to the workspace packages, the Rust crate
   (`apps/desktop/src-tauri/Cargo.toml`) and `PIGEON_VERSION` (the `User-Agent`); Tauri reads the
   root `package.json` directly. `packages/core/test/version.test.ts` fails when they drift.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. `.github/workflows/release.yml` builds macOS (universal `.dmg`), Windows (NSIS `-setup.exe`
   and `.msi`) and Linux (`.AppImage`, `.deb`), runs the `--smoke` check on the **installed**
   artifacts (the mounted DMG, the silently installed NSIS build, the AppImage and the installed
   `.deb`), and attaches everything plus `SHA256SUMS` to a **draft** GitHub release.
4. Work through §3 on each OS with the draft's artifacts, then publish the draft.

`workflow_dispatch` runs the same builds without creating a release (artifacts only).

## 2. Signing (D-11)

Signing is optional: without the secrets the workflow builds unsigned installers and says so in
a warning.

| OS | Secrets | Effect |
|---|---|---|
| macOS | `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` | Signed app and DMG (hardened runtime) |
| macOS | + `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID` | Notarized and stapled |
| Windows | `WINDOWS_CERTIFICATE` (base64 `.pfx`), `WINDOWS_CERTIFICATE_PASSWORD` | Authenticode-signed `.exe`/`.msi` (SHA-256, DigiCert timestamp) |

The app identifier is `dev.pigeon.desktop` (still to be confirmed under D-11: changing it later
moves the app-data folder). Auto-update is not part of this release (D-11).

### Opening unsigned builds

- **macOS**: Gatekeeper says the app "can't be opened" or "is damaged". Right-click
  `Pigeon.app` → **Open** → **Open** once, or run
  `xattr -dr com.apple.quarantine /Applications/Pigeon.app`.
- **Windows**: SmartScreen shows "Windows protected your PC". Click **More info** → **Run
  anyway**. The installer installs for the current user (no admin prompt); WebView2 is
  downloaded by the installer if missing (Windows 10 before 2021 builds).
- **Linux**: `chmod +x Pigeon_*.AppImage` and run it. Some distributions need FUSE 2
  (`sudo apt install libfuse2` on Ubuntu 22.04+, `libfuse2t64` on 24.04); otherwise run it with
  `--appimage-extract-and-run`. The `.deb` installs with `sudo apt install ./Pigeon_*.deb`.

Verify downloads: `sha256sum -c SHA256SUMS --ignore-missing` (`shasum -a 256 -c` on macOS).

## 3. Manual checks (per OS)

Run each item on macOS, Windows and Linux with the draft's artifacts. **Disconnect from the
network** for items 3–8: Pigeon must work fully offline.

| # | Check | macOS | Windows | Linux |
|---|---|---|---|---|
| 1 | Install from the artifact (DMG drag, NSIS, AppImage / `.deb`); the app icon and name show | ☐ | ☐ | ☐ |
| 2 | First launch: the Welcome panel shows; Help → About shows the release version | ☐ | ☐ | ☐ |
| 3 | File → Open Project… asks for a folder; opening one works; reopening it from Recent needs no prompt | ☐ | ☐ | ☐ |
| 4 | Send a request to `localhost` (e.g. `pnpm --filter @pigeon/test-server start`, `http://127.0.0.1:4010/json/user`): 200, Native transport badge | ☐ | ☐ | ☐ |
| 5 | Edit a request, Save for Commit (`Cmd/Ctrl+Shift+S`): the file changes; `git diff` shows only that change | ☐ | ☐ | ☐ |
| 6 | Change a request file in another editor: Pigeon reloads it | ☐ | ☐ | ☐ |
| 7 | Shortcuts: `Cmd/Ctrl+Enter`, `Cmd/Ctrl+S`, `Cmd/Ctrl+N`, `Cmd/Ctrl+W`, copy/paste in inputs, View → Zoom In/Out/Actual Size | ☐ | ☐ | ☐ |
| 8 | Menus: File (New Request, Open Project, Import, Export Project, Close Project), View (Toggle Sidebar, Toggle Response Layout), Help (Documentation, Web Limitations, About) | ☐ | ☐ | ☐ |
| 9 | Dark mode follows the OS and the theme toggle | ☐ | ☐ | ☐ |
| 10 | Window size and position are restored after a restart (and maximized stays maximized) | ☐ | ☐ | ☐ |
| 11 | Uninstall (drag to Trash / Apps & features / `apt remove pigeon` or delete the AppImage) removes the app; the project folders are untouched | ☐ | ☐ | ☐ |

Record the results (OS version, artifact, date, who) in the release notes or the story's
implementation notes.

## 4. Where things live

- App data: macOS `~/Library/Application Support/dev.pigeon.desktop/`, Windows
  `%APPDATA%\dev.pigeon.desktop\`, Linux `~/.local/share/dev.pigeon.desktop/` (`app.json`,
  `window-state.json`, `project-roots.json`, per-project state and secrets). Uninstalling keeps it;
  delete it by hand for a clean start.
- Logs: stderr when started from a terminal.
