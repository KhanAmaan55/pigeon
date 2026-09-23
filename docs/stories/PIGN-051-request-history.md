# PIGN-051 — Local request history

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-051 | 9 — Later | Later | Todo | PIGN-042 |

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
- [ ] Sends are recorded and survive restart; limits enforced.
- [ ] No history data inside the project folder.
- [ ] Secrets masked in stored entries.

## Technical notes
- Writes must not slow down sending (async, batched).

## Files / components likely affected
`packages/core/src/history/*`, `packages/platform-desktop/src/history-store.ts`, `packages/platform-web/src/history-store.ts`, `packages/ui/src/features/history/*`, `docs/architecture.md`.

## Tests required
Unit (eviction, masking), E2E (record, reopen).

## Definition of done
Standard DoD.
