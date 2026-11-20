# PIGN-025 — Secret variables

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-025 | 3 — Variables | MVP | Done | PIGN-024 |

## Goal
Secret variables whose current values live in `SecretStore`, are masked everywhere, and can never reach project files, examples, logs, or exports.

## User story
As a developer, I want tokens and passwords stored as secrets that never end up in Git, so I can safely commit my project.

## Context
- Secrets rules: [file-format.md §7](../file-format.md#7-secrets); web caveats [platform.md §6.4](../platform.md#64-environment-variables-and-secrets).

## Scope
**In scope**
- `SecretStore` implementations: desktop `secrets.json` in app-data project dir with restrictive permissions (0600 on macOS/Linux; best effort on Windows) — replaced by keychain in PIGN-053; web IndexedDB store; memory for tests.
- Variables with `type: 'secret'`: current value read/written via `SecretStore` (not `state.json`); UI masks values with reveal-on-hold; copy button copies real value.
- Masking: `maskSecrets(text, secretValues)` used for Timeline, error details, logs, stored last results, and example capture paths.
- Changing a variable from default → secret moves its current value into `SecretStore`; secret → default asks for confirmation.
- Literal-credential hint: typing a literal into auth/password-like fields or `Authorization` header shows "This value will be committed. Move to a secret variable?" with one-click action (creates env secret variable `{{name}}` and replaces the literal).
- Web one-time notice about browser storage of secrets.

**Out of scope**
- OS keychain (PIGN-053), auth UI (PIGN-026 — the hint hooks into the header editor now and auth fields in PIGN-026).

## Acceptance criteria
- [x] Setting a secret current value and committing: no project file contains the value (test greps serialized files).
- [x] Timeline and stored last result show `••••` for the secret's resolved value.
- [x] Secrets are per project (isolation test).
- [x] "Move to secret variable" replaces the literal and stores the value as a secret current value.

## Technical notes
- Mask longest values first; skip masking for values shorter than 4 chars (avoid masking everything) but never store them in results either — document the choice.

## Files / components likely affected
`packages/platform-desktop/src/secrets.ts`, `packages/platform-web/src/secrets.ts`, `packages/core/src/variables/{scopes,mask}.ts`, `packages/core/src/execution/*`, `packages/ui/src/features/environments/*`, `packages/ui/src/features/request-editor/HeadersTab.tsx`.

## Tests required
- Unit: masking, secret current value routing, no-leak serialization test.
- Playwright: secret masked in UI, reveal works.

## Definition of done
Standard DoD.

## Implementation notes
- Platform: `SecretStore.getAll(projectKey)` added (conformance-tested). Desktop `FileSecretStore` keeps `<app-data>/projects/<localKey>/secrets.json` through the Rust commands `secrets_read` / `secrets_write` (written atomically, mode 0600 on Unix; best effort on Windows). Web `IdbSecretStore` keeps them in IndexedDB. `MemorySecretStore` for tests.
- Core: `ProjectSession.fromFs(fs, { secrets })` routes the current value of every `type: 'secret'` variable (environments, globals, collection/folder variables) to the `SecretStore` under `<scopeKey>\u0000<name>`; `state.json` never holds them. Changing a variable to secret moves its current value into the store; back to default moves it into local state. Secrets are keyed by the project's local key, so projects never share them.
- Masking (`execution/mask.ts`): resolved secret values are collected in `PreparedRequest.meta.secretValues`; the request summary (URL, headers, body preview), the response URL/redirect chain and error message/detail are masked with `••••••`, longest value first. Values shorter than 4 characters are not masked in free text (they would match everywhere); a result that used one carries `containsUnmaskedSecrets: true` so history/stored results (PIGN-036+) must not persist it.
- UI: secret current values are masked inputs with reveal-on-hold and a copy button (copies the real value); turning a secret back to default asks for confirmation. Typing a literal into an `Authorization` (or credential-like) header shows "This value will be committed. Move to a secret variable?" — one click creates an environment secret variable, stores the literal as its current value and replaces it with `{{name}}` (auth fields hook into this in PIGN-026). The web app shows a one-time notice that secrets are kept in browser storage.
- E2E: secret masked in the environment editor, revealed while held, kept after a reload (Chromium, Firefox, WebKit).
