# PIGN-053 — OS keychain secret storage (desktop)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-053 | 9 — Later | Later | Done | PIGN-041 |

## Goal
Store secret variable values and tokens in the OS credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service) instead of `secrets.json`, with migration and fallback.

## User story
As a desktop user, I want my secrets protected by the OS keychain, so they're encrypted at rest and not readable from a plain file.

## Context
- SecretStore interface & backends: [platform.md §2, §4, §5.4](../platform.md#2-interfaces-packagesplatform); secrets rules [file-format.md §7](../file-format.md#7-secrets).

## Scope
**In scope**
- Rust commands using the `keyring` crate: `secret_get/set/delete(service="pigeon:<projectId>", account=<scopeKey>/<key>)`; batch read on project open to avoid many prompts.
- `platform-desktop` `KeychainSecretStore`; capability `secretStorage: 'os-keychain'`.
- Migration: on first run, move entries from `secrets.json` into the keychain, then delete the file (only after successful verification).
- Fallback: Linux without Secret Service (or any keychain error) → local-state backend with a visible notice in Diagnostics and project settings.
- "Forget all secrets for this project" action removes keychain entries.

**Out of scope**
- Web (no OS keychain in browsers).

## Acceptance criteria
- [x] Secrets set on each OS are stored in the native store (manual verification per OS in the checklist) and read back after restart. *macOS verified (real Keychain round trip, `cargo test … -- --ignored`); Windows and Linux are release-checklist item 11.*
- [x] Migration from `secrets.json` works and is idempotent.
- [x] Fallback path works when the keychain is unavailable (simulated in tests).

## Technical notes
- macOS may prompt for keychain access for unsigned builds — document; signing (D-11) avoids repeated prompts.

## Files / components likely affected
`apps/desktop/src-tauri/src/secrets.rs`, `apps/desktop/src-tauri/Cargo.toml`, `packages/platform-desktop/src/secrets.ts`, `docs/release-checklist.md`.

## Tests required
`cargo test` with a mock keyring backend; TS unit tests for migration/fallback; manual per-OS checks.

## Definition of done
Standard DoD.

## Implementation notes

- **Rust** (`src-tauri/src/keychain.rs`): commands `keychain_status`, `keychain_get_all`, `keychain_set`, `keychain_delete`, `keychain_clear` and `secrets_remove`. The `keyring` crate (3.6) is behind a `KeyStore` trait: `OsKeyStore` in the app (`apple-native` on macOS, `windows-native` on Windows, `async-secret-service` + `async-io` + `crypto-rust` on Linux — pure-Rust zbus, no libdbus at build time), `MemoryKeyStore` in cargo tests and `--smoke` runs (isolated app data must never touch the user's keychain). Service `pigeon:<localKey>`, account `<scope>/<key>`. The stores cannot list entries portably, so `<app-data>/projects/<key>/keychain.json` lists account names (never values); `keychain_get_all` reads them all in one call when the project opens and drops names whose entry was deleted outside Pigeon. `keychain_clear` removes the entries, the index and `secrets.json`. The story's `secret_get/set/delete` names became `keychain_*` to keep them apart from the existing `secrets_read/write` file commands.
- **TS** (`platform-desktop/src/secrets.ts`): `KeychainSecretStore` is the desktop `SecretStore`; capability `secretStorage: 'os-keychain'`. One availability probe per launch; any keychain error switches to `FileSecretStore` (`secrets.json`) for the rest of the run, and `backend` / `notice` report it. Migration runs once per project and launch inside `getAll`: every `secrets.json` value is set in the keychain, read back, and the file is deleted only when all match (otherwise it stays, and the run uses the fallback). Repeating it only sets the same values again, and a `secrets.json` written by a fallback run merges in on the next launch.
- **Interface**: `SecretStore` gained `clear(projectId)` (memory, IndexedDB, file and keychain stores) and an optional `notice`; `ProjectSession.forgetSecrets()` and `secretStoreNotice`.
- **UI**: Settings → **Secrets** (`SecretsSettings.tsx`) names where values are kept, shows the fallback notice, and has **Forget all secrets for this project** (inline confirm). Diagnostics shows a "Secrets" row (`diagnostics-secrets`) with the backend in use and the notice.
- **Smoke**: checks that the OAuth token sent during the run is in the (in-memory) keychain and that Settings → Secrets names the keychain without a notice.
- **macOS prompts**: unsigned builds get a new code identity on every rebuild, so reading entries from an earlier build shows a Keychain prompt; documented in platform.md §5.1 (signing, D-11, avoids it).
- **Not verified here**: Windows and Linux (no machines in this environment; the Linux target was not cross-compiled). Release checklist item 11 covers them.
