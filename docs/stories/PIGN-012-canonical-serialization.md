# PIGN-012 — Canonical JSON & filename rules

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-012 | 2 — Projects | MVP | Todo | PIGN-001 |

## Goal
Deterministic JSON serialization and slug/filename rules in `@pigeon/formats`, as the foundation for Git-friendly project files.

## User story
As a developer committing Pigeon files, I want identical data to always produce identical bytes, so my Git diffs only show real changes.

## Context
- Rules: [file-format.md §3 (serialization), §4 (naming)](../file-format.md#3-deterministic-serialization).
- D-05: [architecture.md §11](../architecture.md#11-technical-decisions).

## Scope
**In scope**
- `formats/src/canonical-json.ts`: `stringifyCanonical(value, { keyOrder: KeyOrderSpec })` — 2-space indent, LF, final newline, known-key order then unknown keys sorted, `_pigeon` last, `undefined` omitted, no `\u` escaping of non-ASCII.
- `KeyOrderSpec` type: map of object "kinds" to ordered key lists with a way to select a kind for nested objects by path (e.g. `item.request.url`).
- `formats/src/project/key-order.ts`: initial specs for `pigeon.json`, `collection.json`, `folder.json`, `*.request.json` (item/request/url/header/body/auth/event).
- `formats/src/slug.ts`: `slugify(name, { kind, id })`, `allocateSlug(base, taken: Set<string>)`, Windows reserved names, length limit, non-Latin fallback.
- `formats/src/hash.ts`: `sha256Hex(bytes)` using WebCrypto (`crypto.subtle`), available in browsers, Tauri, and Node ≥ 20.

**Out of scope**
- Reading/writing actual project files (PIGN-013).

## Acceptance criteria
- [ ] Same logical object with different insertion order → identical output.
- [ ] Unknown keys appear sorted after known keys and before `_pigeon`.
- [ ] Output ends with exactly one `\n`; no `\r` anywhere.
- [ ] `slugify('Get User!')` = `get-user`; `slugify('CON')` = `con-1`; `slugify('ユーザー取得', {kind:'request', id})` = `request-<id8>`; collisions → `-2`, `-3`.
- [ ] 100 % branch coverage for slug and canonical-json modules.

## Technical notes
- Implement your own stringifier (small, ~100 lines) rather than a library, so key order and escaping are fully controlled.
- `JSON.stringify` for primitive values is fine (strings, numbers).
- Property-based test: `parse(stringifyCanonical(x))` deep-equals `x` minus `undefined`.

## Files / components likely affected
`packages/formats/src/{canonical-json,slug,hash}.ts`, `packages/formats/src/project/key-order.ts`, tests in `packages/formats/test/`.

## Tests required
Unit + property tests (fast-check) for serializer and slugs.

## Definition of done
Standard DoD.
