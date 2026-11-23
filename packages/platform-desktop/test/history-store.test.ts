import { describe, expect, it } from 'vitest';

import type { Invoke } from '../src/index';
import { FileHistoryStore } from '../src/index';

/** A fake of the Rust history commands (apps/desktop/src-tauri/src/history.rs). */
function fakeDisk() {
  const calls: Array<[string, unknown]> = [];
  const projects = new Map<string, Map<string, { summary: string; entry: string }>>();
  const project = (key: string) => {
    if (!projects.has(key)) projects.set(key, new Map());
    return projects.get(key)!;
  };
  const invoke: Invoke = async <T>(cmd: string, raw?: Record<string, unknown> | Uint8Array) => {
    const args = raw as Record<string, unknown>;
    calls.push([cmd, args]);
    const key = args['projectKey'] as string;
    switch (cmd) {
      case 'history_append':
        for (const r of args['records'] as Array<{ id: string; summary: string; entry: string }>)
          project(key).set(r.id, r);
        return undefined as T;
      case 'history_list':
        return [...project(key).values()].map((r) => JSON.parse(r.summary) as unknown) as T;
      case 'history_get':
        return (project(key).get(args['id'] as string)?.entry ?? null) as T;
      case 'history_remove':
        for (const id of args['ids'] as string[]) project(key).delete(id);
        return undefined as T;
      case 'history_clear':
        projects.delete(key);
        return undefined as T;
    }
    throw new Error(`unexpected ${cmd}`);
  };
  return { invoke, calls };
}

describe('FileHistoryStore (PIGN-051)', () => {
  it('sends summaries and entries as JSON text and parses them back', async () => {
    const disk = fakeDisk();
    const store = new FileHistoryStore({ invoke: disk.invoke });
    await store.append('p@1', [{ id: 'a', summary: { id: 'a' }, entry: { id: 'a', n: 1 } }]);
    await store.append('p@1', []);
    expect(disk.calls).toEqual([
      [
        'history_append',
        {
          projectKey: 'p@1',
          records: [{ id: 'a', summary: '{"id":"a"}', entry: '{"id":"a","n":1}' }],
        },
      ],
    ]);
    expect(await store.list('p@1')).toEqual([{ id: 'a' }]);
    expect(await store.get('p@1', 'a')).toEqual({ id: 'a', n: 1 });
    expect(await store.get('p@1', 'missing')).toBeUndefined();
    await store.remove('p@1', ['a']);
    expect(await store.list('p@1')).toEqual([]);
    await store.clear('p@1');
    expect(disk.calls.at(-1)).toEqual(['history_clear', { projectKey: 'p@1' }]);
  });
});
