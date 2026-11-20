/**
 * `SecretStore` in the browser (docs/platform.md §6.4): IndexedDB (`projects` store, keys
 * `secret:<projectId>\0<key>`). Not encrypted at rest and readable by scripts of this origin —
 * the UI says so once.
 */

import type { SecretStore } from '@pigeon/platform';

import { prefixRange, request, transact } from './idb';

const keyOf = (projectId: string, key: string) => `secret:${projectId}\u0000${key}`;

export class IdbSecretStore implements SecretStore {
  readonly backend = 'indexeddb';
  readonly #db: () => Promise<IDBDatabase>;

  constructor(db: () => Promise<IDBDatabase>) {
    this.#db = db;
  }

  async getAll(projectId: string): Promise<Record<string, string>> {
    const prefix = keyOf(projectId, '');
    const db = await this.#db();
    const [keys, values] = await transact(db, 'projects', 'readonly', (tx) => {
      const store = tx.objectStore('projects');
      return [
        request(store.getAllKeys(prefixRange(prefix))),
        request(store.getAll(prefixRange(prefix))),
      ] as const;
    }).then((pair) => Promise.all(pair));
    return Object.fromEntries(
      keys.map((key, index) => [String(key).slice(prefix.length), String(values[index])]),
    );
  }

  async get(projectId: string, key: string): Promise<string | undefined> {
    const db = await this.#db();
    return transact(db, 'projects', 'readonly', (tx) =>
      request(
        tx.objectStore('projects').get(keyOf(projectId, key)) as IDBRequest<string | undefined>,
      ),
    );
  }

  async set(projectId: string, key: string, value: string): Promise<void> {
    await transact(await this.#db(), 'projects', 'readwrite', (tx) => {
      tx.objectStore('projects').put(value, keyOf(projectId, key));
    });
  }

  async delete(projectId: string, key: string): Promise<void> {
    await transact(await this.#db(), 'projects', 'readwrite', (tx) => {
      tx.objectStore('projects').delete(keyOf(projectId, key));
    });
  }
}
