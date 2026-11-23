/**
 * The `pigeon` IndexedDB database (docs/file-format.md §6): `app` and `projects` (local app
 * state), `handles` (persisted folder handles), `workspaces` and `blobs` (browser workspaces),
 * `history` and `historyIndex` (request history, PIGN-051; added in version 2).
 */

export const DB_NAME = 'pigeon';
const DB_VERSION = 2;
export const STORES = [
  'app',
  'projects',
  'handles',
  'workspaces',
  'blobs',
  'history',
  'historyIndex',
] as const;
export type StoreName = (typeof STORES)[number];

export function openPigeonDb(
  factory: IDBFactory = indexedDB,
  name = DB_NAME,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      for (const store of STORES) {
        if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store);
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('IndexedDB could not be opened'));
    open.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Runs `work` in one transaction and resolves when it commits. `work` must issue its requests
 * synchronously (awaiting anything else would let the transaction auto-commit early).
 */
export function transact<T>(
  db: IDBDatabase,
  stores: StoreName | StoreName[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    try {
      result = work(tx);
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}

/** Keys `prefix…` (all strings starting with `prefix`). */
export function prefixRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, `${prefix}￿`);
}
