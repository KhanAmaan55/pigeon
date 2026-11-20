import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { openPigeonDb } from '../src/idb';
import type { HandleRecord } from '../src/project-locator';
import { WebProjectLocator } from '../src/project-locator';
import { FakeDirectory } from './fake-handles';

let counter = 0;

function locator(
  opts: { picked?: FakeDirectory | 'abort'; permission?: 'granted' | 'prompt' } = {},
) {
  const db = openPigeonDb(indexedDB, `pigeon-locator-${counter++}`);
  const permissions: string[] = [];
  const decorate = (dir: FakeDirectory) =>
    Object.assign(dir, {
      queryPermission: async () => opts.permission ?? 'granted',
      requestPermission: async () => {
        permissions.push('requested');
        return 'granted';
      },
    });
  const persisted: boolean[] = [];
  const handles = new Map<string, HandleRecord>();
  const web = new WebProjectLocator({
    db: () => db,
    handles: {
      get: async (key) => handles.get(key),
      put: async (key, record) => void handles.set(key, record),
    },
    ...(opts.picked
      ? {
          pickDirectory: async () => {
            if (opts.picked === 'abort')
              throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
            return decorate(opts.picked!).asHandle();
          },
        }
      : {}),
    persistStorage: async () => {
      persisted.push(true);
      return true;
    },
  });
  return { web, permissions, persisted };
}

describe('WebProjectLocator', () => {
  it('opens a picked folder, persists its handle and reopens it', async () => {
    const folder = new FakeDirectory('my-api');
    const { web } = locator({ picked: folder });
    const location = await web.pickProjectFolder();
    expect(location).toMatchObject({ kind: 'fs-access', name: 'my-api' });

    const fs = await web.open(location!);
    await fs.writeFileAtomic('pigeon.json', '{}');
    expect(folder.children.has('pigeon.json')).toBe(true);
    expect(await web.reopen(location!)).toBe('ok');
    expect(await web.reopen({ kind: 'fs-access', handleKey: 'unknown', name: 'x' })).toBe(
      'missing',
    );
  });

  it('asks for permission again after a reload (Reconnect)', async () => {
    const { web, permissions } = locator({
      picked: new FakeDirectory('repo'),
      permission: 'prompt',
    });
    const location = (await web.pickProjectFolder())!;
    expect(await web.reopen(location)).toBe('needs-permission');
    expect(await web.requestPermission(location)).toBe(true);
    expect(permissions).toEqual(['requested']);
    expect(
      await web.requestPermission({ kind: 'browser-workspace', workspaceId: 'w', name: 'w' }),
    ).toBe(false);
  });

  it('simulates permission prompts for E2E builds', async () => {
    const { web, permissions } = locator({ picked: new FakeDirectory('repo') });
    const location = (await web.pickProjectFolder())!;
    web.permissionOverride = 'prompt';
    expect(await web.reopen(location)).toBe('needs-permission');
    expect(await web.requestPermission(location)).toBe(true);
    expect(await web.reopen(location)).toBe('ok');
    expect(permissions).toEqual([]);
  });

  it('treats a cancelled picker as null and creates new folders inside the picked parent', async () => {
    expect(await locator({ picked: 'abort' }).web.pickProjectFolder()).toBeNull();
    const parent = new FakeDirectory('code');
    const { web } = locator({ picked: parent });
    const location = await web.createProject('Shop API');
    expect(location).toMatchObject({ kind: 'fs-access', name: 'Shop API' });
    expect(parent.children.has('Shop API')).toBe(true);

    await (parent.children.get('Shop API') as FakeDirectory).getFileHandle('x', { create: true });
    const again = locator({ picked: parent }).web;
    await expect(again.createProject('Shop API')).rejects.toThrow(/not empty/);
  });

  it('creates browser workspaces without folder access and asks to persist storage once', async () => {
    const { web, persisted } = locator();
    expect(web.canPickFolders).toBe(false);
    expect(web.storagePersisted()).toBeUndefined();
    const location = await web.createProject('Notes');
    expect(location).toMatchObject({ kind: 'browser-workspace', name: 'Notes' });
    await web.createBrowserWorkspace('Other');
    await Promise.resolve();
    expect(persisted).toEqual([true]);
    expect(web.storagePersisted()).toBe(true);

    const fs = await web.open(location!);
    await fs.writeFileAtomic('pigeon.json', '{}');
    expect(await (await web.open(location!)).readText('pigeon.json')).toBe('{}');
    expect(await web.reopen(location!)).toBe('ok');
    expect(await web.reopen({ kind: 'browser-workspace', workspaceId: 'nope', name: 'x' })).toBe(
      'missing',
    );
    await expect(
      web.open({ kind: 'browser-workspace', workspaceId: 'nope', name: 'x' }),
    ).rejects.toThrow(/no longer exists/);
    await expect(web.open({ kind: 'native', absolutePath: '/x' })).rejects.toThrow(/cannot open/);
    expect(await web.reopen({ kind: 'memory', id: 'x' })).toBe('missing');
  });

  it('uses a test-injected handle for the next pick', async () => {
    const { web } = locator();
    web.nextPickedHandle = new FakeDirectory('opfs').asHandle();
    expect(web.canPickFolders).toBe(true);
    expect(await web.pickProjectFolder()).toMatchObject({ name: 'opfs' });
    expect(await web.pickProjectFolder()).toBeNull();
  });
});
