import 'fake-indexeddb/auto';

import type { HistoryStore } from '@pigeon/platform';
import { MemoryHistoryStore } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import { IdbHistoryStore } from '../src/history-store';
import { openPigeonDb, request } from '../src/idb';

let counter = 0;
const freshDb = () => openPigeonDb(indexedDB, `pigeon-history-${counter++}`);

const record = (id: string) => ({
  id,
  summary: { id, url: `http://x.test/${id}` },
  entry: { id, body: 'é'.repeat(3) },
});

function conformance(name: string, create: () => HistoryStore) {
  describe(`${name} (PIGN-051)`, () => {
    it('appends in order, per project; get, remove, clear', async () => {
      const store = create();
      await store.append('p1', [record('a'), record('b')]);
      await store.append('p1', [record('c')]);
      await store.append('p10', [record('z')]);
      expect((await store.list('p1')).map((s) => (s as { id: string }).id)).toEqual([
        'a',
        'b',
        'c',
      ]);
      expect(await store.get('p1', 'b')).toEqual({ id: 'b', body: 'ééé' });
      expect(await store.get('p1', 'z')).toBeUndefined();
      await store.remove('p1', ['a', 'c']);
      expect(await store.list('p1')).toEqual([{ id: 'b', url: 'http://x.test/b' }]);
      await store.clear('p1');
      expect(await store.list('p1')).toEqual([]);
      expect(await store.get('p1', 'b')).toBeUndefined();
      expect(await store.list('p10')).toHaveLength(1);
    });
  });
}

conformance('MemoryHistoryStore', () => new MemoryHistoryStore());
conformance('IdbHistoryStore', () => {
  const db = freshDb();
  return new IdbHistoryStore(() => db);
});

describe('IndexedDB upgrade', () => {
  it('version 2 adds the history stores and keeps existing data', async () => {
    const name = `pigeon-upgrade-${counter++}`;
    const v1 = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => {
        for (const store of ['app', 'projects', 'handles', 'workspaces', 'blobs']) {
          open.result.createObjectStore(store);
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await request(
      v1.transaction('app', 'readwrite').objectStore('app').put({ theme: 'dark' }, 'k'),
    );
    v1.close();
    const db = await openPigeonDb(indexedDB, name);
    expect([...db.objectStoreNames]).toEqual(
      expect.arrayContaining(['app', 'history', 'historyIndex']),
    );
    expect(await request(db.transaction('app').objectStore('app').get('k'))).toEqual({
      theme: 'dark',
    });
  });
});
