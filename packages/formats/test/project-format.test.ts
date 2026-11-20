import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import { requestFromPostmanItem, requestToPostmanItem } from '../src/postman/item';
import { createEmptyProject } from '../src/project/create';
import { readProject } from '../src/project/reader';
import type { ProjectRequest } from '../src/project/types';
import { serializeProject } from '../src/project/writer';

const decoder = new TextDecoder();
const fixtureDirectory = fileURLToPath(new URL('../../fixtures/projects/basic/', import.meta.url));
const UNMANAGED = 'collections/users-api/README.md';

describe('golden fixture: projects/basic', () => {
  it('round-trips byte-for-byte and ignores unmanaged files', async () => {
    const { fs, files } = await fixtureFs();
    const result = await readProject(fs);

    if (process.env['UPDATE_GOLDEN'] === '1') {
      for (const [path, bytes] of serializeProject(result.model)) {
        await mkdir(dirname(join(fixtureDirectory, path)), { recursive: true });
        await writeFile(join(fixtureDirectory, path), bytes);
      }
      return;
    }

    expect(result.problems).toEqual([]);
    expect(result.readOnly).toBe(false);
    expect(result.files.has(UNMANAGED)).toBe(false);
    expect(result.model.collections.map((c) => c.fileKey)).toEqual(['users-api', 'billing']);
    expect(result.model.collections[0]?.children.map((child) => child.fileKey)).toEqual([
      'list-users',
      'admin',
      'create-user',
    ]);

    const serialized = serializeProject(result.model);
    expect([...serialized.keys()].sort()).toEqual(
      [...files.keys()].filter((path) => path !== UNMANAGED).sort(),
    );
    for (const [path, bytes] of serialized) {
      expect(decoder.decode(bytes), path).toBe(decoder.decode(files.get(path)));
    }
  });

  it('records a sha-256 per managed file', async () => {
    const { fs } = await fixtureFs();
    const { files } = await readProject(fs);
    expect(files.get('pigeon.json')?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(files.size).toBe(11);
  });

  it('keeps unknown fields at collection, folder, item, request, url, header and body levels', async () => {
    const { fs } = await fixtureFs();
    const { model } = await readProject(fs);
    const collection = model.collections[0]!;
    const list = collection.children[0] as ProjectRequest;
    const admin = collection.children[1]!;

    expect(model.extra).toEqual({ 'x-project': true });
    expect(collection.extra).toEqual({
      'x-collection': 1,
      info: { 'x-info': 'preserved' },
      _pigeon: { 'x-pigeon': 'kept' },
    });
    expect(admin.extra).toEqual({ 'x-folder': 'kept', _pigeon: { 'x-pigeon': 'kept' } });
    expect(list).toMatchObject({
      extra: {
        'x-item': 'kept',
        request: { 'x-request': 'kept' },
        protocolProfileBehavior: { 'x-profile': 'kept' },
      },
      url: { extra: { 'x-url': 'kept' } },
      headers: [{ extra: { 'x-header': 'kept' } }],
      body: { mode: 'raw', language: 'json', extra: { 'x-body': 'kept' } },
      settings: { followRedirects: true },
    });
  });

  it('maps rows, settings and file sources into the model', async () => {
    const { fs } = await fixtureFs();
    const { model } = await readProject(fs);
    const [getInvoices, payInvoice] = model.collections[1]!.children as ProjectRequest[];

    expect(getInvoices!.url.query).toEqual([
      { key: 'status', value: 'open' },
      { key: 'archived', value: '', extra: { valueNull: true } },
      { key: 'page', value: '' },
      { key: 'debug', value: '1', disabled: true, description: 'Server-side debug flag' },
    ]);
    expect(getInvoices!.settings).toEqual({ timeoutMs: 5000 });
    expect(getInvoices!.body).toEqual({ mode: 'none' });
    expect(payInvoice!.settings).toEqual({
      followRedirects: false,
      maxRedirects: 3,
      strictSSL: false,
      disableBodyPruning: true,
    });
    expect(payInvoice!.body).toEqual({ mode: 'file', src: 'receipts/invoice.pdf' });
  });
});

describe('readProject tolerance', () => {
  it('reports invalid JSON as a parse problem and loads the rest', async () => {
    const fs = await minimalProject();
    await fs.writeFileAtomic('collections/api/broken.request.json', '{ invalid');
    await fs.writeFileAtomic('collections/api/good.request.json', request('good'));

    const result = await readProject(fs);
    const children = result.model.collections[0]!.children;

    expect(result.problems).toEqual([
      expect.objectContaining({
        path: 'collections/api/broken.request.json',
        kind: 'parse',
        severity: 'error',
      }),
    ]);
    expect(children.map((child) => [child.fileKey, child.broken])).toEqual([
      ['broken', true],
      ['good', undefined],
    ]);
    expect(result.files.has('collections/api/broken.request.json')).toBe(true);
  });

  it('keeps id and name of a schema-invalid file and still reads a broken folder’s children', async () => {
    const fs = await minimalProject();
    await fs.writeFileAtomic(
      'collections/api/odd.request.json',
      JSON.stringify({ id: 'odd-id', name: 'Odd' }),
    );
    await fs.writeFileAtomic('collections/api/admin/folder.json', '<<<<<<< HEAD\n{}');
    await fs.writeFileAtomic('collections/api/admin/inner.request.json', request('inner'));
    await fs.writeFileAtomic('collections/api/list.request.json', '[]');

    const result = await readProject(fs);
    const [admin, list, odd] = result.model.collections[0]!.children;

    expect(odd).toMatchObject({ id: 'odd-id', name: 'Odd', broken: true });
    expect(list).toMatchObject({ id: 'broken:request:list', name: 'list', broken: true });
    expect(admin).toMatchObject({ kind: 'folder', broken: true, children: [{ fileKey: 'inner' }] });
    expect(result.problems.map((p) => [p.path, p.kind])).toEqual([
      ['collections/api/admin/folder.json', 'parse'],
      ['collections/api/list.request.json', 'schema'],
      ['collections/api/odd.request.json', 'schema'],
    ]);

    // Broken files are never written but keep their place in the order.
    const files = serializeProject(result.model);
    expect(files.has('collections/api/odd.request.json')).toBe(false);
    expect(files.has('collections/api/admin/folder.json')).toBe(false);
    expect(files.has('collections/api/admin/inner.request.json')).toBe(true);
    expect(
      JSON.parse(decoder.decode(files.get('collections/api/collection.json')))._pigeon.order,
    ).toEqual(['admin', 'list', 'odd']);
  });

  it('marks a broken collection and keeps its requests', async () => {
    const fs = await minimalProject();
    await fs.writeFileAtomic(
      'collections/api/collection.json',
      JSON.stringify({ info: { name: 'No id' } }),
    );
    await fs.writeFileAtomic('collections/api/one.request.json', request('one'));

    const result = await readProject(fs);
    expect(result.model.collections[0]).toMatchObject({
      broken: true,
      name: 'No id',
      children: [{ id: 'one' }],
    });
    expect(serializeProject(result.model).has('collections/api/collection.json')).toBe(false);
  });

  it('appends children missing from _pigeon.order alphabetically and warns about stale entries', async () => {
    const fs = await minimalProject({ order: ['zeta', 'stale'] });
    for (const name of ['beta', 'zeta', 'alpha']) {
      await fs.writeFileAtomic(`collections/api/${name}.request.json`, request(name));
    }

    const result = await readProject(fs);

    expect(result.model.collections[0]!.children.map((child) => child.fileKey)).toEqual([
      'zeta',
      'alpha',
      'beta',
    ]);
    expect(result.problems).toEqual([
      {
        path: 'collections/api/collection.json',
        kind: 'order',
        severity: 'warning',
        message: 'Order entry "stale" does not exist',
      },
    ]);
  });

  it('orders collections by pigeon.json, appending unlisted ones', async () => {
    const fs = await minimalProject();
    for (const key of ['zz', 'aa']) {
      await fs.writeFileAtomic(
        `collections/${key}/collection.json`,
        JSON.stringify({ info: { _postman_id: key, name: key } }),
      );
    }
    await fs.mkdirp('collections/not-a-collection');
    const result = await readProject(fs);
    expect(result.model.collections.map((c) => c.fileKey)).toEqual(['api', 'aa', 'zz']);
  });

  it('ignores environments, examples and unmanaged files', async () => {
    const fs = await minimalProject();
    await fs.writeFileAtomic(
      'environments/local.postman_environment.json',
      '{"name":"Local","values":[]}',
    );
    await fs.writeFileAtomic('examples/api/one/200-ok.example.json', '{}');
    await fs.writeFileAtomic('collections/api/notes.txt', 'hello');
    await fs.writeFileAtomic('collections/api/.request.json', '{}');
    await fs.writeFileAtomic('collections/api/plain-dir/readme.md', '#');

    const result = await readProject(fs);
    expect(result.problems).toEqual([]);
    expect(result.model.collections[0]!.children).toEqual([]);
    expect([...result.files.keys()]).toEqual(['pigeon.json', 'collections/api/collection.json']);
  });

  it('flags a missing or invalid pigeon.json and newer format versions', async () => {
    const missing = await readProject(new MemoryFs());
    expect(missing.readOnly).toBe(true);
    expect(missing.problems).toEqual([
      expect.objectContaining({ path: 'pigeon.json', kind: 'missing' }),
    ]);

    const invalid = new MemoryFs();
    await invalid.writeFileAtomic('pigeon.json', '{"id": 3}');
    expect((await readProject(invalid)).problems).toEqual([
      expect.objectContaining({ kind: 'schema' }),
    ]);

    const unparsable = new MemoryFs();
    await unparsable.writeFileAtomic('pigeon.json', new Uint8Array([0xff, 0xfe, 0x00]));
    expect((await readProject(unparsable)).problems).toEqual([
      expect.objectContaining({ kind: 'parse' }),
    ]);

    const newer = new MemoryFs();
    await newer.writeFileAtomic('pigeon.json', manifest({ formatVersion: 2 }));
    const result = await readProject(newer);
    expect(result.readOnly).toBe(true);
    expect(result.model.formatVersion).toBe(2);
  });
});

describe('Postman item mapping', () => {
  const roundTrip = (item: Record<string, unknown>): Record<string, unknown> =>
    requestToPostmanItem(requestFromPostmanItem(item, 'key'));

  it('preserves unsupported body modes verbatim', () => {
    const body = { mode: 'graphql', graphql: { query: '{ me { id } }', variables: '' } };
    const item = {
      id: 'g',
      name: 'G',
      request: { method: 'POST', url: { raw: '/graphql' }, body },
    };
    const request = requestFromPostmanItem(item, 'g');
    expect(request.body.mode).toBe('none');
    expect(roundTrip(item)).toEqual(item);
  });

  it('keeps raw options and an unknown raw language unchanged', () => {
    const item = {
      id: 'r',
      name: 'R',
      request: {
        method: 'POST',
        url: { raw: '/r' },
        body: { mode: 'raw', raw: 'a: 1', options: { raw: { language: 'yaml' }, extra: true } },
      },
    };
    expect(requestFromPostmanItem(item, 'r').body).toMatchObject({ language: 'text' });
    expect(roundTrip(item)).toEqual(item);
  });

  it('writes a changed raw language and omits default options', () => {
    const request = requestFromPostmanItem(
      { id: 'r', name: 'R', request: { method: 'post', url: '/r' } },
      'r',
    );
    expect(request.method).toBe('POST');
    expect(request.url).toEqual({ raw: '/r', query: [], pathVariables: [], extra: {} });
    request.body = { mode: 'raw', raw: '{}', language: 'json' };
    expect(requestToPostmanItem(request)['request']).toMatchObject({
      body: { mode: 'raw', raw: '{}', options: { raw: { language: 'json' } } },
    });
    request.body = { mode: 'raw', raw: 'x', language: 'text' };
    expect((requestToPostmanItem(request)['request'] as { body: unknown }).body).toEqual({
      mode: 'raw',
      raw: 'x',
    });
  });

  it('round-trips disabled bodies, invalid descriptions, non-array events and odd values', () => {
    const item = {
      id: 'x',
      name: 'X',
      request: {
        method: 'GET',
        url: { raw: '/x', protocol: 'https', host: ['x'] },
        header: [{ key: 'n', value: 'v', description: 42 }],
        body: { mode: 'none', disabled: true },
        description: { content: 'Doc', type: 'text/markdown' },
      },
      event: 'not-an-array',
    };
    const request = requestFromPostmanItem(item, 'x');
    expect(request.headers[0]).toEqual({ key: 'n', value: 'v', extra: { description: 42 } });
    expect(request.url.extra).toEqual({});
    const written = requestToPostmanItem(request);
    expect(written).toEqual({ ...item, request: { ...item.request, url: { raw: '/x' } } });

    const numeric = requestFromPostmanItem(
      {
        id: 'n',
        name: 'N',
        request: { method: 'GET', url: '/n', header: [{ key: 'a', value: 5 }, { key: 'b' }] },
      },
      'n',
    );
    expect(numeric.headers).toEqual([
      { key: 'a', value: '5' },
      { key: 'b', value: '' },
    ]);
  });

  it('keeps unknown file-body keys and form-data rows with invalid src', () => {
    const item = {
      id: 'f',
      name: 'F',
      request: {
        method: 'POST',
        url: { raw: '/f' },
        body: {
          mode: 'formdata',
          formdata: [
            { key: 'bad', type: 'file', src: [1] },
            { key: 'txt', value: 'v', type: 'text' },
          ],
        },
      },
    };
    expect(roundTrip(item)).toEqual({
      ...item,
      request: {
        ...item.request,
        body: {
          mode: 'formdata',
          formdata: [
            { key: 'bad', value: '', type: 'file', src: [1] },
            item.request.body.formdata[1],
          ],
        },
      },
    });
    const file = {
      id: 'b',
      name: 'B',
      request: {
        method: 'POST',
        url: { raw: '/b' },
        body: { mode: 'file', file: { content: 'x' } },
      },
    };
    expect(roundTrip(file)).toEqual(file);
  });
});

describe('createEmptyProject', () => {
  it('creates a format-v1 manifest and LF .gitattributes that read back cleanly', async () => {
    const created = createEmptyProject('New project');

    expect(created.model).toMatchObject({ name: 'New project', formatVersion: 1, collections: [] });
    expect(decoder.decode(created.files.get('pigeon.json'))).toBe(
      `{\n  "pigeon": {\n    "formatVersion": 1\n  },\n  "id": "${created.model.id}",\n  "name": "New project",\n  "collections": []\n}\n`,
    );
    expect(decoder.decode(created.files.get('.gitattributes'))).toBe(
      'pigeon.json text eol=lf\ncollections/** text eol=lf\nenvironments/** text eol=lf\nexamples/** text eol=lf\nexamples/**/*.body.bin binary\n',
    );

    const fs = new MemoryFs();
    for (const [path, bytes] of created.files) await fs.writeFileAtomic(path, bytes);
    const read = await readProject(fs);
    expect(read.problems).toEqual([]);
    expect(read.model).toEqual(created.model);
  });
});

// --- helpers -----------------------------------------------------------------------------------

function manifest({ formatVersion = 1, collections = ['api'] } = {}): string {
  return JSON.stringify({ pigeon: { formatVersion }, id: 'project', name: 'Project', collections });
}

function request(id: string): string {
  return JSON.stringify({ id, name: id, request: { method: 'GET', url: { raw: `/${id}` } } });
}

async function minimalProject({ order }: { order?: string[] } = {}): Promise<MemoryFs> {
  const fs = new MemoryFs();
  await fs.writeFileAtomic('pigeon.json', manifest());
  await fs.writeFileAtomic(
    'collections/api/collection.json',
    JSON.stringify({
      info: { _postman_id: 'api', name: 'API' },
      ...(order ? { _pigeon: { order } } : {}),
    }),
  );
  return fs;
}

async function fixtureFs(): Promise<{ fs: MemoryFs; files: Map<string, Uint8Array> }> {
  const fs = new MemoryFs();
  const files = new Map<string, Uint8Array>();
  await copyDirectory(fixtureDirectory, '', fs, files);
  return { fs, files };
}

async function copyDirectory(
  localDirectory: string,
  projectDirectory: string,
  fs: MemoryFs,
  files: Map<string, Uint8Array>,
): Promise<void> {
  for (const entry of await readdir(localDirectory, { withFileTypes: true })) {
    const projectPath = projectDirectory === '' ? entry.name : `${projectDirectory}/${entry.name}`;
    const localPath = join(localDirectory, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(localPath, projectPath, fs, files);
      continue;
    }
    const bytes = new Uint8Array(await readFile(localPath));
    files.set(projectPath, bytes);
    await fs.writeFileAtomic(projectPath, bytes);
  }
}
