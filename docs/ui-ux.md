# Pigeon — UI / UX

Implementation: `packages/ui`. Stack: React, Zustand, CodeMirror 6, Tailwind, Radix, cmdk (see [architecture.md §8](architecture.md#8-ui--state-management)).

## 1. Principles

- **Fast**: first paint < 300 ms after shell load; no spinners for local operations; virtualized trees/lists; big bodies in CodeMirror (not DOM trees).
- **Keyboard-first**: every primary action has a shortcut and appears in the command palette.
- **Dense but calm**: developer-tool density (13 px UI font, 12–13 px monospace), neutral palette, one accent color, clear status colors (pass green, warn amber, fail red, info blue). Light and dark themes (follow OS by default).
- **Honest about state**: unsaved / saved-locally / committed / conflict states always visible; platform limitations shown in context, not hidden.
- **Same UI everywhere**: desktop and web share every screen; capability-gated controls are disabled with an explanatory tooltip rather than removed, unless meaningless on the platform.

## 2. Layout

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│ [Users API ×] [Billing ×] [+]                 Env: [Local ▾]   ⟳   Pending (3) │ ← project tabs / top bar
├───┬──────────────────────┬─────────────────────────────────────────────────────┤
│ ☰ │ COLLECTIONS   [+][⋯] │ [GET List users ●] [POST Create user] [+]            │ ← request tabs
│ ⎇ │ ▾ Users API          │ ┌─────────────────────────────────────────────────┐ │
│ ⚙ │   GET  List users  M │ │ [GET ▾] {{baseUrl}}/users?limit=20      [Send ▸]│ │
│ ▶ │   ▾ Admin            │ │ Params | Auth | Headers(2) | Body | Scripts | ⚙  │ │
│   │     DEL Delete user  │ │ …editor…                                        │ │
│   │ ▸ Billing            │ ├─────────────────────────────────────────────────┤ │
│   │                      │ │ 200 OK · 123 ms · 4.2 KB · ✓ Matches baseline   │ │
│   │ EXAMPLES (List users)│ │ Body | Headers(12) | Compare | Examples | Tests  │ │
│   │   200 OK  ★ baseline │ │ …response…                                      │ │
│   │   404 Not Found      │ └─────────────────────────────────────────────────┘ │
├───┴──────────────────────┴─────────────────────────────────────────────────────┤
│ ● Native transport · Watching files · 3 pending changes · macOS                │ ← status bar
└────────────────────────────────────────────────────────────────────────────────┘
```
Activity bar (left icons): Collections, Environments, Pending Changes, Runner, Settings. Response panel can dock bottom or right (toggle, remembered per project).

## 3. Screens and workflows

### 3.1 Welcome / project switching
- Welcome (no project open): **Create project**, **Open folder** (desktop / Chromium), **New browser workspace** (web), **Import Postman file**, **Import project zip** (web), recent projects list with location and last opened; web entries needing permission show **Reconnect**.
- Project tabs (top): one per open project; `Cmd/Ctrl+Alt+←/→` to switch; closing a project with unsaved edits prompts. Each tab is a fully isolated project store.
- Project menu (`⋯` on the project tab): Reveal in Finder/Explorer (desktop), Refresh from disk, Export project zip (web workspace), Project settings (name, comparison defaults), Close.

### 3.2 Collection explorer
- Virtualized tree: collections → folders → requests; method badge (colour per method), name, state badge (`M`, `A`, `D`, `!` conflict, ⚠ broken file).
- Actions (context menu + keyboard): New request (`Cmd/Ctrl+N`), New folder, Rename (`F2`/`Enter`), Duplicate (`Cmd/Ctrl+D`), Delete (`Del`/`Cmd+Backspace`, confirm), Move (drag & drop, with drop indicators), Copy as cURL (later), Run folder, Export collection.
- Filter box (`Cmd/Ctrl+F` in explorer): fuzzy filter on name + URL.
- Single click = preview tab (italic, replaced by next preview); double click or edit = pinned tab.

### 3.3 Request editor
- URL bar: method dropdown (common methods + custom text), URL input with `{{var}}` highlighting (resolved = green, unresolved = red, secret = masked chip), hover tooltip shows value and scope; `Send` (`Cmd/Ctrl+Enter`), `Cancel` while in flight.
- Tabs: **Params** (query table synced bidirectionally with URL; path variables table when `:name` present), **Auth** (type selector incl. Inherit; shows the effective inherited auth source), **Headers** (key/value table with enable toggles, bulk edit mode, auto-generated headers shown read-only and greyed, forbidden-header warning on web), **Body** (mode selector; CodeMirror for raw with language; tables for urlencoded/form-data with file pickers; GraphQL: query + variables editors side by side), **Scripts** (pre-request and test editors; MVP banner "Scripts are saved but not executed yet"), **Settings** (timeout, follow redirects, max redirects, TLS verification — disabled with tooltip where unsupported).
- Key/value tables: `Tab` navigation, auto-append empty row, paste of `key: value` lines, drag to reorder.

### 3.4 Environment editor
- Environment selector in the top bar (`Cmd/Ctrl+E` opens quick switcher), "No environment" option.
- Environments view: list of environments + Globals + (per collection) Collection variables.
- Variable table columns: Enabled, Key, **Shared value** (committed), **Current value** (local only), Type (default/secret), Description. Clear column header tooltips explain which goes to Git.
- Secret rows mask values with reveal-on-hold; "Reset current values" and "Persist current as shared" actions (the latter warns for secrets).

### 3.5 Response viewer
- Summary line: status (coloured), time, size, transport badge (Native/Browser), comparison badge (✓ Pass / ⚠ Warn / ✗ Fail / — No baseline).
- **Body**: Pretty (formatted JSON/XML/HTML with folding, search `Cmd/Ctrl+F`), Raw, Preview (HTML in sandboxed iframe with scripts disabled; images). Large bodies (> 2 MB) open in Raw with "Format anyway" button. Copy, Save to file, Save as example.
- **Headers**: table; web notice when headers are restricted.
- **Compare**: see 3.7.
- **Examples**: list for this request; open, set baseline, delete.
- **Timeline** (desktop): resolved request (method, URL, headers — secrets masked), redirect hops, timings.
- Errors: dedicated error card with `kind`, message, and hint (e.g. CORS explainer with links to docs section, "Open in desktop app" suggestion).

### 3.6 Saved examples
- Examples appear nested under their request in the explorer (collapsible) and in the response **Examples** tab.
- Example view: read-only by default with **Edit** toggle; editable name, status code/text, headers, body (CodeMirror); `originalRequest` shown collapsed.
- `★` marks the current baseline (auto or pinned). "Set as baseline" / "Use auto baseline".

### 3.7 Comparison / diff view
- Header: outcome, counts per severity, baseline name (switchable), config summary (mode, additional fields policy) with "Edit rules".
- **Findings list** (default): grouped by section (Status, Headers, Body), sorted by severity; each row: icon, path (`schemaPath` with count), message, baseline → actual types/values; row actions: **Mark optional**, **Allow null**, **Ignore**, **Mark dynamic**, **Show in body**.
- **Side-by-side view**: baseline JSON vs actual JSON with gutter markers (+ added, − removed, ~ type changed) and synchronized scrolling; clicking a finding scrolls both sides.
- Footer actions: **Accept as new baseline**, **Save as new example**, filter (show ignored).
- **Rules panel**: table of rules (path, flags, note) from request + inherited project defaults (read-only here, edit in project settings); add/remove/edit; path validation inline.

### 3.8 Save vs Save for Commit
- `Cmd/Ctrl+S` Save (local); `Cmd/Ctrl+Shift+S` Save for Commit (current entity); toolbar split button `[Save ▾]` → Save / Save for Commit / Save all / Save all for commit.
- **Pending Changes** panel: list of drafts (grouped: Collections, Environments, Examples & rules) with A/M/D/R badges; select items → shows the **file plan** (paths to write/delete/rename) and a per-file unified diff (CodeMirror merge view) → **Save selected for commit**; **Discard** per item. Empty state: "Everything is written to files. Use Git to commit."
- After Save for Commit, toast: "Wrote 3 files" with "Reveal" (desktop) and "Copy paths".
- Conflict banner in editor: "This request changed on disk" → Keep mine / Take theirs / Compare.

### 3.9 Import / export
- Import (`Cmd/Ctrl+O` or drag & drop anywhere): detects format → preview dialog: detected format + version, target (new collection / merge into existing — MVP: new only), counts (folders, requests, examples, environments), warnings (unsupported auth, scripts not executed, absolute file paths), id regenerations; options (use imported values as current values for envs); buttons **Import & write files** (default) / **Import as local drafts**.
- Export: from collection/environment context menu → options (include examples, include Pigeon metadata) → save dialog / download.
- Web browser-workspace: **Export project (.zip)** and **Import project (.zip)** in project menu and welcome screen.

### 3.10 Runner (PIGN-038)
- Run dialog: scope, environment, stop on first failure, only requests with baselines.
- Live list with per-request status, time, outcome; click opens the comparison.
- Summary with totals; **Accept selected as baselines**; export report JSON.

## 4. Keyboard shortcuts (defaults)

| Action | macOS | Windows / Linux |
|---|---|---|
| Send / Cancel | `Cmd+Enter` | `Ctrl+Enter` |
| Save | `Cmd+S` | `Ctrl+S` |
| Save for Commit | `Cmd+Shift+S` | `Ctrl+Shift+S` |
| Command palette | `Cmd+K` / `Cmd+Shift+P` | `Ctrl+K` / `Ctrl+Shift+P` |
| Quick open request | `Cmd+P` | `Ctrl+P` |
| New request | `Cmd+N` | `Ctrl+N` |
| Close tab | `Cmd+W` | `Ctrl+W` |
| Next/prev tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` | same |
| Switch environment | `Cmd+E` | `Ctrl+E` |
| Focus URL | `Cmd+L` | `Ctrl+L` |
| Import | `Cmd+O` | `Ctrl+O` |
| Toggle response layout | `Cmd+Alt+L` | `Ctrl+Alt+L` |

On web, shortcuts the browser reserves (`Cmd/Ctrl+W`, `Cmd/Ctrl+N`, `Ctrl+Tab`) cannot be overridden; the palette and alternative bindings (`Alt+W`, `Alt+N`) cover them. Shortcut registry lives in `ui/src/features/command-palette/commands.ts` with per-platform bindings.

## 5. States and feedback

- Loading project: skeleton tree; files load incrementally.
- Broken file: explorer item with ⚠, click shows parse error with file path and "Reveal file" (desktop).
- Newer-format project: read-only banner.
- Web capability notices: status bar item "Browser mode — CORS applies (learn more)".
- Toasts for background results only; errors that need action are inline.

## 6. Accessibility

- All interactive elements reachable by keyboard; visible focus rings; Radix primitives for menus/dialogs (ARIA).
- Colour is never the only signal (icons + text for pass/warn/fail and method badges).
- Respect `prefers-reduced-motion` and OS font scaling (UI font size preference 12–16 px).

## 7. Performance budgets (tested in PIGN-042)

| Metric | Budget |
|---|---|
| Desktop cold start to interactive | < 1.5 s |
| Open project with 5,000 requests | < 2 s to tree interactive |
| Explorer scroll | 60 fps |
| Keystroke to render in editors | < 16 ms |
| Render 5 MB JSON response (raw) | < 1 s; pretty < 2 s |
| Tab switch | < 50 ms |
