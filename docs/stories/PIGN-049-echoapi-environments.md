# PIGN-049 — Echo API environment import

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-049 | 9 — Later | Later | Blocked | PIGN-030 |

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
- [ ] All sample fixtures import correctly (snapshot tests).
- [ ] compatibility.md §B.3 no longer contains unverified claims for the tested versions.

## Technical notes
- Prefer zero new code if the Postman path works — the goal is compatibility, not an importer.

## Files / components likely affected
`packages/fixtures/echoapi/*`, possibly `packages/formats/src/echoapi/*`, `packages/formats/src/detect.ts`, `docs/compatibility.md`.

## Tests required
Fixture-based tests; detection matrix.

## Definition of done
Standard DoD.

## Status: Blocked (2026-11-23)
The story's first step is blocking: it needs real Echo API export files, and none are available to
the implementer (no Echo API account or sample exports in the repository, and the format is only an
assumption in compatibility.md §B.3). Writing an importer against invented files would encode
guesses as facts, which this story explicitly forbids ("If samples can't be obtained, stop and mark
the story Blocked").

**To unblock**: add at least three sanitized Echo API environment exports (different versions or
options, Postman-format and native if both exist) to
`packages/fixtures/echoapi/`, then set the status back to `Todo`.
