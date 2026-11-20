import { describe, expect, it } from 'vitest';

import type { Invoke } from '../src/native-transport';
import { DesktopProjectLocator } from '../src/project-locator';
import { TauriFs } from '../src/tauri-fs';

function recorder(answers: Record<string, unknown>) {
  const calls: Array<[string, unknown]> = [];
  const invoke: Invoke = async <T>(cmd: string, args?: Record<string, unknown> | Uint8Array) => {
    calls.push([cmd, args]);
    return answers[cmd] as T;
  };
  return { calls, invoke };
}

describe('DesktopProjectLocator', () => {
  it('picks and creates native folders through Rust', async () => {
    const { calls, invoke } = recorder({
      project_pick_folder: 'C:\\Repo\\api',
      project_create: '/home/a/New API',
    });
    const locator = new DesktopProjectLocator({ invoke });
    expect(await locator.pickProjectFolder()).toEqual({
      kind: 'native',
      absolutePath: 'C:\\Repo\\api',
    });
    expect(await locator.createProject('New API')).toEqual({
      kind: 'native',
      absolutePath: '/home/a/New API',
    });
    expect(calls).toEqual([
      ['project_pick_folder', undefined],
      ['project_create', { name: 'New API' }],
    ]);
  });

  it('reports cancelled pickers as null', async () => {
    const locator = new DesktopProjectLocator({
      invoke: recorder({ project_pick_folder: null, project_create: null }).invoke,
    });
    expect(await locator.pickProjectFolder()).toBeNull();
    expect(await locator.createProject('x')).toBeNull();
  });

  it('reopens granted folders and opens a TauriFs', async () => {
    const { calls, invoke } = recorder({ project_reopen: 'missing' });
    const locator = new DesktopProjectLocator({ invoke });
    expect(await locator.reopen({ kind: 'native', absolutePath: '/gone' })).toBe('missing');
    expect(await locator.reopen({ kind: 'memory', id: 'x' })).toBe('missing');
    expect(calls).toEqual([['project_reopen', { root: '/gone' }]]);
    expect(locator.open({ kind: 'native', absolutePath: '/a' })).toBeInstanceOf(TauriFs);
    expect(() => locator.open({ kind: 'memory', id: 'x' })).toThrow(/cannot open/);
  });
});
