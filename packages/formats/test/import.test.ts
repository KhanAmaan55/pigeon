import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { Collection, ProjectItem, ProjectModel, ProjectRequest } from '../src/index';
import {
  createEmptyProject,
  detectFormat,
  importPostmanCollection,
  readProject,
  serializeProject,
} from '../src/index';

const fixtures = fileURLToPath(new URL('../../fixtures/postman/', import.meta.url));
const COLLECTIONS = readdirSync(fixtures).filter((name) => /\.v2\.[01]\.json$/.test(name));

function load(name: string) {
  const detected = detectFormat(readFileSync(join(fixtures, name)));
  if (detected.kind !== 'postman-collection') throw new Error(`${name}: ${detected.kind}`);
  return detected;
}

let counter = 0;
const ids = () => `generated-${++counter}`;

function importFixture(name: string, existingIds: Set<string> = new Set()) {
  counter = 0;
  const detected = load(name);
  return importPostmanCollection(detected.data, detected.version, { existingIds, newId: ids });
}

function walk(items: readonly ProjectItem[]): ProjectItem[] {
  return items.flatMap((item) =>
    item.kind === 'folder' ? [item, ...walk(item.children)] : [item],
  );
}

function request(collection: Collection, id: string): ProjectRequest {
  const found = walk(collection.children).find((item) => item.id === id);
  if (found?.kind !== 'request') throw new Error(id);
  return found;
}

/** A project holding just `collection`, written and read back. */
async function roundTrip(
  collection: Collection,
): Promise<{ files: Map<string, string>; model: ProjectModel }> {
  const empty = createEmptyProject('P');
  const model: ProjectModel = { ...empty.model, collections: [collection] };
  const fs = new MemoryFs();
  const files = new Map<string, string>();
  for (const [path, bytes] of serializeProject(model)) {
    await fs.writeFileAtomic(path, bytes);
    files.set(path, new TextDecoder().decode(bytes));
  }
  const read = await readProject(fs);
  expect(read.problems).toEqual([]);
  return { files, model: read.model };
}

describe('detectFormat', () => {
  it('recognizes v2.1, v2.0, v1 (rejected) and non-collections', () => {
    expect(load('echo-basic.v2.1.json').version).toBe('2.1');
    expect(load('legacy.v2.0.json').version).toBe('2.0');
    const v1 = detectFormat(readFileSync(join(fixtures, 'v1.json')));
    expect(v1).toMatchObject({ kind: 'rejected', format: 'Postman Collection v1' });
    expect(v1.kind === 'rejected' && v1.message).toMatch(
      /Re-export it from Postman as Collection v2\.1/,
    );
    expect(detectFormat('not json')).toMatchObject({ kind: 'unknown' });
    expect(detectFormat('[]')).toMatchObject({ kind: 'unknown' });
    expect(detectFormat({ name: 'Env', values: [] })).toMatchObject({
      kind: 'postman-environment',
    });
    expect(detectFormat({ values: [], _postman_variable_scope: 'globals' })).toMatchObject({
      kind: 'postman-globals',
    });
    expect(
      detectFormat(
        '\uFEFF{"info":{"schema":"https://schema.postman.com/json/collection/v2.1.0/collection.json"},"item":[]}',
      ),
    ).toMatchObject({ version: '2.1' });
  });
});

describe('importPostmanCollection (PIGN-028)', () => {
  it.each(COLLECTIONS)(
    '%s imports, writes valid project files and reads back identically',
    async (name) => {
      const { collection, report } = importFixture(name);
      expect(report).toMatchSnapshot();
      const { model } = await roundTrip(collection);
      expect(model.collections[0]).toEqual(collection);
    },
  );

  it('keeps unknown keys at every level in the written files', async () => {
    const { collection } = importFixture('unknown-fields.v2.1.json');
    const { files } = await roundTrip(collection);
    const all = [...files.values()].join('\n');
    for (const key of [
      'x-root',
      'x-info',
      '_exporter_id',
      'x-auth',
      'x-var',
      'x-folder',
      'x-item',
      'x-ppb',
      'x-request',
      'proxy',
      'certificate',
      'x-header',
      'x-q',
      'x-body',
      'x-example',
      'itemVar',
    ]) {
      expect(all, key).toContain(`"${key}"`);
    }
    const r1 = request(collection, 'r1');
    expect(r1.url.extra).toEqual({ hash: 'frag' });
    expect(r1.settings).toMatchObject({ disableBodyPruning: true, followRedirects: false });
  });

  it('maps v2.0 auth objects and header strings to their v2.1 equivalents', () => {
    const { collection, report } = importFixture('legacy.v2.0.json');
    expect(collection.auth).toMatchObject({ type: 'basic', username: 'user', password: 'pass' });
    const bearer = request(collection, 'legacy-bearer');
    expect(bearer.auth).toMatchObject({ type: 'bearer', token: '{{token}}' });
    expect(bearer.headers).toEqual([
      { key: 'Accept', value: 'application/json' },
      { key: 'X-Legacy', value: '1' },
    ]);
    expect(bearer.examples[0]!.response.headers).toEqual([
      { key: 'Content-Type', value: 'application/json' },
    ]);
    expect(collection.extra['info']).toBeUndefined();
    expect(report.warnings).toContain('Converted from Postman Collection v2.0 to v2.1.');
    // Same auth as the v2.1 file would give.
    const v21 = importPostmanCollection(
      {
        info: { name: 'x' },
        auth: {
          type: 'basic',
          basic: [
            { key: 'username', value: 'user', type: 'string' },
            { key: 'password', value: 'pass', type: 'string' },
            { key: 'showPassword', value: false, type: 'boolean' },
          ],
        },
        item: [],
      },
      '2.1',
    );
    const strip = ({ source: _source, ...auth }: Record<string, unknown>) => auth;
    expect(strip(collection.auth as never)).toEqual(strip(v21.collection.auth as never));
  });

  it('turns responses into examples with sidecar bodies; all headers are kept', async () => {
    const { collection } = importFixture('examples.v2.1.json');
    const list = request(collection, 'list-users');
    expect(
      list.examples.map((e) => [
        e.fileKey,
        e.response.body.kind,
        e.response.body.kind === 'text' ? e.response.body.format : '-',
      ]),
    ).toEqual([
      ['200-ok', 'text', 'json'],
      ['204-no-content', 'none', '-'],
      ['404-not-found', 'text', 'html'],
      ['broken-json', 'text', 'text'],
      ['xml', 'text', 'xml'],
    ]);
    expect(list.examples[0]!.response.headers.map((h) => h.key)).toEqual([
      'Content-Type',
      'Date',
      'ETag',
    ]);
    expect(list.examples[0]!.response.responseTimeMs).toBe(42);
    expect(list.examples.every((e) => e.requestId === 'list-users')).toBe(true);
    const { files } = await roundTrip(collection);
    expect(files.get('examples/examples/list-users/200-ok.body.json')).toBe(
      '[{"id":1,"name":"Ada Lovelace","big":12345678901234567890}]',
    );
    expect(files.get('examples/examples/list-users/404-not-found.body.html')).toBe(
      '<h1>Not found</h1>',
    );
    expect(files.get('examples/examples/list-users/broken-json.body.txt')).toBe('{not json');
    expect(files.has('examples/examples/list-users/xml.body.xml')).toBe(true);
    expect(JSON.parse(files.get('examples/examples/list-users/xml.example.json')!)).toMatchObject({
      'x-response-extra': true,
      cookie: [{ name: 'sid' }],
    });
  });

  it('keeps free ids, regenerates taken ones and gives missing ones an id', () => {
    const { collection, report } = importFixture('nested-folders.v2.1.json', new Set(['nested']));
    expect(collection.id).toBe('generated-1');
    expect(report.regeneratedIds).toEqual([
      { kind: 'collection', name: 'Nested folders 🐦', from: 'nested', to: 'generated-1' },
      { kind: 'folder', name: 'Duplicate id folder', from: 'folder-5-1', to: 'generated-2' },
      { kind: 'request', name: 'Duplicate id request', from: 'leaf-1', to: 'generated-3' },
    ]);
    const keys = walk(collection.children).map((item) => item.fileKey);
    expect(keys).toContain('same-name');
    expect(keys).toContain('same-name-2');
    expect(collection.fileKey).toBe('nested-folders');
    expect(walk(collection.children).some((item) => item.fileKey === 'request-73e1')).toBe(false);
    const basic = importFixture('echo-basic.v2.1.json');
    expect(basic.report.warnings).toContain('1 item without an id got one.');
  });

  it('reports unsupported auth, scripts, absolute paths and URL mismatches', () => {
    expect(importFixture('auth.v2.1.json').report.warnings).toEqual([
      'hawk auth (1×) is not supported yet: kept as is, requests are sent without it.',
      'ntlm auth (1×) is not supported yet: kept as is, requests are sent without it.',
    ]);
    // Scripts run (PIGN-043/044): only APIs the sandbox lacks are reported.
    expect(importFixture('scripts.v2.1.json').report.warnings).toEqual([]);
    const bodies = importFixture('bodies.v2.1.json').report.warnings.join('\n');
    expect(bodies).toContain('Form data: /Users/ada/avatar.png');
    expect(bodies).toContain('Binary file: C:\\data\\upload.bin');
    expect(bodies).not.toContain('fixtures/a.txt');
    expect(importFixture('echo-basic.v2.1.json').report.warnings.join('\n')).toContain(
      'URL parts disagree with the raw URL (the raw URL is used): Derived parts disagree.',
    );
  });

  it('names scripts that use pm APIs the sandbox does not support', () => {
    const script = (exec: string[]) => [{ listen: 'prerequest', script: { exec } }];
    const { report } = importPostmanCollection(
      {
        info: {
          name: 'S',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        event: script(['pm.sendRequest({ url: "x" }, () => {});']),
        item: [
          {
            name: 'Folder',
            event: script(['const _ = require("lodash");']),
            item: [
              {
                name: 'Req',
                event: script(['pm.sendRequest("x")', 'pm.environment.set("a", 1)']),
                request: { method: 'GET', url: 'http://a' },
              },
            ],
          },
          {
            name: 'Fine',
            event: script(['pm.test("ok", () => {})']),
            request: { method: 'GET', url: 'http://b' },
          },
        ],
      },
      '2.1',
      {
        newId: (() => {
          let n = 0;
          return () => `s-${++n}`;
        })(),
      },
    );
    expect(report.warnings.filter((w) => w.startsWith('Scripts use'))).toEqual([
      "Scripts use pm.sendRequest, which Pigeon's script sandbox does not support (it throws when reached): the collection, Folder/Req.",
      "Scripts use require(), which Pigeon's script sandbox does not support (it throws when reached): Folder.",
    ]);
  });

  it('fills a path variable without a value from the URL path parts, as Postman sends it', () => {
    const request = (raw: string, path: string[], variable?: unknown[]) => ({
      name: raw,
      request: {
        method: 'GET',
        url: { raw, host: ['{{base_url}}'], path, ...(variable ? { variable } : {}) },
      },
    });
    const { collection, report } = importPostmanCollection(
      {
        info: {
          name: 'Airport Gap',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          // The real Airport Gap collection: raw has `:airport_id`, the parts the variable.
          request('{{base_url}}/airports/:airport_id', ['airports', '{{airport_id}}']),
          request(
            '{{base_url}}/favorites/:id/x',
            ['favorites', '22', 'x'],
            [{ key: 'id', value: '' }],
          ),
          // A value is set: ambiguous, the raw URL wins as before.
          request('{{base_url}}/users/:id', ['users', '7'], [{ key: 'id', value: '5' }]),
          // Not a path variable that differs: the raw URL wins as before.
          request('{{base_url}}/v2/users', ['v1', 'users']),
        ],
      },
      '2.1',
      {
        newId: (() => {
          let n = 0;
          return () => `id-${++n}`;
        })(),
      },
    );
    const urls = collection.children.map((item) =>
      item.kind === 'request' ? item.url : undefined,
    );
    expect(urls[0]).toMatchObject({
      raw: '{{base_url}}/airports/:airport_id',
      pathVariables: [{ key: 'airport_id', value: '{{airport_id}}' }],
    });
    expect(urls[1]).toMatchObject({ pathVariables: [{ key: 'id', value: '22' }] });
    expect(urls[2]).toMatchObject({ pathVariables: [{ key: 'id', value: '5' }] });
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        "Path variables without a value were filled from the URL's path parts (as Postman sends them): {{base_url}}/airports/:airport_id (:airport_id = {{airport_id}}); {{base_url}}/favorites/:id/x (:id = 22).",
        'URL parts disagree with the raw URL (the raw URL is used): {{base_url}}/users/:id, {{base_url}}/v2/users.',
      ]),
    );
  });

  it('imports a 5,000-request collection in well under 5 s', () => {
    const items = Array.from({ length: 50 }, (_, f) => ({
      id: `f${f}`,
      name: `Folder ${f}`,
      item: Array.from({ length: 100 }, (_, r) => ({
        id: `f${f}-r${r}`,
        name: `Request ${r}`,
        request: {
          method: 'GET',
          header: [{ key: 'Accept', value: '*/*' }],
          url: `{{baseUrl}}/items/${f}/${r}?x=1`,
        },
        response: [{ name: 'OK', code: 200, status: 'OK', header: [], body: '{"ok":true}' }],
      })),
    }));
    const started = performance.now();
    const { collection, report } = importPostmanCollection(
      { info: { name: 'Big' }, item: items },
      '2.1',
    );
    const serialized = serializeProject({
      ...createEmptyProject('P').model,
      collections: [collection],
    });
    expect(performance.now() - started).toBeLessThan(5000);
    expect(report.counts).toEqual({ folders: 50, requests: 5000, examples: 5000 });
    expect(serialized.size).toBeGreaterThan(15_000);
  });
});
