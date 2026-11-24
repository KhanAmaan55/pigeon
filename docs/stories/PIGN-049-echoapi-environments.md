# PIGN-049 — Echo API environment import

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-049 | 9 — Later | Later | Done | PIGN-030 |

## Goal
Support importing Echo API environments — via Postman-format exports if that's what Echo API produces, otherwise via a dedicated importer built from real samples.

## User story
As an Echo API user, I want to import my environments into Pigeon, so I can migrate quickly.

## Context
- **Assumption**-level knowledge only: [compatibility.md §B.3](../compatibility.md#b3-echo-api-assumption--needs-samples-pign-049). D-14 is Open.

## Scope
**In scope**
1. **Gather samples first** (blocking): real Echo API environment exports (both Postman-format and native, if both exist). Sanitize into `packages/fixtures/echoapi/`. No samples → story Blocked.
2. If exports are Postman-compatible: add fixtures + tests proving the Postman importer handles them; add a detection hint ("Detected Echo API export (Postman format)"). Done.
3. Otherwise: document the native format in compatibility.md §B.3, write the mapping table, implement `formats/src/echoapi/` detect + import.
4. Update compatibility.md with confirmed facts and tested versions.

**Out of scope**
- Echo API collections, export to Echo API.

## Acceptance criteria
- [x] All sample fixtures import correctly (snapshot tests).
- [x] compatibility.md §B.3 no longer contains unverified claims for the tested versions.

## Technical notes
- Prefer zero new code if the Postman path works — the goal is compatibility, not an importer.

## Files / components likely affected
`packages/fixtures/echoapi/*`, possibly `packages/formats/src/echoapi/*`, `packages/formats/src/detect.ts`, `docs/compatibility.md`.

## Tests required
Fixture-based tests; detection matrix.

## Definition of done
Standard DoD.

## Status: Done (2026-11-24)
Unblocked by a real Echo API **project export** from the user (Airport Gap). It was the only native sample: Echo API's Postman-format export is a plain Postman collection, already covered by the Postman importer, and no standalone Echo API environment export was available. Unit tests cover what the sample doesn't show (private environments, several servers, global variables, project parameters and auth), using synthetic data labelled as such. The earlier "Blocked" note is kept in git history.

## Implementation notes
- **Fixture:** `packages/fixtures/echoapi/airport-gap.echoapi.json`, the real export with its API list trimmed to one folder and one request. It contains no secrets (Airport Gap is a public test API, and the credentials in it are empty).
- **Format** (now in compatibility.md §B.3): environments live in `global.envs[]`. Each has `env_var_list` (an object keyed by variable name, each with `value`, `current_value` and `description`) and `server_list[].uri` (base URLs per service). Booleans are `1`/`-1`. Every project carries a "Default Environment" with no content and a "Mock Environment" with Echo API's cloud mock URL.
- **`formats/src/echoapi/environments.ts`**:
  - `detectEchoApi` is structural; `detectFormat` checks it after Apidog.
  - `importEchoApi` returns environments, globals and file-level notes.
  - Base URLs, the secret-name rule and the report wording are shared with Apidog through `formats/src/environments/imported.ts`, so the import dialog's "Base URL variable" field works for both.
  - Environments without variables or a URL, such as "Default Environment", are skipped and listed in the report.
  - `is_private: 1` keeps every value off files.
  - Project parameters, project auth, pre/post tasks and the APIs are reported as not imported, with a hint to export the project in Postman format.
- **Core:** `previewImportFiles` handles `echoapi` and `apidog` in one branch. Base URL rebuilding uses `ImportItem.source` (renamed from `apidog`).
- **Tests:**
  - formats `echoapi.test.ts`: a snapshot of the fixture, the detection matrix over every Postman, Apidog and Echo API fixture, the fallback and empty-export messages, private environments, several servers, globals and project-level reports.
  - core: preview, rename the variable and write files.
  - UI: dialog preview and import.
  - e2e in all three browsers: drop a Postman collection with the Echo API export, pick its environment, and send to the test server.
