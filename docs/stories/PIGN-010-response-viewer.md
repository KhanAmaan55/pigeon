# PIGN-010 — Response viewer

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-010 | 1 — First request | MVP | Done | PIGN-006 |

## Goal
A polished response panel: pretty/raw/preview body, headers table, search, copy/save, large-body handling.

## User story
As a developer, I want to read responses comfortably — formatted JSON, headers, search — so I can debug APIs fast.

## Context
- UI: [ui-ux.md §3.5](../ui-ux.md#35-response-viewer), performance budgets [ui-ux.md §7](../ui-ux.md#7-performance-budgets-tested-in-pign-042).
- `NormalizedResponse`: [api-execution.md §2](../api-execution.md#2-types).

## Scope
**In scope**
- Status line: coloured status (2xx green, 3xx blue, 4xx amber, 5xx red), time, size (tooltip: decoded size; on web "decoded by browser"), transport badge.
- **Body** tab: *Pretty* (JSON/XML/HTML formatted, folding, read-only CodeMirror, search `Cmd/Ctrl+F`), *Raw*, *Preview* (HTML in sandboxed `iframe` with `sandbox=""` and no scripts; images via blob URL). Auto-select mode from content type.
- Large bodies: > 2 MB open in Raw with "Format anyway"; > 20 MB show first 2 MB with "Show all" (desktop) / "Save to file".
- Binary bodies: hex/size summary + Save.
- **Headers** tab: table (name, value), copy row; notice "Some headers are hidden by the browser" when `headersRestricted`.
- Actions: copy body, save body to file (`platform.files.saveFile`), copy as JSON path on click (nice-to-have; optional).
- Response panel dock bottom/right toggle (`Cmd/Ctrl+Alt+L`), in memory for now.
- `platform-desktop` `FileExchange.saveFile` via dialog plugin + fs write; `platform-web` via `showSaveFilePicker` or download.

**Out of scope**
- Timeline tab (PIGN-011), comparison tab (PIGN-034), examples tab (PIGN-027), cookies (PIGN-045).

## Acceptance criteria
- [x] `/json/nested` renders pretty with folding; search highlights matches.
- [x] `/unicode` renders correctly in all views.
- [x] HTML preview never executes scripts (test page with `<script>` sets a global; it stays unset).
- [x] `/large/5` (5 MB JSON) renders in Raw < 1 s and Pretty (after "Format anyway") < 2 s on a dev machine; UI stays responsive. Asserted in Playwright in all three browsers (timings measured from the status line appearing; recorded as a test annotation).
- [x] Save body writes the exact bytes on desktop and downloads on web. Web: Playwright compares the download with the server's bytes. Desktop: `cargo test` covers the frame and the atomic write, Vitest the TS frame; the native dialog itself was not driven.

## Technical notes
- Formatting of big JSON off the main thread (Worker) to keep input responsive.
- Don't parse JSON twice: reuse `NormalizedResponse.json` when available.

## Files / components likely affected
`packages/ui/src/features/response-viewer/*`, `packages/ui/src/components/CodeEditor/*`, `packages/platform-desktop/src/files.ts`, `packages/platform-web/src/files.ts`.

## Tests required
- Component tests: mode auto-selection, large-body thresholds.
- Playwright: pretty JSON, headers tab, HTML preview script isolation.

## Definition of done
Standard DoD.

## Implementation notes
- **Views** (`ui/src/features/response-viewer/`): `body-view.ts` decides views, the default view and the thresholds (2 MB → Raw + "Format anyway", 20 MB → first 2 MB + "Show all"/"Save to file"), plus `suggestFileName` and `hexDump`. `BodyView.tsx` renders Pretty/Raw (read-only `CodeEditor`, which gained `folding`, `search` and `wrap` options) and Preview; `HeadersTable.tsx`, `CopyButton.tsx`; `ResponseViewer.tsx` holds the Body/Headers tabs, Copy, Save and the dock toggle.
- **Formatting**: `formatters.ts` (pure: token-based JSON re-indent from `lib/json-format.ts`, now slice-based for speed; XML/HTML one element per line, malformed XML left as is), `formatting.ts` runs it in `format.worker.ts` above 256 KB and inline otherwise or when Workers are unavailable. "Don't parse twice": `NormalizedResponse.json` only tells the formatter the text is valid; formatting never goes through `JSON.stringify`, which would change numbers such as `9007199254740993`.
- **"Show all"** is offered where `capabilities.transport !== 'fetch'` (desktop); a browser tab gets Save only.
- **Save**: `WebFileExchange` (picker or download) and `DesktopFileExchange` → Rust `save_file` (dialog plugin + atomic write, new `allow-save-file` permission; no dialog/fs permissions for the webview). Both replace the memory `files` service in their platform.
- **Dock**: `MainArea` switches the panel group's orientation in place (not remounted, so the response keeps its tab and view); `Cmd/Ctrl+Alt+L` matched on `event.code`, since Alt changes `key` on macOS.
- **Bundles**: the body view and CodeMirror are lazy chunks; the main web chunk is 497 kB, just under Vite's 500 kB warning, so the next feature will likely need a vendor chunk split.
- **Test server**: new `/html` (script that would mark itself as run), `/xml`, `/image/png`.
- **Tests**: `ui/test/body-view.test.ts` (views, thresholds, file names, hex, formatters), `ui/test/response-viewer.test.tsx` (auto-selection, large/huge bodies, preview sandbox, image blob, binary save, copy, headers, size tooltip, dock), web and desktop `files` tests, `files.rs` tests, `e2e/web/response-viewer.spec.ts` (folding + search, unicode, script isolation, image, XML, headers notice, 5 MB timings, download bytes, dock). E2E helpers now read `/echo` from the network (`e2e/web/echo.ts`): CodeMirror keeps only on-screen lines in the DOM.
- **Out / known limits**: copy as JSON path (optional) not done. The HTML preview can't load remote images/styles (sandbox + CSP). Layout choice is not persisted. The desktop Save dialog has not been exercised in the running app.
