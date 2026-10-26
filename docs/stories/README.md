# Pigeon — Stories

Stories are small, ordered, vertical slices. Implement them **one at a time, in order** (unless the dependency column allows otherwise). Each story must leave the repository buildable and all tests green.

## How to work a story (for coding agents)

1. **Pick** the lowest-numbered story with status `Todo` whose dependencies are `Done`.
2. **Read** `docs/README.md`, the story file, and every doc section the story links. Don't re-derive requirements — the docs are the spec.
3. **Plan** the change within the story's *Scope*. Anything under *Out of scope* stays out, even if tempting.
4. **Implement** with tests (see [testing.md](../testing.md)). Keep package boundaries ([architecture.md §2](../architecture.md#2-repository-layout)).
5. **Verify**: `pnpm verify` must pass. Also run the story-specific commands in *Tests required* (e.g. `pnpm test:e2e`, `cargo test`, desktop build).
6. **Update docs** if you had to deviate: edit the relevant doc and the decision table in [architecture.md §11](../architecture.md#11-technical-decisions). Add an *Implementation notes* section at the bottom of the story file (what changed, follow-ups).
7. **Mark** the story `Done` in the table below (and in the story's header).
8. One story = one commit/PR. Don't start the next story in the same change.

## Standard Definition of Done (applies to every story)

- All acceptance criteria met and checked off in the story file.
- `pnpm verify` passes (lint, typecheck, unit/integration tests, web build).
- Story-specific tests added and passing; no skipped tests.
- Desktop app still builds (`pnpm --filter @pigeon/desktop build`) when desktop code or shared UI changed (CI covers other OSes).
- Package dependency rules respected (no DOM/Tauri/Node imports in `core`, `formats`, `compare`, `platform`).
- No secrets, absolute machine paths, or volatile data written to project files.
- Docs updated for any deviation; story status updated.

## Story index

Tiers: **MVP** (PIGN-001 → PIGN-042) and **Later** (PIGN-043 → PIGN-057). Future/out-of-scope items are listed in [product.md §6](../product.md#6-scope-tiers).

| ID | Title | Phase | Tier | Depends on | Status |
|---|---|---|---|---|---|
| [PIGN-001](PIGN-001-monorepo-scaffold.md) | Monorepo scaffold & tooling | 0 Foundation | MVP | — | Done |
| [PIGN-002](PIGN-002-web-app-shell.md) | Web app shell & layout | 0 Foundation | MVP | 001 | Done |
| [PIGN-003](PIGN-003-desktop-shell.md) | Desktop shell (Tauri) on macOS/Windows/Linux | 0 Foundation | MVP | 002 | Done |
| [PIGN-004](PIGN-004-platform-interfaces.md) | Platform interfaces, capabilities & memory adapters | 0 Foundation | MVP | 002 | In review |
| [PIGN-005](PIGN-005-test-server.md) | Local HTTP test server | 0 Foundation | MVP | 001 | Todo |
| [PIGN-006](PIGN-006-send-adhoc-request-web.md) | Send an ad-hoc HTTP request (web fetch) | 1 First request | MVP | 004, 005 | Todo |
| [PIGN-007](PIGN-007-native-desktop-transport.md) | Native desktop HTTP transport | 1 First request | MVP | 003, 006 | Todo |
| [PIGN-008](PIGN-008-params-headers.md) | Query params, path variables & headers | 1 First request | MVP | 006 | Todo |
| [PIGN-009](PIGN-009-request-bodies.md) | Request body modes | 1 First request | MVP | 008 | Todo |
| [PIGN-010](PIGN-010-response-viewer.md) | Response viewer | 1 First request | MVP | 006 | Todo |
| [PIGN-011](PIGN-011-timeouts-cancel-redirects-errors.md) | Timeouts, cancel, redirects & network errors | 1 First request | MVP | 007, 010 | Todo |
| [PIGN-012](PIGN-012-canonical-serialization.md) | Canonical JSON & filename rules | 2 Projects | MVP | 001 | Todo |
| [PIGN-013](PIGN-013-project-format-core.md) | Project file format read/write (core) | 2 Projects | MVP | 004, 012 | Todo |
| [PIGN-014](PIGN-014-desktop-open-project.md) | Create/open project on desktop + explorer | 2 Projects | MVP | 007, 013 | Todo |
| [PIGN-015](PIGN-015-web-open-project.md) | Open project on web (folder access & browser workspace) | 2 Projects | MVP | 014 | Todo |
| [PIGN-016](PIGN-016-request-tabs.md) | Request tabs for project requests | 2 Projects | MVP | 014, 009 | Todo |
| [PIGN-017](PIGN-017-explorer-crud.md) | Explorer CRUD, move & reorder | 2 Projects | MVP | 016 | Todo |
| [PIGN-018](PIGN-018-save-local-drafts.md) | Save to local state (drafts) | 2 Projects | MVP | 017 | Todo |
| [PIGN-019](PIGN-019-save-for-commit.md) | Save for Commit & Pending Changes | 2 Projects | MVP | 018 | Todo |
| [PIGN-020](PIGN-020-external-changes-conflicts.md) | External file changes & conflicts | 2 Projects | MVP | 019 | Todo |
| [PIGN-021](PIGN-021-multiple-projects.md) | Multiple isolated projects | 2 Projects | MVP | 018 | Todo |
| [PIGN-022](PIGN-022-environments.md) | Environments (Postman env files) | 3 Variables | MVP | 019 | Todo |
| [PIGN-023](PIGN-023-variable-resolution.md) | Variable resolution & highlighting | 3 Variables | MVP | 022 | Todo |
| [PIGN-024](PIGN-024-collection-vars-globals.md) | Collection variables & project globals | 3 Variables | MVP | 023 | Todo |
| [PIGN-025](PIGN-025-secret-variables.md) | Secret variables | 3 Variables | MVP | 024 | Todo |
| [PIGN-026](PIGN-026-auth-inheritance.md) | Auth (basic, bearer, API key) with inheritance | 4 Auth | MVP | 025 | Todo |
| [PIGN-027](PIGN-027-response-examples.md) | Save & manage response examples | 5 Examples & Postman | MVP | 019, 010 | Todo |
| [PIGN-028](PIGN-028-import-postman-collection.md) | Import Postman collection (v2.1/v2.0) | 5 Examples & Postman | MVP | 027, 026 | Todo |
| [PIGN-029](PIGN-029-export-postman-collection.md) | Export Postman collection v2.1 | 5 Examples & Postman | MVP | 028 | Todo |
| [PIGN-030](PIGN-030-postman-environments-io.md) | Import/export Postman environments & globals | 5 Examples & Postman | MVP | 028, 025 | Todo |
| [PIGN-031](PIGN-031-scripts-tab.md) | Scripts tab (preserve & edit) | 5 Examples & Postman | MVP | 028 | Todo |
| [PIGN-032](PIGN-032-graphql-requests.md) | GraphQL requests | 6 GraphQL | MVP | 023 | Todo |
| [PIGN-033](PIGN-033-comparison-engine.md) | Comparison engine: inference & structural diff | 7 Comparison | MVP | 001 | Todo |
| [PIGN-034](PIGN-034-compare-ui.md) | Compare response against baseline (UI) | 7 Comparison | MVP | 027, 033 | Todo |
| [PIGN-035](PIGN-035-field-rules.md) | Field rules: optional / ignore / nullable / dynamic | 7 Comparison | MVP | 034 | Todo |
| [PIGN-036](PIGN-036-status-headers-values.md) | Status, headers & value-mode comparison | 7 Comparison | MVP | 035 | Todo |
| [PIGN-037](PIGN-037-accept-baseline.md) | Accept new baseline & baseline selection | 7 Comparison | MVP | 035 | Todo |
| [PIGN-038](PIGN-038-regression-run.md) | Collection/folder regression run & report | 7 Comparison | MVP | 037 | Todo |
| [PIGN-039](PIGN-039-web-deployment.md) | Web deployment & browser-limitation UX | 8 Hardening | MVP | 015, 011 | Todo |
| [PIGN-040](PIGN-040-cross-os-filesystem.md) | Cross-OS filesystem conformance | 8 Hardening | MVP | 020 | Todo |
| [PIGN-041](PIGN-041-desktop-packaging.md) | Desktop packaging & release builds | 8 Hardening | MVP | 040 | Todo |
| [PIGN-042](PIGN-042-shortcuts-palette-performance.md) | Shortcuts, command palette & performance budget | 8 Hardening | MVP | 038 | Todo |
| [PIGN-043](PIGN-043-script-sandbox-prerequest.md) | Script sandbox & pre-request scripts | 9 Later | Later | 042 | Todo |
| [PIGN-044](PIGN-044-test-scripts.md) | Test scripts & results | 9 Later | Later | 043 | Todo |
| [PIGN-045](PIGN-045-cookie-jar.md) | Cookie jar & cookie manager | 9 Later | Later | 042 | Todo |
| [PIGN-046](PIGN-046-digest-awsv4-auth.md) | Digest & AWS SigV4 auth | 9 Later | Later | 042 | Todo |
| [PIGN-047](PIGN-047-oauth2.md) | OAuth 2.0 auth | 9 Later | Later | 046 | Todo |
| [PIGN-048](PIGN-048-apidog-environments.md) | Apidog environment import | 9 Later | Later | 030 | Todo |
| [PIGN-049](PIGN-049-echoapi-environments.md) | Echo API environment import | 9 Later | Later | 030 | Todo |
| [PIGN-050](PIGN-050-curl-import-snippets.md) | cURL import & code snippets | 9 Later | Later | 042 | Todo |
| [PIGN-051](PIGN-051-request-history.md) | Local request history | 9 Later | Later | 042 | Todo |
| [PIGN-052](PIGN-052-web-cors-proxy.md) | Optional self-hosted CORS proxy (web) | 9 Later | Later | 039, 040 | Todo |
| [PIGN-053](PIGN-053-os-keychain-secrets.md) | OS keychain secret storage (desktop) | 9 Later | Later | 041 | Todo |
| [PIGN-054](PIGN-054-cli-runner.md) | CLI regression runner | 9 Later | Later | 038, 040 | Todo |
| [PIGN-055](PIGN-055-graphql-introspection.md) | GraphQL introspection & autocomplete | 9 Later | Later | 032 | Todo |
| [PIGN-056](PIGN-056-json-schema-export.md) | JSON Schema export of snapshots | 9 Later | Later | 035 | Todo |
| [PIGN-057](PIGN-057-git-status-awareness.md) | Read-only Git status awareness (desktop) | 9 Later | Later | 041 | Todo |

### Parallelism notes
- PIGN-005, PIGN-012 and PIGN-033 are pure libraries/tools and can be done early or in parallel with UI stories.
- Within phase 9, stories are independent except where listed.

### Milestones
| Milestone | After story | What works |
|---|---|---|
| M0 Skeleton | PIGN-005 | Web + desktop shells build on all OSes; test server |
| M1 First request | PIGN-011 | Send HTTP requests from web and desktop; view responses |
| M2 Projects | PIGN-021 | Open project folders, edit, Save, Save for Commit, conflicts, multiple projects |
| M3 Variables & auth | PIGN-026 | Environments, variables, secrets, auth |
| M4 Postman | PIGN-032 | Examples, Postman import/export, scripts preserved, GraphQL |
| M5 Regression | PIGN-038 | Comparison, rules, baselines, regression runs |
| M6 MVP release | PIGN-042 | Deployable web, packaged desktop, polish |

## Story template

```markdown
# PIGN-XXX — Title

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-XXX | n — Name | MVP/Later | Todo | PIGN-… |

## Goal
## User story
## Context
## Scope
**In scope** … **Out of scope** …
## Acceptance criteria
- [ ] …
## Technical notes
## Files / components likely affected
## Tests required
## Definition of done
```
