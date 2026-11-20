import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { readProject } from '@pigeon/formats';
import { MemoryAppState, MemoryFs } from '@pigeon/platform';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Draft, ProjectModel } from '../src/index';
import {
  applyCommand,
  applyDrafts,
  createDraft,
  findItem,
  LocalStateStore,
  placementOf,
  ProjectSession,
  UI_STATE_DEBOUNCE_MS,
} from '../src/index';

const fixtureDirectory = join(import.meta.dirname, '../../fixtures/projects/basic');

async function copyInto(fs: MemoryFs, local: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await copyInto(fs, join(local, entry.name), path);
    else await fs.writeFileAtomic(path, new Uint8Array(await readFile(join(local, entry.name))));
  }
}

async function fixtureFs(): Promise<MemoryFs> {
  const fs = new MemoryFs();
  await copyInto(fs, fixtureDirectory);
  return fs;
}

async function snapshot(fs: MemoryFs): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await fs.list('', { recursive: true })) {
    if (entry.kind === 'file') files.set(entry.path, await fs.readText(entry.path));
  }
  return files;
}

const noHash = () => null;

describe('createDraft / applyDrafts', () => {
  it('round-trips creates, updates, moves and deletes', async () => {
    const base = (await readProject(await fixtureFs())).model;
    let working: ProjectModel = base;
    for (const command of [
      { type: 'createFolder', id: 'f', parentId: 'billing-collection', name: 'Refunds', index: 0 },
      { type: 'createRequest', id: 'r', parentId: 'f', name: 'Refund' },
      { type: 'updateRequest', id: 'get-invoices', patch: { method: 'PUT' } },
      { type: 'moveItem', id: 'list-users', parentId: 'f', index: 0 },
      { type: 'deleteItem', id: 'admin-folder' },
      { type: 'createCollection', id: 'c', name: 'Shop', index: 0 },
    ] as const) {
      working = applyCommand(working, command);
    }
    const ids = [
      'f',
      'r',
      'get-invoices',
      'list-users',
      'admin-folder',
      'c',
      'billing-collection',
      'users-collection',
    ];
    const drafts = ids
      .map((id) => createDraft(base, working, id, noHash))
      .filter((d): d is Draft => d !== null);
    expect(drafts.map((d) => [d.ref.id, d.op])).toEqual([
      ['f', 'create'],
      ['r', 'create'],
      ['get-invoices', 'update'],
      ['list-users', 'update'],
      ['admin-folder', 'delete'],
      ['c', 'create'],
      ['billing-collection', 'update'],
      ['users-collection', 'update'],
    ]);
    // Order of the drafts doesn't matter: children wait for their parents.
    const { model, stale } = applyDrafts(base, [...drafts].reverse());
    expect(stale.map((d) => d.ref.id)).toEqual([]);
    expect(model).toEqual(working);
  });

  it('returns no draft for entities that match their file', async () => {
    const base = (await readProject(await fixtureFs())).model;
    const edited = applyCommand(base, {
      type: 'updateRequest',
      id: 'get-invoices',
      patch: { method: 'PUT' },
    });
    const reverted = applyCommand(edited, {
      type: 'updateRequest',
      id: 'get-invoices',
      patch: { method: 'GET' },
    });
    expect(createDraft(base, reverted, 'get-invoices', noHash)).toBeNull();
    expect(createDraft(base, base, 'nope', noHash)).toBeNull();
  });

  it('reports drafts it cannot apply as stale', async () => {
    const base = (await readProject(await fixtureFs())).model;
    const now = '2026-01-01T00:00:00.000Z';
    const drafts: Draft[] = [
      {
        ref: { kind: 'request', id: 'gone' },
        op: 'update',
        data: { name: 'x' },
        parentId: 'billing-collection',
        savedAt: now,
      },
      {
        ref: { kind: 'request', id: 'orphan' },
        op: 'create',
        data: { kind: 'request', id: 'orphan', name: 'o' },
        parentId: 'missing-folder',
        savedAt: now,
      },
      {
        ref: { kind: 'folder', id: 'list-users' },
        op: 'update',
        data: { name: 'kind changed' },
        savedAt: now,
      },
      { ref: { kind: 'request', id: 'no-data' }, op: 'create', savedAt: now },
      { ref: { kind: 'request', id: 'already-gone' }, op: 'delete', savedAt: now },
    ];
    const { model, stale } = applyDrafts(base, drafts);
    expect(stale.map((d) => d.ref.id).sort()).toEqual(['gone', 'list-users', 'no-data', 'orphan']);
    expect(model).toBe(base);
  });
});

describe('ProjectSession save (PIGN-018)', () => {
  it('saves edits as drafts that survive a restart without touching project files', async () => {
    const fs = await fixtureFs();
    const before = await snapshot(fs);
    const appState = new MemoryAppState();
    const session = await ProjectSession.fromFs(fs, { appState });

    session.apply({ type: 'updateRequest', id: 'get-invoices', patch: { method: 'PUT' } });
    session.apply({
      type: 'createFolder',
      id: 'f',
      parentId: 'billing-collection',
      name: 'Refunds',
    });
    session.apply({ type: 'createRequest', id: 'r', parentId: 'f', name: 'Refund' });
    session.apply({ type: 'deleteItem', id: 'pay-invoice' });
    expect(session.changeState('get-invoices')).toBe('unsaved');

    // Saving the new request saves its new folder (a structural prerequisite) too.
    await session.save(['r']);
    expect(session.changeState('r')).toBe('created');
    expect(session.changeState('f')).toBe('created');
    expect(session.changeState('get-invoices')).toBe('unsaved');
    await session.save();
    expect(session.changeState('get-invoices')).toBe('updated');
    expect(session.changeState('pay-invoice')).toBe('deleted');
    expect(session.drafts.find((d) => d.ref.id === 'get-invoices')?.baseHash).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(session.deletedEntities()).toEqual([
      {
        id: 'pay-invoice',
        name: 'Pay invoice',
        kind: 'request',
        parentId: 'billing-collection',
        method: 'POST',
      },
    ]);

    const restarted = await ProjectSession.fromFs(fs, { appState });
    expect(restarted.findRequest('get-invoices')?.method).toBe('PUT');
    expect(placementOf(restarted.getWorkingModel(), 'r')).toEqual({ parentId: 'f', index: 0 });
    expect(restarted.findRequest('pay-invoice')).toBeUndefined();
    expect(restarted.changeState('f')).toBe('created');
    expect(restarted.unsavedIds()).toEqual([]);
    expect(await snapshot(fs)).toEqual(before);
  });

  it('discards drafts back to the file version, including what a new folder contains', async () => {
    const fs = await fixtureFs();
    const appState = new MemoryAppState();
    const session = await ProjectSession.fromFs(fs, { appState });
    session.apply({ type: 'deleteItem', id: 'pay-invoice' });
    session.apply({
      type: 'createFolder',
      id: 'f',
      parentId: 'billing-collection',
      name: 'Refunds',
    });
    session.apply({ type: 'createRequest', id: 'r', parentId: 'f', name: 'Refund' });
    await session.save();

    await session.discard('pay-invoice');
    expect(placementOf(session.getWorkingModel(), 'pay-invoice')).toEqual({
      parentId: 'billing-collection',
      index: 1,
    });
    await session.discard('f');
    expect(findItem(session.getWorkingModel(), 'r')).toBeUndefined();
    expect(session.drafts.map((d) => d.ref.id)).toEqual(['billing-collection']);

    const restarted = await ProjectSession.fromFs(fs, { appState });
    expect(findItem(restarted.getWorkingModel(), 'f')).toBeUndefined();
    expect(restarted.findRequest('pay-invoice')).toBeDefined();
  });

  it('discarding unsaved edits returns to the saved draft', async () => {
    const session = await ProjectSession.fromFs(await fixtureFs(), {
      appState: new MemoryAppState(),
    });
    session.apply({ type: 'updateRequest', id: 'get-invoices', patch: { method: 'PUT' } });
    await session.save();
    session.apply({ type: 'updateRequest', id: 'get-invoices', patch: { method: 'DELETE' } });
    session.discardUnsaved('get-invoices');
    expect(session.findRequest('get-invoices')?.method).toBe('PUT');
    expect(session.changeState('get-invoices')).toBe('updated');
  });

  it('keeps stale drafts and drafts across a reload', async () => {
    const fs = await fixtureFs();
    const appState = new MemoryAppState();
    const session = await ProjectSession.fromFs(fs, { appState });
    session.apply({ type: 'updateRequest', id: 'get-audit', patch: { method: 'HEAD' } });
    await session.save();
    await fs.remove('collections/users-api/admin', { recursive: true });

    const restarted = await ProjectSession.fromFs(fs, { appState });
    expect(restarted.staleDrafts.map((d) => d.ref.id)).toEqual(['get-audit']);
    await fs.writeFileAtomic(
      'collections/billing/x.request.json',
      '{"id":"x","name":"X","request":{"method":"GET","url":"/x"}}',
    );
    await restarted.reload();
    expect(restarted.findRequest('x')).toBeDefined();
    expect(restarted.staleDrafts).toHaveLength(1);
  });

  it('cannot save without local state', async () => {
    const session = await ProjectSession.fromFs(await fixtureFs());
    await expect(session.save()).rejects.toThrow(/no local state/);
    expect(session.localState).toBeUndefined();
  });
});

describe('LocalStateStore', () => {
  afterEach(() => vi.useRealTimers());

  it('debounces UI state and writes drafts immediately', async () => {
    vi.useFakeTimers();
    const appState = new MemoryAppState();
    const { store } = await LocalStateStore.load(appState, 'p');
    await store.update({ layout: { responsePanel: 'right' } });
    expect(await appState.get('project:p', 'state')).toBeUndefined();
    vi.advanceTimersByTime(UI_STATE_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    expect(await appState.get('project:p', 'state')).toMatchObject({
      layout: { responsePanel: 'right' },
    });

    await store.update({ tabs: { open: [{ id: 'a', pinned: true }], activeId: 'a' } });
    await store.flush();
    expect(await appState.get('project:p', 'state')).toMatchObject({ tabs: { activeId: 'a' } });
    await store.update({ drafts: [] }, { immediate: true });
    expect((await LocalStateStore.load(appState, 'p')).store.state.tabs.activeId).toBe('a');
  });

  it('backs up and resets an unreadable state; keeps unknown keys of a valid one', async () => {
    const appState = new MemoryAppState();
    await appState.set('project:p', 'state', { schemaVersion: 99, junk: true });
    const loaded = await LocalStateStore.load(
      appState,
      'p',
      () => new Date('2026-02-03T04:05:06.007Z'),
    );
    expect(loaded.backedUpAs).toBe('state.bak-2026-02-03T04-05-06-007Z');
    expect(await appState.get('project:p', 'state.bak-2026-02-03T04-05-06-007Z')).toEqual({
      schemaVersion: 99,
      junk: true,
    });
    expect(await appState.get('project:p', 'state')).toBeUndefined();
    expect(loaded.store.state.drafts).toEqual([]);

    await loaded.store.update({ currentValues: { env: {} } }, { immediate: true });
    const again = await LocalStateStore.load(appState, 'p');
    expect(again.backedUpAs).toBeUndefined();
    expect(again.store.state['currentValues']).toEqual({ env: {} });
  });

  it('backs up the state of a session whose local state is corrupt and opens clean', async () => {
    const fs = await fixtureFs();
    const appState = new MemoryAppState();
    await appState.set('project:project-basic', 'state', 'not an object');
    const session = await ProjectSession.fromFs(fs, { appState });
    expect(session.localStateBackup).toMatch(/^state\.bak-/);
    expect(session.drafts).toEqual([]);
  });
});
