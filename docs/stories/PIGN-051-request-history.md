# PIGN-051 — Local request history

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-051 | 9 — Later | Later | Done | PIGN-042 |

## Goal
Keep a bounded, per-project local history of sent requests and responses, searchable, re-openable, never committed.

## User story
As a developer, I want to find a request I sent an hour ago with its response, so I can compare or repeat it.

## Context
- Local state boundaries & limits: [file-format.md §6](../file-format.md#6-local-app-state). D-07 (SQLite deferred) — decide here whether history needs SQLite on desktop; IndexedDB on web.

## Scope
**In scope**
- History entries: timestamp, request snapshot (resolved URL/method/headers, secrets masked), environment, status, time, size, body (bounded: 256 KB each), comparison outcome.
- Storage: desktop append-only files or SQLite (decision recorded in architecture.md), web IndexedDB; limits: last 1,000 entries / 100 MB per project, oldest evicted.
- History view (activity bar): grouped by day, filter by method/status/URL text; open entry → read-only request + response; "Open as new request" / "Restore into request".
- Clear history (per project) and preference to disable.

**Out of scope**
- Syncing history anywhere; history for other projects.

## Acceptance criteria
- [x] Sends are recorded and survive restart; limits enforced.
- [x] No history data inside the project folder.
- [x] Secrets masked in stored entries.

## Technical notes
- Writes must not slow down sending (async, batched).

## Files / components likely affected
`packages/core/src/history/*`, `packages/platform-desktop/src/history-store.ts`, `packages/platform-web/src/history-store.ts`, `packages/ui/src/features/history/*`, `docs/architecture.md`.

## Tests required
Unit (eviction, masking), E2E (record, reopen).

## Definition of done
Standard DoD.

## Implementation notes

- **Decision** (architecture.md D-16): no SQLite. Platform `HistoryStore` (`append` batch / `list` / `get` / `remove` / `clear`, keyed by the project's local-state key): desktop `FileHistoryStore` over Rust `history_*` commands (`<app-data>/projects/<key>/history/index.jsonl` appended per batch + `entries/<id>.json`; one lock; ids and keys validated; torn last line skipped), web `IdbHistoryStore` (IndexedDB version 2 adds `history` + `historyIndex`; existing data kept on upgrade), `MemoryHistoryStore` elsewhere. Layout in [file-format.md §6](../file-format.md#6-local-app-state).
- **Core** `history/history.ts`: `historyEntryFromResult` (masks URL, headers, bodies, error text and the saved request definition with the send's secret values; response bodies ≤ 256 KB, binary as base64; `null` for `containsUnmaskedSecrets` or cancelled sends), `ProjectHistory` (`record` returns at once and lists the entry immediately; writes are batched on a timer; eviction past 1,000 entries / 100 MB, oldest first, by `storedBytes`), `filterHistory`, `groupHistoryByDay`. `ProjectSession.history` exists when the project has local state.
- **Recording**: project request sends (editor tabs) are recorded after the comparison finishes, with environment, request name and comparison outcome; preference **Record sends** (`recordHistory`, persisted with the other preferences). Collection runs and the scratch request are not recorded.
- **UI**: activity bar **History** (`features/history/HistoryView.tsx`: day groups, text/method/status filters, record toggle, Clear with confirmation) and the read-only entry dialog (`HistoryEntryDialog.tsx`) with **Open as new request** and **Restore into request** (unsaved edit of the original request).
- **Tests**: `core/test/history.test.ts` (masking incl. saved definition, 256 KB bound, base64, never-stored cases, batching, restart, eviction by count and bytes, remove/clear, filters, nothing written to the project folder), `platform-web/test/history-store.test.ts` (memory + IndexedDB conformance, v1→v2 upgrade), `platform-desktop/test/history-store.test.ts`, Rust `history::tests` (append/list/get/remove/clear, torn line, path escapes), `e2e/web/history.spec.ts` (record, reload, filter, reopen, open as new, clear; 3 browsers), desktop smoke (history written through the real IPC commands, OAuth token masked).
- Follow-ups: delete single entries from the list; record collection runs if wanted.
