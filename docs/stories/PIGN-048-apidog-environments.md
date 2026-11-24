# PIGN-048 — Apidog environment import

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-048 | 9 — Later | Later | Done | PIGN-030 |

## Goal
Import environments (and globals, if present) from Apidog exports, built strictly from real sample files.

## User story
As an Apidog user, I want to bring my environments into Pigeon, so I can switch tools without retyping variables and base URLs.

## Context
- Everything about Apidog here is an **Assumption**: [compatibility.md §B.2](../compatibility.md#b2-apidog-assumption--needs-samples-pign-048). D-14 is Open.

## Scope
**In scope**
1. **Gather samples first** (blocking step): obtain ≥ 3 real Apidog exports (different versions/options, incl. multiple base URLs/services and secret-like variables), sanitize, add to `packages/fixtures/apidog/`. If samples can't be obtained, stop and mark the story Blocked.
2. Update compatibility.md §B.2 from assumptions to observed facts (field names, structure, versions) and finalize the mapping table.
3. `formats/src/apidog/`: `detect()` (structural) + `importEnvironments()` → Pigeon `Environment[]` / globals; base URL mapping per §B.2 with configurable variable name in the import dialog.
4. Import dialog support (reuses PIGN-030 flow), report listing unmapped fields.

**Out of scope**
- Apidog collections/API definitions (users can export OpenAPI/Postman from Apidog), export to Apidog.

## Acceptance criteria
- [x] All sample fixtures import with expected environments/variables (snapshot tests).
- [x] Unknown/unsupported fields are listed in the import report, not silently dropped.
- [x] Unrecognized Apidog-like files show the fallback message from §B.2.
- [x] compatibility.md updated with confirmed details and Apidog version(s) tested.

## Technical notes
- Detection must not misclassify Postman files (test against all Postman fixtures).

## Files / components likely affected
`packages/formats/src/apidog/*`, `packages/formats/src/detect.ts`, `packages/fixtures/apidog/*`, `docs/compatibility.md`.

## Tests required
Fixture-based snapshot tests; detection matrix across all fixtures.

## Definition of done
Standard DoD.

## Status: Done (2026-11-24)
Unblocked by real Apidog exports from the user: first one environment export and one project export (Apidog format 1.2.0), then a second pair (Airport Gap) from a newer build. These four samples cover the scope's "at least three". The newer exports add the variable options `isFixedValue`/`isBindInitial`, leave out `description`/`isSync`, and keep the base URL only on one service with an empty main `baseUrl`. Unit tests cover what no sample shows, using synthetic data labelled as such. The earlier "Blocked" note is kept in git history.

## Implementation notes
- **Fixtures** (`packages/fixtures/apidog/`):
  - `environment-export.apidog.json` and `project-export.apidog.json`, sanitized by script.
  - Keys, signatures and UUIDs are replaced with obvious fakes; project, module and environment names are made generic.
  - The project export's API tree, module description and test-case lists are trimmed. Every top-level key is kept.
  - Structure and Apidog's quirks are unchanged, for example a value with a leading space.
- **What the samples showed** (now in compatibility.md §B.2):
  - Variables carry `initialValue` (the shared value) and `value` (the current one), plus `isSync` and an optional `securityType` (only `default` seen).
  - Base URLs come as a main `baseUrl` plus `baseUrls` per service. The keys are module ids in project exports and server ids (including `default`) in environment exports.
  - Module names come from `moduleSettings`; every server is called "Default Server".
  - Environment-level `parameters`, proxy `advancedSettings` and WebSocket/Socket.IO URLs are also present.
- **`formats/src/apidog/environments.ts`**:
  - `detectApidog` is structural, and `detectFormat` checks it after every Postman shape. A test runs every Postman and Apidog fixture through detection to make sure neither is mistaken for the other.
  - `importApidog` returns environments, globals and file-level notes.
  - `buildApidogEnvironment(source, name)` places the base URLs first, as `name` and `name_<module name or service id>`. Services without a URL, and URLs equal to the main one, are skipped. A name already used by an exported variable is not overwritten; the report says so.
  - Values go through the shared `splitSecrets`. It now takes separate current values, so the initial value goes to files and the current value to "use as my current values".
- **Secret-like names:**
  - The real sample had API keys and a webhook secret saved as plain variables.
  - Names ending in secret, password, token, apiKey, privateKey or credentials are imported as secrets, even when empty (the Airport Gap sample has an empty `api_token` and `account_password`), so those values never reach project files.
  - The report names them and says how to change them back.
  - Unknown `securityType` values and `isSync: false` (neither seen in the samples) also keep values off files.
- **Report:** unsupported data is listed, not silently dropped. This covers non-empty environment parameters, socket base URLs, registration centers, non-default proxy settings, unknown environment types and unknown environment or variable fields. For a project export it also says that APIs, docs and schemas are not imported, and to export them as OpenAPI or Postman instead. Apidog bookkeeping (`id`, `ordering`, `tags`, `visibility`, `projectType`) is ignored, as documented in §B.2.
- **Shared with Echo API (PIGN-049):** base URL variables, the secret-name rule and report wording live in `formats/src/environments/imported.ts` (`EnvironmentSource`, `buildImportedEnvironment`); the import item's `source` carries the tool name for the base URL descriptions.
- **Core and UI:**
  - `previewImportFiles` turns one Apidog file into several environment items, plus a globals item when globals are present. Each carries `apidog` (its source) and `baseUrls`; file-level notes go in `fileWarnings`.
  - `withBaseUrlVariable(items, name)` rebuilds them under another variable name.
  - The import dialog shows a "Base URL variable" field, rejecting names with spaces or braces, and lists each base URL with the variable it becomes.
  - Environment name collisions use the existing Keep both / Replace choice from PIGN-030.
- **`detectFormat` fix:** byte input from another JS realm (jsdom, workers) is now recognised with `ArrayBuffer.isView`. Before, it fell through to "not JSON".
- **Tests:**
  - formats `apidog.test.ts`: snapshot tests of both fixtures, the detection matrix, the fallback, base URL naming and collisions, the unmapped-field report, and globals.
  - core: import, rename the variable, write files, check no secret reached a file and that secrets went to secure storage, and name collisions.
  - UI: dialog preview, renaming, invalid name, writing files, and the fallback message.
  - e2e in all three browsers: drop a Postman collection with the Apidog export, rename the base URL variable to `api`, import, pick the environment, and send to the test server.
- **Verified on macOS:**
  - `pnpm verify`: 1435 tests.
  - e2e: 307 passed.
  - perf.
  - Desktop build and `--smoke`.
  - Not run: cargo checks, since there are no Rust changes.
