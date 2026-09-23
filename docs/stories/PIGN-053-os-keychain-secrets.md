# PIGN-053 — OS keychain secret storage (desktop)

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-053 | 9 — Later | Later | Todo | PIGN-041 |

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
- [ ] Secrets set on each OS are stored in the native store (manual verification per OS in the checklist) and read back after restart.
- [ ] Migration from `secrets.json` works and is idempotent.
- [ ] Fallback path works when the keychain is unavailable (simulated in tests).

## Technical notes
- macOS may prompt for keychain access for unsigned builds — document; signing (D-11) avoids repeated prompts.

## Files / components likely affected
`apps/desktop/src-tauri/src/secrets.rs`, `apps/desktop/src-tauri/Cargo.toml`, `packages/platform-desktop/src/secrets.ts`, `docs/release-checklist.md`.

## Tests required
`cargo test` with a mock keyring backend; TS unit tests for migration/fallback; manual per-OS checks.

## Definition of done
Standard DoD.
