# Pigeon — Documentation

## 1. What Pigeon is

Pigeon is a lightweight, **local-first** API client, and an alternative to Postman. It covers collections, requests (HTTP/REST and GraphQL), environments, and response examples. It also treats **API regression / schema comparison** as a first-class feature: each response can be compared against a saved example (baseline). Pigeon then reports added or removed fields, type changes, and status/header changes as failures or warnings. Field rules (optional, ignored, nullable, dynamic) decide which it is.

- No sign-in, no cloud account, no Pigeon backend.
- A project is a folder of deterministic, human-readable, **Postman-shaped JSON files** that you version with your own Git tooling.
- Postman Collection v2.1 import/export (v2.0 import), Postman environments/globals; Apidog and Echo API environments later, built from real sample files.
- Two save levels: **Save** (local app state only) and **Save for Commit** (write project files; you review the diff and commit yourself).

Details: [product.md](product.md).

## 2. Architecture overview

```text
apps/desktop (Tauri 2)        apps/web (static SPA)
        │                              │
        └──────────► packages/ui ◄─────┘          React + Zustand; one store per open project
                         │
     packages/core · formats · compare · platform  pure TypeScript, shared by every platform
                         │
      platform-desktop (Rust http, Tauri fs)   platform-web (fetch, File System Access, IndexedDB)
```

- **Shared core** has no DOM, Tauri, or Node imports. It holds the domain model, variable resolution, request preparation, the executor, ProjectSession (drafts, Save, Save for Commit, conflicts), the runner, Postman/project formats, and the comparison engine.
- **Thin adapters** implement one `Platform` interface: filesystem, transport, app state, secrets, dialogs, file exchange, and capabilities.
- The UI branches on **capabilities** (for example `bypassesCors`), never on "is desktop".

Details: [architecture.md](architecture.md). Technical decisions to confirm before coding are listed in [architecture.md §11](architecture.md#11-technical-decisions).

## 3. Supported platforms

| Platform | Shell | Transport | Project folders |
|---|---|---|---|
| macOS | Tauri 2 (WKWebView) | Native (Rust reqwest) | Native filesystem + watcher |
| Windows | Tauri 2 (WebView2) | Native | Native filesystem + watcher |
| Linux | Tauri 2 (WebKitGTK) | Native | Native filesystem + watcher |
| Web — Chromium | Static site | Browser `fetch` (CORS applies) | File System Access API folder, or browser workspace |
| Web — Firefox / Safari | Static site | Browser `fetch` (CORS applies) | Browser workspace (IndexedDB) + zip import/export |

Details: [platform.md](platform.md).

## 4. Desktop vs web capability differences

| | Desktop | Web |
|---|---|---|
| CORS | Not applicable | Enforced by the browser; clear error UX; optional self-hosted proxy later |
| Any request header (`Host`, `Cookie`, …) | ✅ | Forbidden headers dropped (warned) |
| All response headers / `Set-Cookie` | ✅ | Only CORS-exposed headers |
| Redirect control, TLS verification off, body on GET | ✅ | ❌ |
| Open a real folder | ✅ | Chromium only (permission re-prompt possible) |
| File watching | ✅ | Refresh on focus / manual |
| Git working tree | Save for Commit writes into it | Chromium folder only; otherwise export zip |
| Secrets | App-data file → OS keychain (later) | IndexedDB (unencrypted; warned) |
| Offline | Full | Needs the app loaded (PWA is future scope) |

Full matrix: [platform.md §4](platform.md#4-capability-matrix) and web limitations: [platform.md §6](platform.md#6-web).

## 5. Recommended reading order

1. [product.md](product.md): goals, non-goals, workflows, MVP vs later vs out of scope.
2. [architecture.md](architecture.md): components, repo layout, package boundaries, **decisions**.
3. [platform.md](platform.md): interfaces, capabilities, per-OS and web specifics.
4. [data-model.md](data-model.md): entities and relationships.
5. [file-format.md](file-format.md): on-disk project, determinism, Save vs Save for Commit, conflicts, local state.
6. [compatibility.md](compatibility.md): Postman mapping; Apidog/Echo API (with confirmed vs assumed labels).
7. [api-execution.md](api-execution.md): execution pipeline, transports, errors.
8. [response-comparison.md](response-comparison.md): baselines, schema diff, rules, runs.
9. [ui-ux.md](ui-ux.md): screens, workflows, shortcuts, budgets.
10. [testing.md](testing.md): test layers, fixtures, CI.
11. [stories/README.md](stories/README.md): story index and workflow.

A coding agent working on a single story needs this file, the story file, and the doc sections that story links to.

## 6. Story implementation order

Stories run from **PIGN-001** to **PIGN-057** in numeric order. Dependencies are listed in [stories/README.md](stories/README.md#story-index).

| Phase | Stories | Milestone |
|---|---|---|
| 0 Foundation | PIGN-001 – 005 | M0: web + desktop shells build on all OSes |
| 1 First request | PIGN-006 – 011 | M1: send requests on web and desktop |
| 2 Projects | PIGN-012 – 021 | M2: folders, Save, Save for Commit, conflicts, multiple projects |
| 3 Variables | PIGN-022 – 025 | environments, variables, secrets |
| 4 Auth | PIGN-026 | M3: auth with inheritance |
| 5 Examples & Postman | PIGN-027 – 031 | examples, Postman import/export, scripts preserved |
| 6 GraphQL | PIGN-032 | M4 |
| 7 Comparison | PIGN-033 – 038 | M5: comparison, rules, baselines, regression runs |
| 8 Hardening | PIGN-039 – 042 | **M6: MVP release** |
| 9 Later | PIGN-043 – 057 | scripts, cookies, more auth, Apidog/Echo, cURL, history, proxy, keychain, CLI, … |

Cross-platform work is built in from the start: the desktop shell comes in PIGN-003, native transport in PIGN-007, desktop and web project access in PIGN-014/015, cross-OS filesystem conformance in PIGN-040, packaging in PIGN-041, and web deployment in PIGN-039. Every UI story must work on both web and desktop.

## 7. How a coding agent should work through the stories

1. Start a fresh session. Read this README, then the story file (for example `docs/stories/PIGN-014-desktop-open-project.md`).
2. Check that every dependency is marked `Done` in [stories/README.md](stories/README.md#story-index). If not, stop and report it.
3. Read the doc sections linked in the story's **Context**. Treat them as the spec; don't redesign.
4. Implement only what **Scope → In scope** lists. Leave everything under **Out of scope** alone.
5. Write the tests listed in **Tests required**, following [testing.md](testing.md).
6. Run `pnpm verify` and any story-specific commands (`pnpm test:e2e`, `cargo test`, desktop build).
7. If you had to deviate from the docs, update the affected doc and the decision table in the same change. Add an *Implementation notes* section to the story.
8. Tick the acceptance criteria and set the story status to `Done` in both the story file and the index.
9. Make one commit or PR per story, then stop. Don't start the next story in the same session unless asked.

If a story turns out too large, split it into `PIGN-0XXa/b` entries in the index, with each part leaving the app working, rather than landing a half-done story.

## 8. The golden rule

> **Every story leaves the application buildable and testable.**
> After each story, `pnpm install && pnpm verify` passes on a clean clone and the web app builds. The desktop app builds on macOS, Windows, and Linux in CI, and every existing test stays green. No story may leave broken builds, failing or skipped tests, or half-wired features behind a crash. Unfinished follow-ups go in the story's implementation notes, never in the main branch as broken code.

## 9. Open decisions (need an owner before the listed story)

| ID | Decision | Needed by |
|---|---|---|
| D-01 | Confirm Tauri 2 (vs Electron) | PIGN-003 |
| D-03 | Confirm custom Rust HTTP command | PIGN-007 |
| D-11 | App identifier, code signing, auto-update policy | PIGN-041 |
| D-12 | Web hosting target/domain | PIGN-039 |
| D-13 | License | public release |
| D-14 | Real Apidog / Echo API export samples | PIGN-048 / PIGN-049 |

All decisions, including the proposed defaults: [architecture.md §11](architecture.md#11-technical-decisions).
