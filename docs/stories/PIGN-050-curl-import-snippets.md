# PIGN-050 — cURL import & code snippets

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-050 | 9 — Later | Later | Todo | PIGN-042 |

## Goal
Paste a cURL command to create a request, and generate code snippets (cURL, fetch, Python requests, Go net/http) from a request.

## User story
As a developer copying requests from browser devtools or docs, I want to paste cURL into Pigeon and copy snippets out, so moving between tools is instant.

## Context
- Detection order includes cURL: [compatibility.md §B.4](../compatibility.md#b4-detection-order).

## Scope
**In scope**
- `formats/src/curl/parse.ts`: shell-word tokenizer (bash and Windows `cmd`/PowerShell quoting from "Copy as cURL" in Chromium on each OS), flags `-X`, `-H`, `-d/--data*`, `--data-urlencode`, `-F`, `-u`, `-b`, `--compressed`, `-k`, `-L`, `--url`, `-G`; unknown flags reported.
- Paste into URL bar or Import dialog → detected as cURL → new request (in the selected folder).
- `formats/src/snippets/`: generators for cURL (bash), JavaScript fetch, Python requests, Go; option "resolve variables" (secrets masked unless explicitly revealed).
- Explorer "Copy as cURL" and a **Code** panel in the request editor.

**Out of scope**
- Other languages (add later via the same generator interface).

## Acceptance criteria
- [ ] "Copy as cURL" outputs from Chrome on macOS/Linux (bash) and Windows (cmd, PowerShell) import correctly (fixtures).
- [ ] Generated cURL for fixture requests round-trips through the parser to an equivalent request.
- [ ] Secrets are masked in snippets by default.

## Technical notes
- Pure functions in `formats`; no shell execution.

## Files / components likely affected
`packages/formats/src/{curl,snippets}/*`, `packages/formats/src/detect.ts`, `packages/ui/src/features/{import-export,request-editor/CodePanel}.tsx`.

## Tests required
Table-driven parser tests (per shell), generator snapshots, round trip.

## Definition of done
Standard DoD.
