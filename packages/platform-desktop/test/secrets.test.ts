import { describe, expect, it } from 'vitest';

import type { Invoke } from '../src/native-transport';
import { FileSecretStore } from '../src/secrets';

describe('FileSecretStore', () => {
  it('reads and writes one secrets document per project', async () => {
    const files = new Map<string, string>([['broken', 'not json']]);
    const invoke: Invoke = async <T>(cmd: string, args?: Record<string, unknown> | Uint8Array) => {
      const { projectId, json } = args as { projectId: string; json?: string };
      if (cmd === 'secrets_read') return (files.get(projectId) ?? null) as T;
      files.set(projectId, json!);
      return undefined as T;
    };
    const store = new FileSecretStore({ invoke });
    expect(store.backend).toBe('local-state');
    await store.set('p1', 'env:a\u0000token', 's3cret');
    await store.set('p2', 'globals\u0000k', 'other');
    expect(JSON.parse(files.get('p1')!)).toEqual({ 'env:a\u0000token': 's3cret' });
    const restarted = new FileSecretStore({ invoke });
    expect(await restarted.getAll('p1')).toEqual({ 'env:a\u0000token': 's3cret' });
    expect(await restarted.get('p2', 'globals\u0000k')).toBe('other');
    await restarted.delete('p1', 'env:a\u0000token');
    await restarted.delete('p1', 'missing');
    expect(JSON.parse(files.get('p1')!)).toEqual({});
    expect(await restarted.getAll('broken')).toEqual({});
  });
});
