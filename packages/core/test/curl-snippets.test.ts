import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { curlSnippet, parseCurl } from '@pigeon/formats';
import { MemoryAppState, MemoryFs, MemorySecretStore } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { Request, VariableScopes } from '../src/index';
import {
  applyImport,
  createRequest,
  importContext,
  initializeProject,
  previewImportFiles,
  ProjectSession,
  requestFromCurl,
  requestNameFor,
  SECRET_MASK,
  snippetRequest,
} from '../src/index';

const curlFixtures = join(import.meta.dirname, '../../fixtures/curl');
const fixture = (name: string) => ({
  name,
  bytes: new Uint8Array(readFileSync(join(curlFixtures, name))),
});

async function session() {
  const fs = new MemoryFs();
  await initializeProject(fs, 'Curl');
  return ProjectSession.fromFs(fs, {
    appState: new MemoryAppState(),
    secrets: new MemorySecretStore(),
  });
}

const scopes = {
  layers: [
    {
      kind: 'environment' as const,
      name: 'Local',
      key: 'env:e',
      values: new Map([
        ['baseUrl', { value: 'https://api.example.com', secret: false }],
        ['token', { value: 'super-secret-token', secret: true }],
        ['user', { value: 'ada', secret: false }],
      ]),
    },
  ],
} as unknown as VariableScopes;

const request = (): Request => ({
  ...createRequest({
    method: 'POST',
    url: '{{baseUrl}}/users?expand=1',
    headers: [
      { key: 'X-Token', value: '{{token}}' },
      { key: 'X-Off', value: 'no', disabled: true },
    ],
    body: { mode: 'raw', raw: '{"user":"{{user}}","token":"{{token}}"}', language: 'json' },
  }),
  auth: { type: 'bearer', token: '{{token}}' },
});

describe('cURL import (PIGN-050)', () => {
  it('pasted cURL files become requests in the selected folder', async () => {
    const s = await session();
    s.apply({ type: 'createCollection', id: 'c1', name: 'API' });
    s.apply({ type: 'createFolder', id: 'f1', parentId: 'c1', name: 'Users' });
    const items = previewImportFiles(
      [fixture('chrome-bash-post-json.txt'), fixture('chrome-cmd-post-json.txt')],
      importContext(s.getWorkingModel()),
    );
    expect(items.map((i) => [i.kind, i.kind === 'request' && i.name])).toEqual([
      ['request', 'POST api.example.com/users'],
      ['request', 'POST api.example.com/users'],
    ]);
    const ids = applyImport(s, items, { targetId: 'f1' });
    expect(ids).toContain('f1');
    const [first, second] = items as Array<Extract<(typeof items)[number], { kind: 'request' }>>;
    const created = s.findRequest(first!.id)!;
    expect(created.method).toBe('POST');
    expect(created.url.query).toEqual([
      { key: 'page', value: '2' },
      { key: 'q', value: 'a%20b' },
    ]);
    expect(created.body).toMatchObject({ mode: 'raw', language: 'json' });
    // Both shells give the same request.
    const other = s.findRequest(second!.id)!;
    expect(other.body).toEqual(created.body);
    expect(other.url).toEqual(created.url);
    await s.saveForCommit(ids);
    const folder = s.getWorkingModel().collections[0]!.children[0]!;
    expect(folder.kind === 'folder' && folder.children.map((c) => c.id)).toEqual([
      first!.id,
      second!.id,
    ]);
  });

  it('with no collection, requests go into a new "Imported" collection', async () => {
    const s = await session();
    const items = previewImportFiles(
      [{ name: 'pasted', bytes: "curl -u ada:pw 'https://x.test/a'" }],
      importContext(s.getWorkingModel()),
    );
    applyImport(s, items);
    const [collection] = s.getWorkingModel().collections;
    expect(collection?.name).toBe('Imported');
    const created = collection!.children[0] as Request;
    expect(created).toMatchObject({
      name: 'GET x.test/a',
      auth: { type: 'basic', username: 'ada', password: 'pw' },
    });
  });

  it('names requests from the URL', () => {
    expect(requestNameFor('GET', 'https://example.com/')).toBe('GET example.com');
    expect(requestNameFor('PUT', 'http://h/a/b?c=1#x')).toBe('PUT h/a/b');
  });
});

describe('snippetRequest (PIGN-050)', () => {
  it('keeps {{variables}} as written and masks literal credentials', () => {
    const { request: snippet, masked } = snippetRequest(
      { ...request(), auth: { type: 'basic', username: 'ada', password: 'literal-pw' } },
      { scopes },
      { resolve: false },
    );
    expect(snippet.url).toBe('{{baseUrl}}/users?expand=1');
    expect(snippet.headers).toEqual([
      ['X-Token', '{{token}}'],
      ['Authorization', `Basic ${SECRET_MASK}`],
      ['Content-Type', 'application/json'],
    ]);
    expect(snippet.body).toEqual({
      kind: 'text',
      text: '{"user":"{{user}}","token":"{{token}}"}',
    });
    expect(masked).toBe(true);
  });

  it('resolves variables and masks secrets by default; reveal shows them', () => {
    const hidden = snippetRequest(request(), { scopes }, { resolve: true });
    const text = curlSnippet.generate(hidden.request);
    expect(text).not.toContain('super-secret-token');
    expect(text).toContain("'X-Token: ••••••'");
    expect(text).toContain("'Authorization: Bearer ••••••'");
    expect(text).toContain('"user":"ada"');
    expect(hidden.masked).toBe(true);

    const shown = snippetRequest(request(), { scopes }, { resolve: true, revealSecrets: true });
    expect(curlSnippet.generate(shown.request)).toContain('Bearer super-secret-token');
    expect(shown.masked).toBe(false);
  });

  it('an inherited api key in the query is added; deferred auth is noted', () => {
    const withKey = snippetRequest(
      createRequest({ url: 'https://x.test/a?b=1' }),
      { inheritedAuth: { type: 'apikey', key: 'key', value: 'k 123456', in: 'query' } },
      { resolve: true, revealSecrets: true },
    );
    expect(withKey.request.url).toBe('https://x.test/a?b=1&key=k%20123456');
    const digest = snippetRequest(
      {
        ...createRequest({ url: 'https://x.test' }),
        auth: {
          type: 'digest',
          username: 'u',
          password: 'p',
          realm: '',
          nonce: '',
          algorithm: '',
          qop: '',
          nonceCount: '',
          clientNonce: '',
          opaque: '',
        },
      },
      {},
      { resolve: true },
    );
    expect(digest.warnings).toEqual([expect.stringMatching(/^Digest auth is computed/)]);
  });

  it('form-data and file bodies keep their file paths', () => {
    const multipart = snippetRequest(
      createRequest({
        method: 'POST',
        url: 'https://x.test/up',
        body: {
          mode: 'formdata',
          params: [
            { key: 'title', value: 'Hi', kind: 'text' },
            { key: 'doc', value: '', kind: 'file', src: 'files/a.pdf' },
          ],
        },
      }),
      {},
      { resolve: true },
    );
    expect(multipart.request.body).toEqual({
      kind: 'multipart',
      parts: [
        { name: 'title', kind: 'text', value: 'Hi' },
        { name: 'doc', kind: 'file', path: 'files/a.pdf', contentType: 'application/pdf' },
      ],
    });
    expect(multipart.request.headers).toEqual([]);
  });

  it('a project request → cURL → parsed back is equivalent', () => {
    const original = request();
    const { request: snippet } = snippetRequest(
      original,
      { scopes },
      { resolve: true, revealSecrets: true },
    );
    const parsed = parseCurl(curlSnippet.generate(snippet));
    if (!parsed.ok) throw new Error(parsed.message);
    const back = requestFromCurl(parsed.request);
    expect(back.method).toBe('POST');
    expect(back.url.raw).toBe('https://api.example.com/users?expand=1');
    expect(back.body).toEqual({
      mode: 'raw',
      raw: '{"user":"ada","token":"super-secret-token"}',
      language: 'json',
    });
    expect(back.headers).toEqual([
      { key: 'X-Token', value: 'super-secret-token' },
      { key: 'Authorization', value: 'Bearer super-secret-token' },
      { key: 'Content-Type', value: 'application/json' },
    ]);
  });
});
