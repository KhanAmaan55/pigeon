/**
 * `AppStateStore` on IndexedDB (docs/file-format.md §6): the `app` namespace in the `app` store,
 * `project:<id>` namespaces in `projects`; values are JSON text keyed `<namespace>\0<key>`.
 */

import type { AppStateNamespace, AppStateStore } from '@pigeon/platform';

import type { StoreName } from './idb';
import { prefixRange, request, transact } from './idb';

const storeFor = (ns: string): StoreName => (ns === 'app' ? 'app' : 'projects');
const keyOf = (ns: string, key: string) => `${ns}\u0000${key}`;

export class IdbAppState implements AppStateStore {
  readonly #db: () => Promise<IDBDatabase>;

  constructor(db: () => Promise<IDBDatabase>) {
    this.#db = db;
  }

  async get<T>(ns: AppStateNamespace, key: string): Promise<T | undefined> {
    const store = storeFor(ns);
    const db = await this.#db();
    const json = await transact(db, store, 'readonly', (tx) =>
      request(tx.objectStore(store).get(keyOf(ns, key)) as IDBRequest<string | undefined>),
    );
    if (json === undefined) return undefined;
    try {
      return JSON.parse(json) as T;
    } catch {
      // Unreadable: keep a copy under `<key>.bak-<time>` and start over (file-format.md §6).
      const backup = `${key}.bak-${Date.now()}`;
      await transact(db, store, 'readwrite', (tx) => {
        tx.objectStore(store).put(json, keyOf(ns, backup));
        tx.objectStore(store).delete(keyOf(ns, key));
      });
      return undefined;
    }
  }

  async set<T>(ns: AppStateNamespace, key: string, value: T): Promise<void> {
    const json = JSON.stringify(value);
    if (json === undefined)
      throw new TypeError(`App state "${ns}/${key}" is not JSON-serializable`);
    const store = storeFor(ns);
    await transact(await this.#db(), store, 'readwrite', (tx) => {
      tx.objectStore(store).put(json, keyOf(ns, key));
    });
  }

  async delete(ns: string, key: string): Promise<void> {
    const store = storeFor(ns);
    await transact(await this.#db(), store, 'readwrite', (tx) => {
      tx.objectStore(store).delete(keyOf(ns, key));
    });
  }

  async clearNamespace(ns: string): Promise<void> {
    const store = storeFor(ns);
    await transact(await this.#db(), store, 'readwrite', (tx) => {
      tx.objectStore(store).delete(prefixRange(keyOf(ns, '')));
    });
  }
}
