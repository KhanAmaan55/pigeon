import 'fake-indexeddb/auto';

import { fsConformance } from '@pigeon/platform/conformance';
import { describe, expect, it } from 'vitest';

import { FsAccessFs } from '../src/fs-access-fs';
import { openPigeonDb } from '../src/idb';
import { IdbAppState } from '../src/idb-app-state';
import { deleteWorkspace, IdbFs } from '../src/idb-fs';
import { FakeDirectory } from './fake-handles';

let dbCounter = 0;
const freshDb = () => openPigeonDb(indexedDB, `pigeon-test-${dbCounter++}`);

fsConformance('IdbFs (fake-indexeddb)', async () => IdbFs.open(await freshDb(), 'ws', 'Workspace'));

fsConformance(
  'FsAccessFs (fake handles)',
  () =>
    new FsAccessFs(new FakeDirectory('root').asHandle(), {
      kind: 'fs-access',
      handleKey: 'k',
      name: 'root',
    }),
);

describe('IdbFs persistence', () => {
  it('reloads exactly what was written, per workspace', async () => {
    const db = await freshDb();
    const fs = await IdbFs.open(db, 'one', 'One');
    await fs.writeFileAtomic('collections/a/collection.json', '{"a":1}');
    await fs.writeFileAtomic('bin.dat', new Uint8Array([0, 255]));
    await fs.mkdirp('examples/empty');
    await fs.rename('collections/a', 'collections/b');
    await fs.writeFileAtomic('gone.txt', 'x');
    await fs.remove('gone.txt');
    const other = await IdbFs.open(db, 'two', 'Two');
    await other.writeFileAtomic('pigeon.json', '{}');

    const reopened = await IdbFs.open(db, 'one', 'One');
    expect(reopened.root).toEqual({ kind: 'browser-workspace', workspaceId: 'one', name: 'One' });
    expect(await reopened.list('', { recursive: true })).toEqual([
      { path: 'bin.dat', kind: 'file' },
      { path: 'collections', kind: 'dir' },
      { path: 'collections/b', kind: 'dir' },
      { path: 'collections/b/collection.json', kind: 'file' },
      { path: 'examples', kind: 'dir' },
      { path: 'examples/empty', kind: 'dir' },
    ]);
    expect(await reopened.readFile('bin.dat')).toEqual(new Uint8Array([0, 255]));

    await deleteWorkspace(db, 'one');
    expect(await (await IdbFs.open(db, 'one', 'One')).list('')).toEqual([]);
    expect(await (await IdbFs.open(db, 'two', 'Two')).readText('pigeon.json')).toBe('{}');
  });
});

describe('IdbAppState', () => {
  it('stores JSON per namespace and survives a new instance', async () => {
    const db = await freshDb();
    const state = new IdbAppState(async () => db);
    await state.set('app', 'recentProjects', [{ name: 'A' }]);
    await state.set('project:p1', 'tabs', { open: [1] });
    await state.set('project:p2', 'tabs', { open: [2] });
    expect(await new IdbAppState(async () => db).get('app', 'recentProjects')).toEqual([
      { name: 'A' },
    ]);

    await state.clearNamespace('project:p1');
    expect(await state.get('project:p1', 'tabs')).toBeUndefined();
    expect(await state.get('project:p2', 'tabs')).toEqual({ open: [2] });
    await state.delete('project:p2', 'tabs');
    expect(await state.get('project:p2', 'tabs')).toBeUndefined();
    await expect(state.set('app', 'f', () => 1)).rejects.toThrow(TypeError);
  });
});
