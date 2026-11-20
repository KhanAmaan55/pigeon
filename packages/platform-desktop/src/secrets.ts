/**
 * `SecretStore` on desktop (docs/file-format.md §7): one JSON document per project in
 * `<app-data>/projects/<id>/secrets.json`, written with owner-only permissions (0600 on macOS and
 * Linux). The OS keychain replaces it in PIGN-053.
 */

import type { SecretStore } from '@pigeon/platform';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import type { Invoke } from './native-transport';

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

  #doc(projectId: string): Promise<Record<string, string>> {
    let doc = this.#docs.get(projectId);
    if (!doc) {
      doc = this.#invoke<string | null>('secrets_read', { projectId }).then((text) => {
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
      });
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
