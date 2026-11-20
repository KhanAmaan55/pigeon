import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectFileSystem } from '@pigeon/platform';
import { MEMORY_CAPABILITIES, MemoryAppState, MemoryFs, MockTransport } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { NormalizedResponse } from '../src/index';
import {
  buildScopes,
  createExecutionContext,
  exampleFromResponse,
  normalizeResponse,
  ProjectSession,
  RequestExecutor,
  SECRET_MASK,
} from '../src/index';

const fixtureDirectory = join(import.meta.dirname, '../../fixtures/projects/examples');

async function copyInto(fs: ProjectFileSystem, local: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await copyInto(fs, join(local, entry.name), path);
    else await fs.writeFileAtomic(path, new Uint8Array(await readFile(join(local, entry.name))));
  }
}

/** The examples fixture; `withoutExamples` drops every example (a project before any save). */
async function open({ withoutExamples = false } = {}) {
  const fs = new MemoryFs();
  await copyInto(fs, fixtureDirectory);
  if (withoutExamples) {
    for (const entry of await fs.list('examples', { recursive: true })) {
      if (entry.kind === 'file' && !entry.path.endsWith('.md')) await fs.remove(entry.path);
    }
  }
  const session = await ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
  return { fs, session };
}

const fixtureText = (path: string) => readFile(join(fixtureDirectory, path), 'utf8');

function response(init: {
  status?: number;
  statusText?: string;
  headers?: Array<[string, string]>;
  body: string | Uint8Array;
}): NormalizedResponse {
  return normalizeResponse({
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: init.headers ?? [],
    body: typeof init.body === 'string' ? new TextEncoder().encode(init.body) : init.body,
    url: 'https://api.example.test/users?limit=20',
    redirects: [],
    timings: { startedAt: 0, totalMs: 5 },
    headersRestricted: false,
  });
}

describe('save as example (PIGN-027)', () => {
  it('writes …/list-users/200-ok.example.json and 200-ok.body.json as in the golden fixture', async () => {
    const { fs, session } = await open({ withoutExamples: true });
    const request = session.findRequest('list-users')!;
    expect(request.examples).toEqual([]);
    const example = exampleFromResponse(
      request,
      response({
        headers: [
          ['Content-Type', 'application/json; charset=utf-8'],
          ['Date', 'Thu, 19 Nov 2026 10:00:00 GMT'],
          ['ETag', 'W/"abc"'],
          ['Set-Cookie', 'sid=1; Path=/'],
          ['X-Request-Id', 'req-1'],
          ['Content-Length', '58'],
        ],
        body: '[{"id":1,"name":"Ada Lovelace","big":12345678901234567890}]',
      }),
      { id: 'example-200' },
    );
    expect(example.name).toBe('200 OK');
    session.apply({ type: 'createExample', requestId: 'list-users', example });
    expect(session.isUnsaved('list-users')).toBe(true);

    const { plan } = await session.saveForCommit();
    expect(plan.writes.map((w) => w.path).sort()).toEqual([
      'examples/users-api/list-users/200-ok.body.json',
      'examples/users-api/list-users/200-ok.example.json',
    ]);
    for (const path of [
      'examples/users-api/list-users/200-ok.example.json',
      'examples/users-api/list-users/200-ok.body.json',
    ]) {
      expect(await fs.readText(path), path).toBe(await fixtureText(path));
    }
  });

  it('stores binary bodies byte for byte as .body.bin, and no sidecar without a body', async () => {
    const { fs, session } = await open({ withoutExamples: true });
    const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255, 254, 0x0a);
    const request = session.findRequest('list-users')!;
    session.apply({
      type: 'createExample',
      requestId: 'list-users',
      example: exampleFromResponse(
        request,
        response({ headers: [['Content-Type', 'image/png']], body: bytes }),
        { name: 'Avatar' },
      ),
    });
    session.apply({
      type: 'createExample',
      requestId: 'delete-user',
      example: exampleFromResponse(
        session.findRequest('delete-user')!,
        response({ status: 204, statusText: '', body: '' }),
      ),
    });
    await session.saveForCommit();
    expect(await fs.readFile('examples/users-api/list-users/avatar.body.bin')).toEqual(bytes);
    expect(
      await fs.exists('examples/users-api/admin/delete-user/204-no-content.example.json'),
    ).toBe(true);
    expect((await fs.list('examples/users-api/admin/delete-user')).map((e) => e.path)).toEqual([
      'examples/users-api/admin/delete-user/204-no-content.example.json',
    ]);
  });

  it('keeps invalid JSON as .body.txt', () => {
    const example = exampleFromResponse(
      {
        method: 'GET',
        url: { raw: '', query: [], pathVariables: [], extra: {} },
        headers: [],
        body: { mode: 'none' },
      },
      response({ headers: [['Content-Type', 'application/json']], body: '{oops' }),
    );
    expect(example.response.body).toEqual({ kind: 'text', text: '{oops', format: 'text' });
    expect(example.response.previewLanguage).toBe('text');
  });

  it('never writes the secrets a send resolved', async () => {
    const { fs, session } = await open({ withoutExamples: true });
    session.apply({
      type: 'createEnvironment',
      id: 'env',
      name: 'Local',
      values: [{ key: 'token', value: '', type: 'secret', enabled: true }],
    });
    session.setCurrentValue('env:env', 'token', 'super-secret-token');
    session.apply({
      type: 'updateRequest',
      id: 'list-users',
      patch: {
        headers: [
          { key: 'Accept', value: 'application/json' },
          { key: 'X-Token', value: '{{token}}' },
        ],
      },
    });
    const request = session.findRequest('list-users')!;
    // An echo server reflects the header in the body and a response header.
    const transport = new MockTransport().on({ url: /./ }, (req) => ({
      headers: [
        ['Content-Type', 'application/json'],
        ['X-Echo-Token', req.headers.find(([k]) => k === 'X-Token')![1]],
      ],
      body: JSON.stringify({ headers: Object.fromEntries(req.headers) }),
    }));
    let secrets: readonly string[] = [];
    const result = await new RequestExecutor(transport).execute(
      request,
      createExecutionContext({
        capabilities: MEMORY_CAPABILITIES,
        scopes: buildScopes(session.getWorkingModel(), {
          environmentId: 'env',
          currentValues: (key) => session.currentValues(key),
          itemId: 'list-users',
        }),
      }),
      { onPrepared: (req) => (secrets = req.meta.secretValues) },
    );
    expect(result.response?.bodyText).toContain('super-secret-token');
    const example = exampleFromResponse(request, result.response!, { secretValues: secrets });
    expect(JSON.stringify(example)).not.toContain('super-secret-token');
    expect(example.response.headers).toContainEqual({ key: 'X-Echo-Token', value: SECRET_MASK });
    // The definition keeps the variable, never the value.
    expect(example.request?.headers[1]).toEqual({ key: 'X-Token', value: '{{token}}' });
    session.apply({ type: 'createExample', requestId: 'list-users', example });
    await session.saveForCommit();
    for (const entry of await fs.list('', { recursive: true })) {
      if (entry.kind === 'file') {
        expect(await fs.readText(entry.path), entry.path).not.toContain('super-secret-token');
      }
    }
  });
});

describe('examples follow their request', () => {
  it('renaming the request moves its example directory (renames in the plan)', async () => {
    const { fs, session } = await open();
    session.apply({ type: 'renameItem', id: 'list-users', name: 'All users' });
    const { plan } = await session.saveForCommit();
    expect(plan.renames.map((r) => [r.from, r.to])).toEqual(
      expect.arrayContaining([
        [
          'collections/users-api/list-users.request.json',
          'collections/users-api/all-users.request.json',
        ],
        [
          'examples/users-api/list-users/200-ok.example.json',
          'examples/users-api/all-users/200-ok.example.json',
        ],
        [
          'examples/users-api/list-users/200-ok.body.json',
          'examples/users-api/all-users/200-ok.body.json',
        ],
        [
          'examples/users-api/list-users/avatar.body.bin',
          'examples/users-api/all-users/avatar.body.bin',
        ],
      ]),
    );
    expect(await fs.exists('examples/users-api/all-users/avatar.body.bin')).toBe(true);
    expect(await fs.exists('examples/users-api/list-users/200-ok.example.json')).toBe(false);
    // The user's own file keeps its directory alive.
    expect(await fs.exists('examples/users-api/list-users/notes.md')).toBe(true);
    // Orphans are never touched.
    expect(await fs.exists('examples/users-api/old-request/200-ok.example.json')).toBe(true);
  });

  it('moving a folder moves the examples of the requests inside it', async () => {
    const { fs, session } = await open();
    session.apply({ type: 'renameItem', id: 'admin-folder', name: 'Management' });
    await session.saveForCommit();
    expect(
      await fs.exists('examples/users-api/management/delete-user/204-no-content.example.json'),
    ).toBe(true);
    expect(await fs.exists('examples/users-api/admin')).toBe(false);
  });

  it('editing an example body changes only its .body.json file', async () => {
    const { session } = await open();
    const example = session.findRequest('list-users')!.examples[0]!;
    session.apply({
      type: 'updateExample',
      id: example.id,
      patch: {
        response: { ...example.response, body: { kind: 'text', text: '[]\n', format: 'json' } },
      },
    });
    const { plan } = await session.saveForCommit();
    expect(plan.writes.map((w) => w.path)).toEqual([
      'examples/users-api/list-users/200-ok.body.json',
    ]);
    expect(plan.deletes).toEqual([]);
  });

  it('renaming an example renames both files; deleting the request deletes its examples', async () => {
    const { fs, session } = await open();
    const example = session.findRequest('list-users')!.examples[0]!;
    session.apply({ type: 'renameExample', id: example.id, name: 'Success' });
    const renamed = await session.saveForCommit();
    expect(renamed.plan.renames.map((r) => r.to).sort()).toEqual([
      'examples/users-api/list-users/success.body.json',
      'examples/users-api/list-users/success.example.json',
    ]);

    session.apply({ type: 'deleteItem', id: 'list-users' });
    const deleted = await session.saveForCommit();
    expect(deleted.plan.deletes).toEqual([
      'collections/users-api/list-users.request.json',
      'examples/users-api/list-users/avatar.body.bin',
      'examples/users-api/list-users/avatar.example.json',
      'examples/users-api/list-users/success.body.json',
      'examples/users-api/list-users/success.example.json',
    ]);
    expect(await fs.exists('examples/users-api/list-users/notes.md')).toBe(true);
  });

  it('duplicating a request gives its examples new ids pointing at the copy', async () => {
    const { session } = await open();
    session.apply({ type: 'duplicateItem', id: 'list-users', newId: 'copy' });
    const copy = session.findRequest('copy')!;
    const original = session.findRequest('list-users')!;
    expect(copy.examples.map((e) => e.requestId)).toEqual(['copy', 'copy']);
    expect(copy.examples.map((e) => e.id)).not.toContain(original.examples[0]!.id);
    session.apply({ type: 'duplicateExample', id: original.examples[0]!.id, newId: 'dup' });
    expect(session.findRequest('list-users')!.examples.map((e) => e.fileKey)).toEqual([
      '200-ok',
      '200-ok-copy',
      'avatar',
    ]);
  });
});
