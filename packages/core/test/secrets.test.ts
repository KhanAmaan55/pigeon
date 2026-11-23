import {
  MemoryAppState,
  MemoryFs,
  MemorySecretStore,
  MockTransport,
  MEMORY_CAPABILITIES,
} from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import {
  buildScopes,
  createExecutionContext,
  createRequest,
  initializeProject,
  ProjectSession,
  RequestExecutor,
  SECRET_MASK,
} from '../src/index';

async function project(
  secrets = new MemorySecretStore(),
  appState = new MemoryAppState(),
  fs?: MemoryFs,
) {
  const folder = fs ?? new MemoryFs();
  if (!fs) await initializeProject(folder, 'Secrets API');
  const session = await ProjectSession.fromFs(folder, { appState, secrets });
  return { fs: folder, appState, secrets, session };
}

describe('secret variables (PIGN-025)', () => {
  it('keeps secret current values in the SecretStore, never in local state or files', async () => {
    const { fs, appState, secrets, session } = await project();
    session.apply({
      type: 'createEnvironment',
      id: 'env',
      name: 'Local',
      values: [
        { key: 'token', value: '', type: 'secret', enabled: true },
        { key: 'user', value: 'ada', type: 'default', enabled: true },
      ],
    });
    session.setCurrentValue('env:env', 'token', 'super-secret-token');
    session.setCurrentValue('env:env', 'user', 'grace');
    await session.saveForCommit();

    expect(await secrets.getAll(session.localKey)).toEqual({
      'env:env\u0000token': 'super-secret-token',
    });
    const state = JSON.stringify(await appState.get(`project:${session.localKey}`, 'state'));
    expect(state).not.toContain('super-secret-token');
    expect(state).toContain('grace');
    for (const entry of await fs.list('', { recursive: true })) {
      if (entry.kind === 'file')
        expect(await fs.readText(entry.path)).not.toContain('super-secret-token');
    }
    expect(session.currentValues('env:env')).toEqual({
      user: 'grace',
      token: 'super-secret-token',
    });

    const restarted = await ProjectSession.fromFs(fs, { appState, secrets });
    expect(restarted.currentValues('env:env').token).toBe('super-secret-token');
    restarted.resetCurrentValues('env:env');
    expect(await secrets.getAll(restarted.localKey)).toEqual({});
  });

  it('moves current values when a variable changes between default and secret', async () => {
    const { appState, secrets, session } = await project();
    session.apply({
      type: 'setGlobals',
      values: [{ key: 'apiKey', value: '', type: 'default', enabled: true }],
    });
    session.setCurrentValue('globals', 'apiKey', 'k-123456');
    session.apply({
      type: 'setGlobals',
      values: [{ key: 'apiKey', value: '', type: 'secret', enabled: true }],
    });
    expect(await secrets.get(session.localKey, 'globals\u0000apiKey')).toBe('k-123456');
    await session.flushLocalState();
    expect(
      JSON.stringify(await appState.get(`project:${session.localKey}`, 'state')),
    ).not.toContain('k-123456');

    session.apply({
      type: 'setGlobals',
      values: [{ key: 'apiKey', value: '', type: 'default', enabled: true }],
    });
    expect(await secrets.getAll(session.localKey)).toEqual({});
    expect(session.currentValues('globals')).toEqual({ apiKey: 'k-123456' });
  });

  it('masks resolved secrets in the request summary and error details', async () => {
    const { session } = await project();
    session.apply({
      type: 'createEnvironment',
      id: 'env',
      name: 'Local',
      values: [{ key: 'token', value: '', type: 'secret', enabled: true }],
    });
    session.setCurrentValue('env:env', 'token', 'super-secret-token');
    const scopes = buildScopes(session.getWorkingModel(), {
      environmentId: 'env',
      currentValues: (key) => session.currentValues(key),
    });
    const transport = new MockTransport()
      .on({ url: /\/ok\?/ }, { body: 'fine' })
      .on({ url: /\/fail\?/ }, () => {
        throw new Error('connect refused for super-secret-token');
      });
    const executor = new RequestExecutor(transport);
    const ctx = createExecutionContext({ capabilities: MEMORY_CAPABILITIES, scopes });
    const ok = await executor.execute(
      createRequest({
        url: 'http://x.test/ok?t={{token}}',
        headers: [{ key: 'Authorization', value: 'Bearer {{token}}' }],
      }),
      ctx,
    );
    expect(transport.requests[0]!.headers[0]).toEqual([
      'Authorization',
      'Bearer super-secret-token',
    ]);
    expect(JSON.stringify(ok.request)).not.toContain('super-secret-token');
    expect(ok.request.headers[0]).toEqual(['Authorization', `Bearer ${SECRET_MASK}`]);
    expect(ok.request.url).toContain(SECRET_MASK);
    // The final URL of the response echoes the request: masked too.
    expect(ok.response?.url).toBe(`http://x.test/ok?t=${SECRET_MASK}`);

    const failed = await executor.execute(
      createRequest({ url: 'http://x.test/fail?t={{token}}' }),
      ctx,
    );
    expect(JSON.stringify(failed)).not.toContain('super-secret-token');
  });

  it('keeps secrets per project', async () => {
    const secrets = new MemorySecretStore();
    const a = await project(secrets);
    const b = await project(secrets, new MemoryAppState(), undefined);
    for (const { session } of [a, b]) {
      session.apply({
        type: 'setGlobals',
        values: [{ key: 't', value: '', type: 'secret', enabled: true }],
      });
    }
    a.session.setCurrentValue('globals', 't', 'secret-a');
    expect(b.session.currentValues('globals')).toEqual({});
    expect(await secrets.getAll(b.session.localKey)).toEqual({});
    expect(a.session.localKey).not.toBe(b.session.localKey);
  });
});

describe('forgetting secrets (PIGN-053)', () => {
  it('removes every secret current value and OAuth token of the project only', async () => {
    const secrets = new MemorySecretStore();
    const { session } = await project(secrets);
    session.apply({
      type: 'createEnvironment',
      id: 'env',
      name: 'Local',
      values: [{ key: 'token', value: '', type: 'secret', enabled: true }],
    });
    session.setCurrentValue('env:env', 'token', 'super-secret-token');
    session.oauthTokens.set('default', { accessToken: 'abc', tokenType: 'Bearer' } as never);
    await secrets.set('other-project', 'globals\u0000k', 'keep');
    let changes = 0;
    session.onChange(() => changes++);

    await session.forgetSecrets();

    expect(session.currentValues('env:env')).toEqual({});
    expect(session.oauthTokens.get('default')).toBeUndefined();
    expect(await secrets.getAll(session.localKey)).toEqual({});
    expect(await secrets.getAll('other-project')).toEqual({ 'globals\u0000k': 'keep' });
    expect(changes).toBeGreaterThan(0);
    expect(session.secretBackend).toBe('memory');
    expect(session.secretStoreNotice).toBeUndefined();
  });
});
