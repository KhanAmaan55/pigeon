import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectFileSystem } from '@pigeon/platform';
import { MEMORY_CAPABILITIES, MemoryAppState, MemoryFs, MockTransport } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { Auth, Request } from '../src/index';
import {
  applyAuth,
  base64Utf8,
  buildScopes,
  createExecutionContext,
  createRequest,
  inheritedAuth,
  prepareRequest,
  ProjectSession,
  RequestExecutor,
  SECRET_MASK,
} from '../src/index';

const fixtureDirectory = join(import.meta.dirname, '../../fixtures/projects/auth');

async function copyInto(fs: ProjectFileSystem, local: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await copyInto(fs, join(local, entry.name), path);
    else await fs.writeFileAtomic(path, new Uint8Array(await readFile(join(local, entry.name))));
  }
}

async function open() {
  const fs = new MemoryFs();
  await copyInto(fs, fixtureDirectory);
  return ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
}

const ctx = (extra: Partial<Parameters<typeof createExecutionContext>[0]> = {}) =>
  createExecutionContext({ capabilities: MEMORY_CAPABILITIES, ...extra });

async function prepared(request: Request, inherited?: Auth) {
  const result = await prepareRequest(
    request,
    ctx(inherited === undefined ? {} : { inheritedAuth: inherited }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const header = (headers: Array<[string, string]>, name: string) =>
  headers.filter(([key]) => key.toLowerCase() === name.toLowerCase()).map(([, value]) => value);

describe('auth inheritance (PIGN-026)', () => {
  it('walks folders then the collection; noauth stops it; a collection inherits nothing', async () => {
    const session = await open();
    const model = session.getWorkingModel();
    expect(inheritedAuth(model, 'inherit')).toMatchObject({
      auth: { type: 'bearer', token: '{{token}}' },
      origin: { kind: 'collection', id: 'auth-collection', name: 'Auth API' },
    });
    expect(inheritedAuth(model, 'ping')).toMatchObject({
      auth: { type: 'noauth' },
      origin: { kind: 'folder', name: 'Public' },
    });
    // The folder itself inherits from the collection.
    expect(inheritedAuth(model, 'public-folder').origin?.kind).toBe('collection');
    expect(inheritedAuth(model, 'auth-collection')).toEqual({ auth: undefined });
    expect(inheritedAuth(model, 'missing')).toEqual({ auth: undefined });
  });

  it('an inherited collection bearer {{token}} is sent resolved, and masked in results', async () => {
    const session = await open();
    session.apply({
      type: 'setContainerVariables',
      id: 'auth-collection',
      values: [
        { key: 'baseUrl', value: 'http://localhost:4010', type: 'string', enabled: true },
        { key: 'token', value: 'pigeon-token', type: 'string', enabled: true },
      ],
    });
    const model = session.getWorkingModel();
    const request = session.findRequest('inherit')!;
    const transport = new MockTransport().on({ url: /\/auth\/bearer/ }, { status: 200 });
    const result = await new RequestExecutor(transport).execute(
      request,
      ctx({
        scopes: buildScopes(model, { environmentId: null, itemId: 'inherit' }),
        inheritedAuth: inheritedAuth(model, 'inherit').auth!,
      }),
    );
    expect(result.response?.status).toBe(200);
    expect(header(transport.requests[0]!.headers, 'Authorization')).toEqual([
      'Bearer pigeon-token',
    ]);
    // The timeline never shows the generated credential.
    expect(header(result.request.headers, 'Authorization')).toEqual([`Bearer ${SECRET_MASK}`]);
    expect(JSON.stringify(result)).not.toContain('pigeon-token');
  });

  it('commands set and clear container auth; updateRequest clears request auth (inherit)', async () => {
    const session = await open();
    session.apply({ type: 'setContainerAuth', id: 'public-folder', auth: undefined });
    expect(inheritedAuth(session.getWorkingModel(), 'ping').origin?.kind).toBe('collection');
    session.apply({ type: 'updateRequest', id: 'basic', patch: { auth: undefined } });
    expect('auth' in session.findRequest('basic')!).toBe(false);
    expect(session.isUnsaved('basic')).toBe(true);
    await session.saveForCommit();
    const files = session.fs;
    const basic = JSON.parse(
      new TextDecoder().decode(await files.readFile('collections/auth-api/basic.request.json')),
    ) as { request: Record<string, unknown> };
    expect(basic.request['auth']).toBeUndefined();
    const folder = JSON.parse(
      new TextDecoder().decode(await files.readFile('collections/auth-api/public/folder.json')),
    ) as Record<string, unknown>;
    expect(folder['auth']).toBeUndefined();
  });
});

describe('auth handlers', () => {
  it('basic encodes UTF-8 username and password', async () => {
    const req = await prepared(createRequest({ url: 'http://localhost:4010/auth/basic' }), {
      type: 'basic',
      username: 'ünï',
      password: 'pä ss',
    });
    expect(header(req.headers, 'Authorization')).toEqual(['Basic w7xuw686cMOkIHNz']);
    expect(base64Utf8('ünï:pä ss')).toBe('w7xuw686cMOkIHNz');
    expect(base64Utf8('a')).toBe('YQ==');
    expect(base64Utf8('ab')).toBe('YWI=');
  });

  it('api key in the query adds the param; in a header adds the header', async () => {
    const request = { ...createRequest({ url: 'http://x.test/echo?a=1' }) };
    const query = await prepared({
      ...request,
      auth: { type: 'apikey', key: 'api key', value: 'v&1', in: 'query' },
    });
    expect(query.url).toBe('http://x.test/echo?a=1&api%20key=v%261');
    const inHeader = await prepared({
      ...request,
      auth: { type: 'apikey', key: 'X-Api-Key', value: 'k-123', in: 'header' },
    });
    expect(header(inHeader.headers, 'X-Api-Key')).toEqual(['k-123']);
    expect(inHeader.url).toBe('http://x.test/echo?a=1');
  });

  it('own auth wins over inherited; noauth sends nothing', async () => {
    const inherited: Auth = { type: 'bearer', token: 'parent' };
    const own = await prepared(
      { ...createRequest({ url: 'http://x.test' }), auth: { type: 'bearer', token: 'child' } },
      inherited,
    );
    expect(header(own.headers, 'Authorization')).toEqual(['Bearer child']);
    const none = await prepared(
      { ...createRequest({ url: 'http://x.test' }), auth: { type: 'noauth' } },
      inherited,
    );
    expect(header(none.headers, 'Authorization')).toEqual([]);
  });

  it('resolves variables in auth fields and tracks secret ones', async () => {
    const scopes = {
      layers: [
        {
          kind: 'environment' as const,
          name: 'Local',
          key: 'env:e',
          values: new Map([
            ['user', { value: 'ada', secret: false }],
            ['pass', { value: 'hunter22', secret: true }],
          ]),
        },
      ],
    };
    const result = await prepareRequest(
      {
        ...createRequest({ url: 'http://x.test' }),
        auth: { type: 'basic', username: '{{user}}', password: '{{pass}}' },
      },
      ctx({ scopes: scopes as never }),
    );
    expect(result.ok && header(result.value.headers, 'Authorization')).toEqual([
      `Basic ${base64Utf8('ada:hunter22')}`,
    ]);
    expect(result.ok && result.value.meta.secretValues).toEqual(
      expect.arrayContaining(['hunter22', base64Utf8('ada:hunter22')]),
    );
  });

  it('a header the user set wins over the generated one, with a warning', async () => {
    const req = await prepared({
      ...createRequest({
        url: 'http://x.test',
        headers: [{ key: 'authorization', value: 'Custom abc' }],
      }),
      auth: { type: 'bearer', token: 't0ken' },
    });
    expect(header(req.headers, 'Authorization')).toEqual(['Custom abc']);
    expect(req.meta.warnings).toEqual([
      expect.stringMatching(/Authorization header replaces the one generated by auth/),
    ]);
  });

  it('unsupported auth (oauth2) is sent without auth and with a warning', async () => {
    const session = await open();
    const oauth = session.findRequest('oauth2')!;
    const req = await prepared(oauth, { type: 'bearer', token: 'parent' });
    expect(header(req.headers, 'Authorization')).toEqual([]);
    expect(req.meta.warnings).toContainEqual(
      expect.stringMatching(/"oauth2" is not supported yet/),
    );
    expect(applyAuth(undefined).headers).toEqual([]);
  });

  it('rejects generated headers with line breaks', async () => {
    const result = await prepareRequest(
      { ...createRequest({ url: 'http://x.test' }), auth: { type: 'bearer', token: 'a\nb' } },
      ctx(),
    );
    expect(result.ok).toBe(false);
  });
});
