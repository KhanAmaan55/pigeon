import { exportCollection } from '@pigeon/formats';
import { MemoryAppState, MemoryFs } from '@pigeon/platform';
import { NODE_CAPABILITIES, NodeTransport } from '@pigeon/platform-node';
import type { TestServer } from '@pigeon/test-server';
import { OAUTH_TEST, startTestServer } from '@pigeon/test-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Auth, OAuth2Auth } from '../src/index';
import {
  authorizationUrl,
  createExecutionContext,
  createRequest,
  initializeProject,
  pkcePair,
  ProjectSession,
  randomState,
  RequestExecutor,
  requestToken,
  tokenCacheKey,
} from '../src/index';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());

const oauth = (extra: Partial<OAuth2Auth> = {}): OAuth2Auth => ({
  type: 'oauth2',
  grantType: 'client_credentials',
  authUrl: `${server.url}/oauth/authorize`,
  accessTokenUrl: `${server.url}/oauth/token`,
  clientId: OAUTH_TEST.clientId,
  clientSecret: OAUTH_TEST.clientSecret,
  scope: 'read',
  state: '',
  redirectUri: '',
  username: '',
  password: '',
  challengeAlgorithm: 'S256',
  codeVerifier: '',
  clientAuthentication: 'header',
  addTokenTo: 'header',
  headerPrefix: '',
  accessToken: '',
  tokenName: '',
  ...extra,
});

async function project() {
  const fs = new MemoryFs();
  await initializeProject(fs, 'OAuth');
  return ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
}

const send = (session: ProjectSession, auth: Auth, path = '/oauth/protected') =>
  new RequestExecutor(new NodeTransport()).execute(
    {
      ...createRequest({
        name: 'R',
        url: { raw: `${server.url}${path}`, query: [], pathVariables: [], extra: {} },
      }),
      auth,
    },
    createExecutionContext({ capabilities: NODE_CAPABILITIES, oauth2: session.oauthTokens }),
  );

describe('OAuth 2.0 (PIGN-047)', () => {
  it('client credentials: a token is requested on send, cached, and never in the result', async () => {
    const session = await project();
    const auth = oauth();
    const first = await send(session, auth);
    expect(first.response?.status).toBe(200);
    expect(first.warnings).toContain('A new OAuth 2.0 token was requested.');
    const token = session.oauthTokens.get(tokenCacheKey(auth))!.accessToken;
    expect(JSON.stringify(first)).not.toContain(token);
    const second = await send(session, auth);
    expect(second.response?.status).toBe(200);
    expect(second.warnings).not.toContain('A new OAuth 2.0 token was requested.');
    expect(session.oauthTokens.get(tokenCacheKey(auth))!.accessToken).toBe(token);
    // Client secret in the body works too; the token can go into the query string.
    const query = await send(
      session,
      oauth({ clientAuthentication: 'body', addTokenTo: 'queryParams', scope: 'q' }),
    );
    expect(query.response?.status).toBe(200);
    expect(query.request.url).toMatch(/access_token=/);
  });

  it('password grant: expired tokens are refreshed with the refresh token', async () => {
    const session = await project();
    const auth = oauth({
      grantType: 'password_credentials',
      username: OAUTH_TEST.username,
      password: OAUTH_TEST.password,
      // Expires at once (within the 30 s slack), so the next send refreshes.
      accessTokenUrl: `${server.url}/oauth/token?expires_in=1`,
    });
    expect((await send(session, auth)).response?.status).toBe(200);
    const before = session.oauthTokens.get(tokenCacheKey(auth))!;
    expect(before.refreshToken).toMatch(/^rt-/);
    const again = await send(session, auth);
    expect(again.warnings).toContain('The expired OAuth 2.0 token was refreshed.');
    expect(session.oauthTokens.get(tokenCacheKey(auth))!.accessToken).not.toBe(before.accessToken);
  });

  it('authorization code with PKCE: approve, exchange the code, then send', async () => {
    const session = await project();
    const auth = oauth({ grantType: 'authorization_code_with_pkce', clientSecret: '' });
    // Without a token the send goes out unauthenticated and says how to get one.
    const without = await send(session, auth);
    expect(without.response?.status).toBe(401);
    expect(without.warnings.join(' ')).toContain('Get new token');

    const pkce = await pkcePair('S256');
    const state = randomState();
    const redirectUri = 'http://127.0.0.1:9/callback';
    const url = authorizationUrl(auth, {
      redirectUri,
      state,
      challenge: { value: pkce.challenge, method: pkce.method },
    });
    // The "browser": follow the authorize page to the redirect.
    const approve = await new NodeTransport().send(
      {
        id: 'a',
        method: 'GET',
        url,
        headers: [],
        settings: { timeoutMs: 5000, followRedirects: false, maxRedirects: 0, strictSSL: true },
        meta: { protocol: 'http', unresolved: [], secretValues: [] },
      },
      { signal: new AbortController().signal },
    );
    const location = new URL(approve.headers.find(([n]) => n.toLowerCase() === 'location')![1]);
    expect(location.searchParams.get('state')).toBe(state);
    const token = await requestToken(new NodeTransport(), auth, {
      kind: 'authorization_code',
      code: location.searchParams.get('code')!,
      redirectUri,
      codeVerifier: pkce.verifier,
    });
    session.oauthTokens.set(tokenCacheKey(auth), token);
    expect((await send(session, auth)).response?.status).toBe(200);
  });

  it('a wrong secret fails the send with the server reason; no token is stored', async () => {
    const session = await project();
    const auth = oauth({ clientSecret: 'nope' });
    const result = await send(session, auth);
    expect(result.error?.message).toContain('invalid_client');
    expect(result.error?.message).not.toContain('nope');
    expect(session.oauthTokens.get(tokenCacheKey(auth))).toBeUndefined();
  });
});

describe('OAuth 2.0 tokens stay local (PIGN-047)', () => {
  it('never reach project files, local state or a Postman export', async () => {
    const fs = new MemoryFs();
    await initializeProject(fs, 'OAuth');
    const appState = new MemoryAppState();
    const session = await ProjectSession.fromFs(fs, { appState });
    session.apply({ type: 'createCollection', id: 'c', name: 'API' });
    session.apply({
      type: 'createRequest',
      id: 'r',
      parentId: 'c',
      name: 'Protected',
      request: {
        url: { raw: `${server.url}/oauth/protected`, query: [], pathVariables: [], extra: {} },
        auth: oauth(),
      },
    });
    const request = session.findRequest('r')!;
    const result = await new RequestExecutor(new NodeTransport()).execute(
      request,
      createExecutionContext({ capabilities: NODE_CAPABILITIES, oauth2: session.oauthTokens }),
    );
    expect(result.response?.status).toBe(200);
    const token = session.oauthTokens.get(tokenCacheKey(oauth()))!.accessToken;
    await session.saveForCommit();
    await session.flushLocalState();
    for (const entry of await fs.list('', { recursive: true })) {
      if (entry.kind === 'file') expect(await fs.readText(entry.path)).not.toContain(token);
    }
    expect(JSON.stringify(session.localState)).not.toContain(token);
    const exported = exportCollection(session.getWorkingModel().collections[0]!, {
      includeExamples: true,
      includePigeonMetadata: true,
    });
    expect(JSON.stringify(exported)).not.toContain(token);
  });
});
