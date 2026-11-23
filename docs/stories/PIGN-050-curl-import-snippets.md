# PIGN-050 — cURL import & code snippets

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-050 | 9 — Later | Later | Done | PIGN-042 |

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
- [x] "Copy as cURL" outputs from Chrome on macOS/Linux (bash) and Windows (cmd, PowerShell) import correctly (fixtures).
- [x] Generated cURL for fixture requests round-trips through the parser to an equivalent request.
- [x] Secrets are masked in snippets by default.

## Technical notes
- Pure functions in `formats`; no shell execution.

## Files / components likely affected
`packages/formats/src/{curl,snippets}/*`, `packages/formats/src/detect.ts`, `packages/ui/src/features/{import-export,request-editor/CodePanel}.tsx`.

## Tests required
Table-driven parser tests (per shell), generator snapshots, round trip.

## Definition of done
Standard DoD.

## Implementation notes

- **Parser** `formats/src/curl/parse.ts`: `isCurlCommand`, `detectShell`, `tokenize` (bash incl. `$'…'`; cmd per Chromium's `^` escaping and Windows argv rules, `^` + two newlines = newline in an argument; PowerShell `curl.exe`, `''`, backticks) and `parseCurl` → `CurlRequest` (method, URL, headers, `ProjectBody`, Basic/Bearer auth, settings, warnings). The option mapping is in [compatibility.md §B.6](../compatibility.md#b6-curl-commands-pign-050). Value-taking options Pigeon doesn't model (`--proxy`, `--cert`, `-T`, …) are skipped with their value and reported, so their argument is never taken for the URL.
- **Detection**: `detectFormat` returns `{ kind: 'curl', request }` for non-JSON text starting with `curl`/`curl.exe`; the "not valid JSON" message now reads "not valid JSON or a cURL command".
- **Import**: `ImportItem` kind `request` (core `previewImportFiles`), applied with `createRequest` into `ApplyImportOptions.targetId` (the explorer selection's container), else the first collection, else a new "Imported" collection. The dialog shows method + URL, an editable name and the parser's warnings, and opens the new request in a tab. A cURL command pasted outside text fields opens this preview; `.txt`/`.sh`/`.curl` files are accepted by the import picker.
- **URL bar**: pasting a cURL command calls the editor store's `applyCurl` (method, URL, headers, body, settings; auth only when the command has one, otherwise the request's auth is kept). Ignored options are listed in the toast.
- **Snippets** `formats/src/snippets/`: `SnippetGenerator` (`curl`, `fetch`, `python`, `go`) over a neutral `SnippetRequest`; core `snippetRequest(request, ctx, { resolve, revealSecrets })` builds it (user headers, auth headers/query params, body and its `Content-Type`; not Pigeon's default `User-Agent`/`Accept`). Secret variable values and auth credentials (incl. the Basic base64) are masked unless revealed — with "Resolve variables" off, literal credentials are still masked. Digest / AWS SigV4 / OAuth 2.0 are computed at send time and only noted.
- **UI**: Code tab in the request editor (`CodePanel.tsx`; language remembered in `localStorage`), explorer **Copy as cURL** for requests (variables kept).
- **Tests**: `formats/test/curl.test.ts` (fixtures per shell, table-driven tokenizer and options, snapshot per generator, cURL round trip for every snippet fixture), `core/test/curl-snippets.test.ts` (import into folder / new collection, masking, inherited query auth, round trip of a project request), `ui/test/curl-code.test.tsx`, `e2e/web/curl.spec.ts` (paste → import → send → Code tab → Copy as cURL, 3 browsers). Generated Python, JavaScript and bash were syntax-checked locally (`py_compile`, `node --check`, `bash -n`); Go has snapshot coverage only (no Go toolchain on the dev machine).
- Follow-ups: more languages via `SnippetGenerator`; a bundled flag ending in a value option (`-sX POST`) is reported as unknown.
