/**
 * `SecretStore` on desktop (docs/file-format.md §7, docs/platform.md §5.4).
 *
 * - `KeychainSecretStore` (PIGN-053, the default): the OS credential store through the Rust
 *   `keychain_*` commands — one entry per secret, service `pigeon:<projectKey>`, account
 *   `<scope>/<key>`; a project's secrets are read in one batch when it opens.
 * - `FileSecretStore`: `<app-data>/projects/<id>/secrets.json` with owner-only permissions (0600 on
 *   macOS and Linux). It is the keychain store's fallback (no Secret Service on Linux, a denied or
 *   broken keychain) and the source of the one-time migration into the keychain.
 */

import type { SecretBackend, SecretStore } from '@pigeon/platform';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import type { Invoke } from './native-transport';

/** Parses a `secrets.json` document; anything unreadable is an empty document. */
export function parseSecretsDocument(text: string | null): Record<string, string> {
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
    }
  } catch {
    // Unreadable: start over (the values were secrets, never project data).
  }
  return {};
}

export class FileSecretStore implements SecretStore {
  readonly backend = 'local-state';
  readonly #invoke: Invoke;
  readonly #docs = new Map<string, Promise<Record<string, string>>>();
  readonly #writes = new Map<string, Promise<void>>();

  constructor(opts: { invoke?: Invoke } = {}) {
    this.#invoke = opts.invoke ?? tauriInvoke;
  }

  async getAll(projectId: string): Promise<Record<string, string>> {
    return { ...(await this.#doc(projectId)) };
  }

  async get(projectId: string, key: string): Promise<string | undefined> {
    return (await this.#doc(projectId))[key];
  }

  async set(projectId: string, key: string, value: string): Promise<void> {
    const doc = await this.#doc(projectId);
    doc[key] = value;
    await this.#flush(projectId, doc);
  }

  async delete(projectId: string, key: string): Promise<void> {
    const doc = await this.#doc(projectId);
    if (!(key in doc)) return;
    delete doc[key];
    await this.#flush(projectId, doc);
  }

  async clear(projectId: string): Promise<void> {
    await (this.#writes.get(projectId) ?? Promise.resolve()).catch(() => undefined);
    this.#docs.set(projectId, Promise.resolve({}));
    await this.#invoke('secrets_remove', { projectId });
  }

  #doc(projectId: string): Promise<Record<string, string>> {
    let doc = this.#docs.get(projectId);
    if (!doc) {
      doc = this.#invoke<string | null>('secrets_read', { projectId }).then(parseSecretsDocument);
      this.#docs.set(projectId, doc);
    }
    return doc;
  }

  #flush(projectId: string, doc: Record<string, string>): Promise<void> {
    const previous = this.#writes.get(projectId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.#invoke('secrets_write', { projectId, json: JSON.stringify(doc) }))
      .then(() => undefined);
    this.#writes.set(projectId, next);
    return next;
  }
}

/**
 * Store keys are `<scope>\0<key>` (core `SECRET_KEY_SEPARATOR`); keychain accounts are
 * `<scope>/<key>`, with `%` and `/` escaped in the scope so the mapping is exact both ways.
 */
export function accountOf(key: string): string {
  const escape = (text: string) => text.replace(/%/g, '%25').replace(/\//g, '%2F');
  const at = key.indexOf('\u0000');
  return at === -1 ? escape(key) : `${escape(key.slice(0, at))}/${key.slice(at + 1)}`;
}

export function keyOfAccount(account: string): string {
  const unescape = (text: string) => text.replace(/%2F/g, '/').replace(/%25/g, '%');
  const at = account.indexOf('/');
  return at === -1
    ? unescape(account)
    : `${unescape(account.slice(0, at))}\u0000${account.slice(at + 1)}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class KeychainSecretStore implements SecretStore {
  readonly #invoke: Invoke;
  readonly #fallback: FileSecretStore;
  #probe: Promise<void> | undefined;
  #reason: string | undefined;
  readonly #migrations = new Map<string, Promise<void>>();

  constructor(opts: { invoke?: Invoke; fallback?: FileSecretStore } = {}) {
    this.#invoke = opts.invoke ?? tauriInvoke;
    this.#fallback = opts.fallback ?? new FileSecretStore({ invoke: this.#invoke });
  }

  get backend(): SecretBackend {
    return this.#reason === undefined ? 'os-keychain' : 'local-state';
  }

  get notice(): string | undefined {
    return this.#reason === undefined
      ? undefined
      : `The OS keychain is not available (${this.#reason}). Secrets are kept in a local file ` +
          'readable only by your user account instead.';
  }

  async getAll(projectId: string): Promise<Record<string, string>> {
    if (await this.#usable()) {
      try {
        await this.#migrate(projectId);
        const accounts = await this.#invoke<Record<string, string>>('keychain_get_all', {
          projectId,
        });
        return Object.fromEntries(
          Object.entries(accounts).map(([account, value]) => [keyOfAccount(account), value]),
        );
      } catch (error) {
        this.#fallBack(error);
      }
    }
    return this.#fallback.getAll(projectId);
  }

  async get(projectId: string, key: string): Promise<string | undefined> {
    return (await this.getAll(projectId))[key];
  }

  async set(projectId: string, key: string, value: string): Promise<void> {
    if (await this.#usable()) {
      try {
        await this.#invoke('keychain_set', { projectId, account: accountOf(key), value });
        return;
      } catch (error) {
        this.#fallBack(error);
      }
    }
    await this.#fallback.set(projectId, key, value);
  }

  async delete(projectId: string, key: string): Promise<void> {
    if (await this.#usable()) {
      try {
        await this.#invoke('keychain_delete', { projectId, account: accountOf(key) });
        return;
      } catch (error) {
        this.#fallBack(error);
      }
    }
    await this.#fallback.delete(projectId, key);
  }

  /** Keychain entries, the index and `secrets.json` (the Rust side removes all three). */
  async clear(projectId: string): Promise<void> {
    if (await this.#usable()) {
      try {
        await this.#invoke('keychain_clear', { projectId });
        await this.#fallback.clear(projectId);
        return;
      } catch (error) {
        this.#fallBack(error);
      }
    }
    await this.#fallback.clear(projectId);
  }

  /** Probes the credential store once per run. */
  async #usable(): Promise<boolean> {
    this.#probe ??= this.#invoke('keychain_status', {}).then(
      () => undefined,
      (error: unknown) => this.#fallBack(error),
    );
    await this.#probe;
    return this.#reason === undefined;
  }

  #fallBack(error: unknown): void {
    this.#reason ??= message(error) || 'unknown error';
  }

  /**
   * Moves `secrets.json` into the keychain once per project and run; the file is deleted only
   * after every value reads back unchanged. Safe to repeat: values are simply set again.
   */
  #migrate(projectId: string): Promise<void> {
    let migration = this.#migrations.get(projectId);
    if (!migration) {
      migration = this.#runMigration(projectId);
      this.#migrations.set(projectId, migration);
      // A failed migration is retried on the next open (the file is still there).
      migration.catch(() => this.#migrations.delete(projectId));
    }
    return migration;
  }

  async #runMigration(projectId: string): Promise<void> {
    const text = await this.#invoke<string | null>('secrets_read', { projectId });
    if (text === null) return;
    const entries = Object.entries(parseSecretsDocument(text));
    for (const [key, value] of entries) {
      await this.#invoke('keychain_set', { projectId, account: accountOf(key), value });
    }
    const stored = await this.#invoke<Record<string, string>>('keychain_get_all', { projectId });
    const missing = entries.filter(([key, value]) => stored[accountOf(key)] !== value);
    if (missing.length > 0) {
      throw new Error(`${missing.length} secret(s) did not read back from the keychain`);
    }
    await this.#invoke('secrets_remove', { projectId });
  }
}
