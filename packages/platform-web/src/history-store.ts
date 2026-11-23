/**
 * `HistoryStore` in IndexedDB (PIGN-051): `historyIndex` holds `{ seq, summary }` and `history`
 * the full entry, both keyed `<projectKey>/<id>`. `seq` keeps append order across reloads.
 */

import type { HistoryRecord, HistoryStore } from '@pigeon/platform';

import { prefixRange, request, transact } from './idb';

interface IndexRow {
  seq: number;
  summary: unknown;
}

const keyOf = (projectKey: string, id: string) => `${projectKey}/${id}`;

export class IdbHistoryStore implements HistoryStore {
  readonly #db: () => Promise<IDBDatabase>;
  #last = 0;

  constructor(db: () => Promise<IDBDatabase>) {
    this.#db = db;
  }

  /** Increasing even within one millisecond. */
  #seq(): number {
    this.#last = Math.max(this.#last + 1, Date.now() * 1000);
    return this.#last;
  }

  async append(projectKey: string, records: readonly HistoryRecord[]): Promise<void> {
    if (records.length === 0) return;
    const db = await this.#db();
    await transact(db, ['history', 'historyIndex'], 'readwrite', (tx) => {
      for (const record of records) {
        const key = keyOf(projectKey, record.id);
        tx.objectStore('history').put(record.entry, key);
        tx.objectStore('historyIndex').put(
          { seq: this.#seq(), summary: record.summary } satisfies IndexRow,
          key,
        );
      }
    });
  }

  async list(projectKey: string): Promise<unknown[]> {
    const db = await this.#db();
    const rows = await transact(db, 'historyIndex', 'readonly', (tx) =>
      request(tx.objectStore('historyIndex').getAll(prefixRange(`${projectKey}/`))),
    );
    return (rows as IndexRow[]).sort((a, b) => a.seq - b.seq).map((row) => row.summary);
  }

  async get(projectKey: string, id: string): Promise<unknown> {
    const db = await this.#db();
    return transact(db, 'history', 'readonly', (tx) =>
      request(tx.objectStore('history').get(keyOf(projectKey, id))),
    );
  }

  async remove(projectKey: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.#db();
    await transact(db, ['history', 'historyIndex'], 'readwrite', (tx) => {
      for (const id of ids) {
        tx.objectStore('history').delete(keyOf(projectKey, id));
        tx.objectStore('historyIndex').delete(keyOf(projectKey, id));
      }
    });
  }

  async clear(projectKey: string): Promise<void> {
    const db = await this.#db();
    await transact(db, ['history', 'historyIndex'], 'readwrite', (tx) => {
      tx.objectStore('history').delete(prefixRange(`${projectKey}/`));
      tx.objectStore('historyIndex').delete(prefixRange(`${projectKey}/`));
    });
  }
}
