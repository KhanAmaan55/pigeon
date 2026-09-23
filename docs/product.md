# Pigeon — Product Requirements

## 1. Summary

Pigeon is a lightweight, local-first API client for developers. It covers the day-to-day core of Postman — collections, requests, environments, response examples — and adds a first-class **API regression / schema comparison** workflow: every response can be compared against a saved example (baseline), and structural changes are reported as failures or warnings.

Pigeon has no accounts and no cloud. A Pigeon project is a folder of human-readable, deterministic, Postman-shaped JSON files that users version with their own Git tooling.

Pigeon runs as a desktop app (macOS, Windows, Linux) and as a static web app. Both share one core.

## 2. Target users

- Backend / API developers who build and debug HTTP and GraphQL APIs.
- Developers who want API collections versioned next to the code, reviewed in PRs.
- Developers/QA who want quick "did the response shape change?" checks without writing test scripts.
- Teams leaving Postman because of sign-in, cloud sync or pricing, who need to bring their collections and environments with them.

## 3. Goals

| # | Goal |
|---|------|
| G1 | Import and export Postman Collection v2.1 (and import v2.0) with high fidelity; unknown fields survive a round trip. |
| G2 | Send HTTP/REST and GraphQL requests with params, headers, bodies, auth, variables. |
| G3 | Manage environments in a Postman-compatible structure; import Postman environments/globals, and Apidog / Echo API environments where practical. |
| G4 | Local-first: no sign-in, no cloud account, data stays on the user's machine. Desktop works fully offline. |
| G5 | Git-friendly project folder: deterministic serialization, small diffs, explicit **Save for Commit**. |
| G6 | Save response examples like Postman and use them as baselines. |
| G7 | Compare a new response to a baseline: status, headers, body structure/types; added/removed/changed fields. |
| G8 | Field rules (optional / ignored / nullable / dynamic) turn expected changes into warnings or no-ops instead of failures. |
| G9 | Multiple projects open at once, each fully isolated. |
| G10 | Fast, polished, keyboard-friendly developer UI. |
| G11 | Same product on desktop and web, sharing core logic, with browser limitations explicitly handled. |

## 4. Non-goals

- Cloud sync, accounts, team workspaces, sharing links, or any Pigeon-hosted backend.
- Implementing Git (commit/push/pull/branches) inside Pigeon — users use their own Git client. (Read-only Git awareness is future scope.)
- Mock servers, monitors, API publishing/documentation portals, API design (OpenAPI editor).
- 100% Postman script (`pm.*`) compatibility. A documented subset is planned post-MVP.
- Re-implementing every Postman auth type in the MVP.
- A plugin marketplace.

## 5. Core workflows

### W1 — Start
1. Launch Pigeon → Welcome screen: **Create project**, **Open project folder**, **Import Postman collection**, recent projects.
2. Creating a project creates the folder structure (`pigeon.json`, `collections/`, `environments/`, `examples/`).
3. On web without the File System Access API, the project lives in a *browser workspace* (IndexedDB) and can be exported/imported as a `.zip`.

### W2 — Build and send a request
1. Create a collection → folder → request.
2. Edit method, URL, params, headers, body, auth; use `{{variables}}`.
3. Pick an environment, press **Send** (`Cmd/Ctrl+Enter`).
4. Inspect status, time, size, headers, pretty/raw body.

### W3 — Save vs Save for Commit
1. **Save** (`Cmd/Ctrl+S`) stores the change in Pigeon's local state. Project files are untouched; the explorer marks the item as *modified (local)*.
2. **Save for Commit** (`Cmd/Ctrl+Shift+S`, or the *Pending Changes* panel) writes the changes into project files deterministically.
3. The user reviews `git diff`, stages and commits with their own tools.

### W4 — Examples and regression
1. After a response arrives, **Save as example** (name defaults to `"<code> <status text>"`).
2. Later, sending the request auto-compares the new response against the baseline example.
3. Comparison tab shows **Pass / Warn / Fail** and a list of findings (field added, field removed, type changed, status changed, header changed).
4. From a finding: **Mark optional**, **Ignore**, **Allow null**, **Mark dynamic**, or **Accept as new baseline**.
5. Rules and updated baselines are committed via Save for Commit.
6. **Run folder/collection** executes many requests and produces a regression report.

### W5 — Import / export
1. Import a Postman collection or environment file (drag & drop or file picker); preview what will be created; confirm.
2. Export a collection as a single Postman v2.1 file; export environments as Postman environment files.

### W6 — Git collaboration
1. Teammate pulls changes → Pigeon detects changed files (desktop watcher / web refresh) → reloads.
2. If the user had local drafts on a changed entity → conflict banner with *Keep mine / Take theirs / Compare*.

### W7 — Multiple projects
1. Open a second project → new project tab.
2. Each project has its own environments, selected environment, drafts, tabs, variable current values, cookies and history. Nothing leaks between projects.

## 6. Scope tiers

### MVP (stories PIGN-001 → PIGN-042)
- Desktop app for macOS, Windows, Linux (unsigned builds acceptable; signing hooks prepared) and a deployable static web app.
- Projects: create/open folder (desktop), File System Access folder or browser workspace (web), multiple isolated projects.
- Collections/folders/requests CRUD, reorder, move.
- HTTP requests: any method, URL, query/path params, headers, bodies (none, raw JSON/text/XML/HTML, urlencoded, form-data incl. files, binary file), timeouts, redirects, cancel.
- GraphQL over HTTP: query, variables, operation name.
- Auth: inherit, none, Basic, Bearer, API key — at collection, folder, and request level.
- Variables: environment, collection, project globals; `{{var}}` resolution with highlighting; core dynamic variables (`$guid`, `$timestamp`, `$isoTimestamp`, `$randomInt`, `$randomUUID`).
- Secret variables: masked, never written to project files.
- Save (local state) and Save for Commit (project files) with pending-changes review and conflict detection.
- Postman: import collection v2.0/v2.1, export v2.1, import/export environments and globals; scripts preserved and editable (not executed).
- Response examples: save, view, edit, delete; exported to Postman as `response[]`.
- Comparison: schema/structure diff, status, headers, value mode, field rules, accept baseline, collection/folder regression run with report.
- Web: CORS-aware error UX, capability-gated features.
- Keyboard shortcuts, command palette, performance budget.

### Later (stories PIGN-043 → PIGN-057)
- Script execution sandbox (pre-request and test scripts, `pm.*` subset) and test results.
- Cookie jar and cookie manager (desktop full; web limited).
- More auth: Digest, AWS SigV4, OAuth 2.0.
- Apidog and Echo API environment importers (fixture-driven).
- cURL import, code snippet generation.
- Local request history.
- Optional self-hostable CORS proxy for the web version.
- OS keychain storage for secrets (desktop).
- CLI runner for CI regression runs.
- GraphQL introspection / autocomplete.
- JSON Schema export of baseline snapshots.
- Read-only Git status awareness.

### Future scope (not planned as stories yet)
- WebSocket, Server-Sent Events, gRPC, Socket.IO, MQTT.
- OpenAPI import/export, contract testing against OpenAPI.
- Postman's newer file-based collection format (reported for Postman's Git integration — unconfirmed; evaluate when stable).
- Collection runner data files (CSV/JSON iterations).
- Desktop app acting as a local agent for the web version.
- Offline-capable web (PWA).
- Plugin API.

### Out of scope
- Accounts, sign-in, telemetry by default, cloud storage, hosted sharing.
- In-app Git commit/push/pull.
- Mock servers, monitors, API docs hosting.

## 7. Success criteria for MVP

- A real-world Postman v2.1 collection (≥ 200 requests, nested folders, examples, scripts, mixed auth) imports, edits, saves for commit, and exports with no loss of unknown fields and no semantic diff beyond documented normalizations.
- Saving for commit twice without changes produces **zero** file changes (determinism).
- Changing one header on one request produces a one-file, few-line Git diff.
- A response schema change (field removed, type changed) is detected and correctly classified as fail/warn per rules.
- Same UI and core run on desktop (all three OSes) and web; the web shows clear, accurate messages for CORS and filesystem limitations.
- Cold start < 1.5 s on desktop (release build, mid-range laptop); a 5,000-request project opens in < 2 s.

## 8. Principles

1. **Files are the source of truth for shared data; local state is the source of truth for personal data.**
2. **Postman shapes by default.** Invent Pigeon-only structure only where Postman has no equivalent (comparison rules, ordering), and namespace it (`_pigeon`).
3. **Shared core, thin adapters.** Anything that is not platform I/O lives in shared TypeScript.
4. **Capabilities, not platform checks.** The UI asks "can this platform bypass CORS?", not "is this desktop?".
5. **Never silently lose data.** Unknown fields are preserved; unparseable files are never overwritten; conflicts are surfaced.
6. **Small, reviewable diffs.** Deterministic output, one entity per file, no volatile fields.
