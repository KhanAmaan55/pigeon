import { describe, expect, it } from 'vitest';

import { FileAppState } from '../src/app-state';
import type { Invoke } from '../src/native-transport';

function fakeDisk(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const backups: string[] = [];
  const invoke: Invoke = async <T>(cmd: string, args?: Record<string, unknown> | Uint8Array) => {
    const { namespace, json } = args as { namespace: string; json?: string | null };
    if (cmd === 'app_state_read') return (files.get(namespace) ?? null) as T;
    if (cmd === 'app_state_backup') {
      backups.push(namespace);
      files.delete(namespace);
      return 'state.json.bak-1' as T;
    }
    if (json === null) files.delete(namespace);
    else files.set(namespace, json as string);
    return undefined as T;
  };
  return { files, invoke, backups };
}

describe('FileAppState', () => {
  it('persists documents per namespace and survives a restart', async () => {
    const disk = fakeDisk();
    const state = new FileAppState({ invoke: disk.invoke });
    await state.set('app', 'recentProjects', [{ projectId: 'p1' }]);
    await state.set('project:p1', 'tabs', { open: [] });
    expect(JSON.parse(disk.files.get('app')!)).toEqual({ recentProjects: [{ projectId: 'p1' }] });

    const restarted = new FileAppState({ invoke: disk.invoke });
    expect(await restarted.get('app', 'recentProjects')).toEqual([{ projectId: 'p1' }]);
    expect(await restarted.get('app', 'missing')).toBeUndefined();
  });

  it('returns copies, deletes keys and clears namespaces', async () => {
    const disk = fakeDisk();
    const state = new FileAppState({ invoke: disk.invoke });
    const value = { a: 1 };
    await state.set('app', 'v', value);
    value.a = 2;
    const read = await state.get<{ a: number }>('app', 'v');
    expect(read).toEqual({ a: 1 });
    read!.a = 3;
    expect(await state.get('app', 'v')).toEqual({ a: 1 });
    await state.delete('app', 'v');
    await state.delete('app', 'never');
    expect(await state.get('app', 'v')).toBeUndefined();
    await state.set('project:p', 'x', 1);
    await state.clearNamespace('project:p');
    expect(disk.files.has('project:p')).toBe(false);
    expect(await state.get('project:p', 'x')).toBeUndefined();
    await expect(state.set('app', 'f', () => 1)).rejects.toThrow(TypeError);
  });

  it('backs up an unreadable document and starts over', async () => {
    const disk = fakeDisk({ app: '{broken', 'project:a': '[1]' });
    const state = new FileAppState({ invoke: disk.invoke });
    expect(await state.get('app', 'x')).toBeUndefined();
    expect(await state.get('project:a', 'x')).toBeUndefined();
    expect(disk.backups).toEqual(['app', 'project:a']);
  });
});
