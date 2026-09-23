# PIGN-010 — Response viewer

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-010 | 1 — First request | MVP | Todo | PIGN-006 |

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
- [ ] `/json/nested` renders pretty with folding; search highlights matches.
- [ ] `/unicode` renders correctly in all views.
- [ ] HTML preview never executes scripts (test page with `<script>` sets a global; it stays unset).
- [ ] `/large/5` (5 MB JSON) renders in Raw < 1 s and Pretty (after "Format anyway") < 2 s on a dev machine; UI stays responsive.
- [ ] Save body writes the exact bytes on desktop and downloads on web.

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
