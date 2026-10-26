import { describe, expect, it } from 'vitest';

import {
  createMemoryPlatform,
  defineCapabilities,
  MEMORY_CAPABILITIES,
  MemoryAppState,
  MemorySecretStore,
} from '../src/index';

describe('capabilities', () => {
  it('are frozen', () => {
    const capabilities = defineCapabilities({ ...MEMORY_CAPABILITIES });
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(() => {
      (capabilities as { bypassesCors: boolean }).bypassesCors = false;
    }).toThrow(TypeError);
  });

  it('can be overridden per memory platform', () => {
    const platform = createMemoryPlatform({ capabilities: { bypassesCors: false }, os: 'linux' });
    expect(platform.kind).toBe('memory');
    expect(platform.os).toBe('linux');
    expect(platform.capabilities.bypassesCors).toBe(false);
    expect(platform.capabilities.transport).toBe(MEMORY_CAPABILITIES.transport);
    expect(Object.isFrozen(platform.capabilities)).toBe(true);
  });
});

describe('MemoryAppState', () => {
  it('stores JSON copies per namespace', async () => {
    const state = new MemoryAppState();
    const value = { tabs: ['a'] };
    await state.set('app', 'layout', value);
    value.tabs.push('b');

    expect(await state.get('app', 'layout')).toEqual({ tabs: ['a'] });
    expect(await state.get('project:p1', 'layout')).toBeUndefined();

    await state.set('project:p1', 'drafts', 1);
    await state.set('project:p1', 'tabs', 2);
    await state.delete('project:p1', 'drafts');
    expect(await state.get('project:p1', 'drafts')).toBeUndefined();
    await state.clearNamespace('project:p1');
    expect(await state.get('project:p1', 'tabs')).toBeUndefined();
    expect(await state.get('app', 'layout')).toEqual({ tabs: ['a'] });
  });

  it('rejects values JSON cannot represent', async () => {
    await expect(new MemoryAppState().set('app', 'x', undefined)).rejects.toThrow(TypeError);
  });
});

describe('MemorySecretStore', () => {
  it('keeps secrets per project', async () => {
    const secrets = new MemorySecretStore();
    expect(secrets.backend).toBe('memory');
    await secrets.set('p1', 'token', 's3cret');
    expect(await secrets.get('p1', 'token')).toBe('s3cret');
    expect(await secrets.get('p2', 'token')).toBeUndefined();
    await secrets.delete('p1', 'token');
    expect(await secrets.get('p1', 'token')).toBeUndefined();
  });
});

describe('memory platform services', () => {
  it('creates, reopens and opens memory projects', async () => {
    const platform = createMemoryPlatform();
    const loc = await platform.projects.createProject('Demo');
    expect(loc).toMatchObject({ kind: 'memory' });
    expect(await platform.projects.reopen(loc)).toBe('ok');
    expect(await platform.projects.reopen({ kind: 'memory', id: 'nope' })).toBe('missing');

    const fs = await platform.openProjectFs(loc);
    await fs.writeFileAtomic('pigeon.json', '{}');
    expect(await (await platform.openProjectFs(loc)).readText('pigeon.json')).toBe('{}');
    await expect(
      platform.openProjectFs({ kind: 'native', absolutePath: '/x' }),
    ).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('cancels pickers and confirm dialogs by default, and records what was shown or saved', async () => {
    const { dialogs, files, projects } = createMemoryPlatform();
    expect(await projects.pickProjectFolder()).toBeNull();
    expect(await dialogs.confirm({ title: 'Delete?', message: 'Really?' })).toBe(false);
    expect(dialogs.shown).toEqual([
      { type: 'confirm', opts: { title: 'Delete?', message: 'Really?' } },
    ]);

    expect(await files.pickFiles()).toEqual([]);
    files.queuePick([{ name: 'a.json', bytes: new Uint8Array([123, 125]) }]);
    expect(await files.pickFiles()).toEqual([
      { name: 'a.json', bytes: new Uint8Array([123, 125]) },
    ]);

    expect(await files.saveFile('out.json', '{}', 'application/json')).toBe('saved');
    expect(files.saved).toEqual([{ name: 'out.json', data: '{}', mime: 'application/json' }]);
  });
});
