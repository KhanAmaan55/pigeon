import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { readProject, serializeProject } from '@pigeon/formats';
import { MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { EditCommand, ProjectModel } from '../src/index';
import {
  applyCommand,
  findItem,
  isSameOrDescendant,
  placementOf,
  ProjectSession,
  touchedIds,
} from '../src/index';

const fixtureDirectory = join(import.meta.dirname, '../../fixtures/projects/basic');
const goldenDirectory = join(import.meta.dirname, '../../fixtures/projects/after-operations');
const decoder = new TextDecoder();

async function copyInto(fs: MemoryFs, local: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await copyInto(fs, join(local, entry.name), path);
    else await fs.writeFileAtomic(path, new Uint8Array(await readFile(join(local, entry.name))));
  }
}

async function fixtureModel(): Promise<ProjectModel> {
  const fs = new MemoryFs();
  await copyInto(fs, fixtureDirectory);
  return (await readProject(fs)).model;
}

let counter = 0;
const context = { newId: () => `new-${++counter}` };
const apply = (model: ProjectModel, ...commands: EditCommand[]) =>
  commands.reduce((current, command) => applyCommand(current, command, context), model);
const keys = (model: ProjectModel, containerId: string) =>
  (
    model.collections.find((c) => c.id === containerId) ??
    (findItem(model, containerId) as { children: { fileKey: string }[] })
  ).children.map((c) => c.fileKey);

describe('create', () => {
  it('creates collections, folders and requests with allocated slugs', async () => {
    const model = apply(
      await fixtureModel(),
      { type: 'createCollection', id: 'c1', name: 'Users API' },
      { type: 'createFolder', id: 'f1', parentId: 'users-collection', name: 'Admin' },
      {
        type: 'createRequest',
        id: 'r1',
        parentId: 'users-collection',
        name: 'List Users',
        index: 0,
      },
      {
        type: 'createRequest',
        id: 'r2',
        parentId: 'f1',
        name: 'ユーザー',
        request: { method: 'POST' },
      },
    );
    expect(model.collections.map((c) => c.fileKey)).toEqual([
      'users-api',
      'billing',
      'users-api-2',
    ]);
    expect(keys(model, 'users-collection')).toEqual([
      'list-users-2',
      'list-users',
      'admin',
      'create-user',
      'admin-2',
    ]);
    expect(findItem(model, 'r2')).toMatchObject({
      kind: 'request',
      method: 'POST',
      fileKey: 'request-r2',
      name: 'ユーザー',
    });
    expect(findItem(model, 'r1')).toMatchObject({
      method: 'GET',
      body: { mode: 'none' },
      url: { raw: '' },
    });
  });

  it('rejects duplicate ids, unknown parents and broken containers', async () => {
    const model = await fixtureModel();
    expect(() =>
      apply(model, {
        type: 'createFolder',
        id: 'list-users',
        parentId: 'users-collection',
        name: 'x',
      }),
    ).toThrow(/already exists/);
    expect(() =>
      apply(model, { type: 'createRequest', id: 'x', parentId: 'list-users', name: 'x' }),
    ).toThrow(/No collection or folder/);
    const broken = { ...model, collections: [{ ...model.collections[0]!, broken: true as const }] };
    expect(() =>
      apply(broken, { type: 'createRequest', id: 'x', parentId: 'users-collection', name: 'x' }),
    ).toThrow(/read-only/);
  });
});

describe('rename', () => {
  it('re-slugs the entity from its new name', async () => {
    const model = apply(
      await fixtureModel(),
      { type: 'renameItem', id: 'list-users', name: 'Get user by id' },
      { type: 'renameItem', id: 'billing-collection', name: '  Invoices  ' },
      { type: 'renameItem', id: 'create-user', name: 'Admin' },
    );
    expect(findItem(model, 'list-users')).toMatchObject({
      name: 'Get user by id',
      fileKey: 'get-user-by-id',
    });
    expect(model.collections[1]).toMatchObject({ name: 'Invoices', fileKey: 'invoices' });
    expect(findItem(model, 'create-user')?.fileKey).toBe('admin-2');
    expect(() => apply(model, { type: 'renameItem', id: 'list-users', name: ' ' })).toThrow(
      /empty/,
    );
  });
});

describe('duplicate', () => {
  it('deep-copies with new ids next to the original', async () => {
    const model = apply(
      await fixtureModel(),
      { type: 'duplicateItem', id: 'admin-folder', newId: 'admin-copy' },
      { type: 'duplicateItem', id: 'billing-collection', newId: 'billing-copy' },
    );
    expect(keys(model, 'users-collection')).toEqual([
      'list-users',
      'admin',
      'admin-copy',
      'create-user',
    ]);
    const copy = findItem(model, 'admin-copy');
    expect(copy).toMatchObject({ name: 'Admin copy', kind: 'folder' });
    const ids = JSON.stringify(copy).match(/"id":"[^"]+"/g)!;
    expect(ids.some((id) => id.includes('delete-user') || id.includes('nested-folder'))).toBe(
      false,
    );
    expect(model.collections.map((c) => c.name)).toEqual([
      'Users API',
      'Billing API',
      'Billing API copy',
    ]);
    expect(model.collections[2]!.children.map((c) => c.fileKey)).toEqual([
      'get-invoices',
      'pay-invoice',
    ]);
  });
});

describe('delete', () => {
  it('removes requests, folders (recursively) and collections', async () => {
    const model = apply(
      await fixtureModel(),
      { type: 'deleteItem', id: 'admin-folder' },
      { type: 'deleteItem', id: 'billing-collection' },
    );
    expect(findItem(model, 'get-audit')).toBeUndefined();
    expect(model.collections.map((c) => c.id)).toEqual(['users-collection']);
    expect(() => apply(model, { type: 'deleteItem', id: 'nope' })).toThrow(/No item/);
  });
});

describe('move', () => {
  it('moves into folders, reorders within a container and allocates on collisions', async () => {
    let model = apply(
      await fixtureModel(),
      { type: 'createRequest', id: 'x', parentId: 'admin-folder', name: 'List users' },
      { type: 'moveItem', id: 'list-users', parentId: 'admin-folder', index: 0 },
    );
    expect(keys(model, 'admin-folder')).toEqual([
      'list-users-2',
      'delete-user',
      'nested',
      'list-users',
    ]);
    expect(findItem(model, 'list-users')?.fileKey).toBe('list-users-2');

    model = apply(model, {
      type: 'moveItem',
      id: 'delete-user',
      parentId: 'admin-folder',
      index: 4,
    });
    expect(keys(model, 'admin-folder')).toEqual([
      'list-users-2',
      'nested',
      'list-users',
      'delete-user',
    ]);
    model = apply(model, {
      type: 'moveItem',
      id: 'get-invoices',
      parentId: 'nested-folder',
      index: 0,
    });
    expect(keys(model, 'nested-folder')).toEqual(['get-invoices', 'get-audit']);
    expect(findItem(model, 'get-invoices')?.fileKey).toBe('get-invoices');
  });

  it('rejects moving a folder into itself or its descendants', async () => {
    const model = await fixtureModel();
    expect(isSameOrDescendant(model, 'nested-folder', 'admin-folder')).toBe(true);
    expect(() =>
      apply(model, { type: 'moveItem', id: 'admin-folder', parentId: 'nested-folder', index: 0 }),
    ).toThrow(/into itself/);
    expect(() =>
      apply(model, { type: 'moveItem', id: 'admin-folder', parentId: 'admin-folder', index: 0 }),
    ).toThrow(/into itself/);
    expect(() =>
      apply(model, {
        type: 'moveItem',
        id: 'users-collection',
        parentId: 'admin-folder',
        index: 0,
      }),
    ).toThrow(/moveCollection/);
    expect(() =>
      apply(model, { type: 'moveItem', id: 'list-users', parentId: 'nope', index: 0 }),
    ).toThrow(/No collection or folder/);
  });

  it('reorders collections', async () => {
    const model = apply(await fixtureModel(), {
      type: 'moveCollection',
      id: 'users-collection',
      index: 2,
    });
    expect(model.collections.map((c) => c.fileKey)).toEqual(['billing', 'users-api']);
    expect(
      apply(model, { type: 'moveCollection', id: 'users-collection', index: 0 }).collections[0]!.id,
    ).toBe('users-collection');
    expect(() => apply(model, { type: 'moveCollection', id: 'x', index: 0 })).toThrow(
      /No collection/,
    );
  });
});

describe('touched ids and placement', () => {
  it('names the entity and the containers whose order changes', async () => {
    const model = await fixtureModel();
    expect(
      touchedIds(model, {
        type: 'moveItem',
        id: 'delete-user',
        parentId: 'users-collection',
        index: 0,
      }),
    ).toEqual(['delete-user', 'users-collection', 'admin-folder']);
    expect(touchedIds(model, { type: 'deleteItem', id: 'get-audit' })).toEqual([
      'get-audit',
      'nested-folder',
    ]);
    expect(
      touchedIds(model, { type: 'createRequest', id: 'n', parentId: 'admin-folder', name: 'n' }),
    ).toEqual(['n', 'admin-folder']);
    expect(touchedIds(model, { type: 'duplicateItem', id: 'get-audit', newId: 'd' })).toEqual([
      'd',
      'nested-folder',
    ]);
    expect(placementOf(model, 'billing-collection')).toEqual({ parentId: null, index: 1 });
    expect(placementOf(model, 'get-audit')).toEqual({ parentId: 'nested-folder', index: 0 });
    expect(placementOf(model, 'nope')).toBeUndefined();
  });
});

describe('session: structural edits and discard', () => {
  it('tracks structural edits as unsaved and restores file versions on discard', async () => {
    const fs = new MemoryFs();
    await copyInto(fs, fixtureDirectory);
    const session = await ProjectSession.fromFs(fs);

    session.apply({ type: 'deleteItem', id: 'get-audit' });
    session.apply({ type: 'createRequest', id: 'n', parentId: 'billing-collection', name: 'New' });
    session.apply({ type: 'renameItem', id: 'billing-collection', name: 'Invoices' });
    expect(session.unsavedIds().sort()).toEqual([
      'billing-collection',
      'get-audit',
      'n',
      'nested-folder',
    ]);

    session.discardUnsaved('get-audit');
    expect(placementOf(session.getWorkingModel(), 'get-audit')).toEqual({
      parentId: 'nested-folder',
      index: 0,
    });
    session.discardUnsaved('n');
    expect(findItem(session.getWorkingModel(), 'n')).toBeUndefined();
    session.discardUnsaved('billing-collection');
    expect(session.getWorkingModel().collections[1]).toMatchObject({
      name: 'Billing API',
      fileKey: 'billing',
    });

    session.apply({ type: 'deleteItem', id: 'billing-collection' });
    session.discardUnsaved('billing-collection');
    expect(session.getWorkingModel().collections.map((c) => c.id)).toEqual([
      'users-collection',
      'billing-collection',
    ]);
    session.apply({ type: 'createCollection', id: 'c-new', name: 'New' });
    session.discardUnsaved('c-new');
    expect(session.getWorkingModel().collections).toHaveLength(2);
  });
});

describe('golden: serialize after a sequence of operations', () => {
  it('matches packages/fixtures/projects/after-operations', async () => {
    counter = 0;
    const model = apply(
      await fixtureModel(),
      { type: 'createCollection', id: 'orders-collection', name: 'Orders', index: 1 },
      { type: 'createFolder', id: 'orders-admin', parentId: 'orders-collection', name: 'Admin' },
      {
        type: 'createRequest',
        id: 'list-orders',
        parentId: 'orders-collection',
        name: 'List orders',
        index: 0,
        request: {
          method: 'GET',
          url: { raw: '{{baseUrl}}/orders', query: [], pathVariables: [], extra: {} },
        },
      },
      { type: 'renameItem', id: 'list-users', name: 'Get user by id' },
      { type: 'moveItem', id: 'delete-user', parentId: 'orders-admin', index: 0 },
      { type: 'duplicateItem', id: 'pay-invoice', newId: 'pay-invoice-copy' },
      { type: 'deleteItem', id: 'nested-folder' },
      { type: 'moveCollection', id: 'billing-collection', index: 0 },
    );
    const files = serializeProject(model);
    if (process.env['UPDATE_GOLDEN'] === '1') {
      await rm(goldenDirectory, { recursive: true, force: true });
      for (const [path, bytes] of files) {
        await mkdir(dirname(join(goldenDirectory, path)), { recursive: true });
        await writeFile(join(goldenDirectory, path), bytes);
      }
      return;
    }
    const golden = new MemoryFs();
    await copyInto(golden, goldenDirectory);
    const expected = new Map<string, string>();
    for (const entry of await golden.list('', { recursive: true })) {
      if (entry.kind === 'file') expected.set(entry.path, await golden.readText(entry.path));
    }
    expect([...files.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [path, bytes] of files) expect(decoder.decode(bytes), path).toBe(expected.get(path));
  });
});
