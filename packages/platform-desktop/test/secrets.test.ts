import { describe, expect, it } from 'vitest';

import type { Invoke } from '../src/native-transport';
import { accountOf, FileSecretStore, KeychainSecretStore, keyOfAccount } from '../src/secrets';

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

/** The Rust `keychain_*` and `secrets_*` commands over maps (keychain.rs is tested in cargo). */
function fakeDesktop(opts: { unavailable?: string; dropOnSet?: string } = {}) {
  const keychain = new Map<string, Map<string, string>>();
  const files = new Map<string, string>();
  const calls: string[] = [];
  let failing = opts.unavailable;
  const invoke: Invoke = async <T>(cmd: string, args?: Record<string, unknown> | Uint8Array) => {
    calls.push(cmd);
    const { projectId, account, value, json } = (args ?? {}) as Record<string, string>;
    const entries = () => {
      let map = keychain.get(projectId!);
      if (!map) keychain.set(projectId!, (map = new Map()));
      return map;
    };
    if (cmd.startsWith('keychain_') && failing) throw failing;
    switch (cmd) {
      case 'keychain_status':
        return undefined as T;
      case 'keychain_get_all':
        return Object.fromEntries(entries()) as T;
      case 'keychain_set':
        if (account !== opts.dropOnSet) entries().set(account!, value!);
        return undefined as T;
      case 'keychain_delete':
        entries().delete(account!);
        return undefined as T;
      case 'keychain_clear':
        keychain.delete(projectId!);
        files.delete(projectId!);
        return undefined as T;
      case 'secrets_read':
        return (files.get(projectId!) ?? null) as T;
      case 'secrets_write':
        files.set(projectId!, json!);
        return undefined as T;
      case 'secrets_remove':
        files.delete(projectId!);
        return undefined as T;
    }
    throw new Error(`unexpected ${cmd}`);
  };
  return {
    keychain,
    files,
    calls,
    invoke,
    breakKeychain: (reason: string) => (failing = reason),
  };
}

describe('KeychainSecretStore', () => {
  it('maps store keys to keychain accounts exactly, both ways', () => {
    for (const key of [
      'env:a\u0000token',
      'globals\u0000a/b%c',
      'odd/scope%\u0000k',
      'no-separator/x',
    ]) {
      expect(keyOfAccount(accountOf(key))).toBe(key);
    }
    expect(accountOf('env:a\u0000token')).toBe('env:a/token');
    expect(accountOf('oauth2\u0000default')).toBe('oauth2/default');
  });

  it('keeps secrets in the OS keychain and reads them back after a restart', async () => {
    const desktop = fakeDesktop();
    const store = new KeychainSecretStore({ invoke: desktop.invoke });
    await store.set('p1', 'env:a\u0000token', 's3cret');
    await store.set('p2', 'globals\u0000k', 'other');
    expect(store.backend).toBe('os-keychain');
    expect(store.notice).toBeUndefined();
    expect(desktop.keychain.get('p1')?.get('env:a/token')).toBe('s3cret');
    expect(desktop.files.size).toBe(0);

    const restarted = new KeychainSecretStore({ invoke: desktop.invoke });
    expect(await restarted.getAll('p1')).toEqual({ 'env:a\u0000token': 's3cret' });
    expect(await restarted.get('p2', 'globals\u0000k')).toBe('other');
    await restarted.delete('p1', 'env:a\u0000token');
    expect(await restarted.getAll('p1')).toEqual({});
    // One availability probe per run (store instance), not per call.
    expect(desktop.calls.filter((c) => c === 'keychain_status')).toHaveLength(2);
  });

  it('migrates secrets.json into the keychain, then deletes it; repeating is harmless', async () => {
    const desktop = fakeDesktop();
    desktop.files.set(
      'p1',
      JSON.stringify({ 'env:a\u0000token': 's3cret', 'globals\u0000k': 'v' }),
    );
    const store = new KeychainSecretStore({ invoke: desktop.invoke });
    expect(await store.getAll('p1')).toEqual({
      'env:a\u0000token': 's3cret',
      'globals\u0000k': 'v',
    });
    expect(desktop.files.has('p1')).toBe(false);
    expect(Object.fromEntries(desktop.keychain.get('p1')!)).toEqual({
      'env:a/token': 's3cret',
      'globals/k': 'v',
    });

    // A second run (or a file written again by the fallback) merges without losing anything.
    desktop.files.set('p1', JSON.stringify({ 'globals\u0000k': 'v2' }));
    const again = new KeychainSecretStore({ invoke: desktop.invoke });
    expect(await again.getAll('p1')).toEqual({
      'env:a\u0000token': 's3cret',
      'globals\u0000k': 'v2',
    });
    expect(desktop.files.has('p1')).toBe(false);
    expect(await again.getAll('p1')).toEqual({
      'env:a\u0000token': 's3cret',
      'globals\u0000k': 'v2',
    });
  });

  it('keeps secrets.json when a migrated value does not read back', async () => {
    const desktop = fakeDesktop({ dropOnSet: 'globals/k' });
    const doc = JSON.stringify({ 'env:a\u0000token': 's3cret', 'globals\u0000k': 'v' });
    desktop.files.set('p1', doc);
    const store = new KeychainSecretStore({ invoke: desktop.invoke });
    expect(await store.getAll('p1')).toEqual({
      'env:a\u0000token': 's3cret',
      'globals\u0000k': 'v',
    });
    expect(desktop.files.get('p1')).toBe(doc);
    expect(store.backend).toBe('local-state');
    expect(store.notice).toMatch(/did not read back/);
  });

  it('falls back to secrets.json with a notice when the keychain is unavailable', async () => {
    const desktop = fakeDesktop({ unavailable: 'org.freedesktop.secrets was not provided' });
    const store = new KeychainSecretStore({ invoke: desktop.invoke });
    await store.set('p1', 'env:a\u0000token', 's3cret');
    expect(store.backend).toBe('local-state');
    expect(store.notice).toMatch(/OS keychain is not available \(org\.freedesktop\.secrets/);
    expect(JSON.parse(desktop.files.get('p1')!)).toEqual({ 'env:a\u0000token': 's3cret' });
    expect(await store.getAll('p1')).toEqual({ 'env:a\u0000token': 's3cret' });
    expect(desktop.keychain.size).toBe(0);
  });

  it('falls back for the rest of the run when the keychain fails later', async () => {
    const desktop = fakeDesktop();
    const store = new KeychainSecretStore({ invoke: desktop.invoke });
    await store.set('p1', 'globals\u0000a', '1');
    desktop.breakKeychain('User canceled the operation');
    await store.set('p1', 'globals\u0000b', '2');
    expect(store.backend).toBe('local-state');
    expect(JSON.parse(desktop.files.get('p1')!)).toEqual({ 'globals\u0000b': '2' });
  });

  it('forgets every secret of a project (keychain entries and secrets.json)', async () => {
    const desktop = fakeDesktop();
    const store = new KeychainSecretStore({ invoke: desktop.invoke });
    await store.set('p1', 'globals\u0000a', '1');
    await store.set('p2', 'globals\u0000a', 'keep');
    desktop.files.set('p1', '{}');
    await store.clear('p1');
    expect(desktop.keychain.has('p1')).toBe(false);
    expect(desktop.files.has('p1')).toBe(false);
    expect(await store.getAll('p1')).toEqual({});
    expect(await store.getAll('p2')).toEqual({ 'globals\u0000a': 'keep' });
  });
});

describe('FileSecretStore.clear', () => {
  it('removes the secrets document', async () => {
    const desktop = fakeDesktop();
    const store = new FileSecretStore({ invoke: desktop.invoke });
    await store.set('p1', 'globals\u0000a', '1');
    await store.clear('p1');
    expect(desktop.files.has('p1')).toBe(false);
    expect(await store.getAll('p1')).toEqual({});
  });
});
