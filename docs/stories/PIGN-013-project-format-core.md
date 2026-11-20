# PIGN-013 — Project file format read/write (core)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-013 | 2 — Projects | MVP | Done | PIGN-004, PIGN-012 |

## Goal
Read and serialize a Pigeon project folder (manifest, collections, folders, requests) through `ProjectFileSystem`, with round-trip determinism and tolerant loading.

## User story
As a developer, I want my API collections stored as readable files in a folder, so I can version them with Git.

## Context
- Layout & file contents: [file-format.md §1–2](../file-format.md#1-directory-structure).
- Domain model: [data-model.md §3–4](../data-model.md#3-project).
- Unknown-field preservation: [compatibility.md §A.3](../compatibility.md#a3-preservation-of-unknown-fields).

## Scope
**In scope**
- Complete domain types for Project, Collection, Folder, Request (incl. `extra`, `fileKey`, `auth` as preserved `unknown` until PIGN-026, `events` preserved), zod schemas for file shapes.
- `formats/src/project/reader.ts`: `readProject(fs) → { model, files: Map<path, {hash}>, problems: Problem[] }`:
  - requires `pigeon.json`; reads `collections/<dir>/collection.json`, recursive folders (`folder.json`), `*.request.json`.
  - ordering via `pigeon.json.collections` and `_pigeon.order`, missing children appended alphabetically, stale entries dropped with a warning problem.
  - per-file parse errors → `Problem { path, kind: 'parse' | 'schema', message }`, entity marked `broken` (placeholder node keeps id/name if recoverable), never throws for bad files.
  - newer `formatVersion` → `readOnly: true`.
- `formats/src/project/writer.ts`: `serializeProject(model) → Map<ProjectPath, Uint8Array>` using canonical JSON + key orders; URL derived parts omitted.
- `formats/src/project/create.ts`: `createEmptyProject(name)` → model + initial files incl. `.gitattributes` (file-format §10).
- Golden fixtures in `packages/fixtures/projects/basic/` (2 collections, nested folders, 6 requests with various fields & unknown keys).
- Environments, examples and compare files are **not** read yet (added in PIGN-022, PIGN-027, PIGN-035) but the reader must ignore them without error.

**Out of scope**
- Drafts, save, commit, watchers (PIGN-018–020). UI (PIGN-014).

## Acceptance criteria
- [x] `serializeProject(readProject(fixture).model)` equals the fixture files byte-for-byte.
- [x] Unknown keys at collection, folder, item, request, url, header, body levels survive the round trip.
- [x] A request file with invalid JSON yields a `parse` problem and the rest of the project loads.
- [x] Hand-edited `_pigeon.order` missing an entry still loads all children (appended alphabetically).
- [x] Unmanaged files (e.g. `collections/users-api/README.md`) are ignored.
- [x] Works on `MemoryFs`; no DOM/Node imports.

## Technical notes
- Map Postman item JSON ⇄ domain in `formats/src/postman/item.ts` so the same mapping is reused by the Postman importer (PIGN-028). The project reader = postman item mapping + Pigeon container files.
- Keep `fileKey` from the actual filename/dirname on read; the writer uses `fileKey` (it does not re-slugify).
- Record per-file `sha256` in `files` for conflict detection later.

## Files / components likely affected
`packages/core/src/model/*`, `packages/formats/src/project/{reader,writer,create,schemas}.ts`, `packages/formats/src/postman/item.ts`, `packages/fixtures/projects/basic/**`.

## Tests required
- Golden round-trip test; broken-file tests; ordering tolerance tests; unknown-field tests.

## Definition of done
Standard DoD.

## Implementation notes
- Project entity types (`ProjectModel`, `Collection`, `Folder`, `ProjectRequest`, …) live in `formats/src/project/types.ts`, because `formats` may not depend on `core`; `core/src/model/project.ts` re-exports them. Core's editor `Request` is structurally a `ProjectRequest` without `auth`/`events`/`broken` (type test in `core/test/model.test.ts`). Auth, events and collection/folder variables are preserved as `unknown` until PIGN-026/031/024.
- `Problem` has `kind: 'missing' | 'parse' | 'schema' | 'order'` and a `severity`; stale order entries are `order` warnings. A missing/invalid `pigeon.json` returns a placeholder model with `readOnly: true`.
- Broken entities keep their place in order lists but their own files are never serialized; children of a broken folder/collection are still read and written.
- Mapping details: absent body ⇄ `{ mode: 'none' }` (no `body` key written); empty `header`/`query`/`variable`/`event` arrays are omitted; Postman `null` param values ⇄ `extra.valueNull`; `timeoutMs` is stored as `_pigeon.timeoutMs`; unsupported body modes (GraphQL until PIGN-032) are kept verbatim; raw `options` are kept and the language is only rewritten when it changes; unknown request/profile/`_pigeon` keys are nested under `extra.request` / `extra.protocolProfileBehavior` / `extra._pigeon`.
- Golden files: `UPDATE_GOLDEN=1 pnpm vitest run packages/formats/test/project-format.test.ts` rewrites `packages/fixtures/projects/basic`. `packages/fixtures/projects/` is excluded from Prettier.
