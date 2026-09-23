# PIGN-048 — Apidog environment import

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-048 | 9 — Later | Later | Todo | PIGN-030 |

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
- [ ] All sample fixtures import with expected environments/variables (snapshot tests).
- [ ] Unknown/unsupported fields are listed in the import report, not silently dropped.
- [ ] Unrecognized Apidog-like files show the fallback message from §B.2.
- [ ] compatibility.md updated with confirmed details and Apidog version(s) tested.

## Technical notes
- Detection must not misclassify Postman files (test against all Postman fixtures).

## Files / components likely affected
`packages/formats/src/apidog/*`, `packages/formats/src/detect.ts`, `packages/fixtures/apidog/*`, `docs/compatibility.md`.

## Tests required
Fixture-based snapshot tests; detection matrix across all fixtures.

## Definition of done
Standard DoD.
