import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryFs } from '@pigeon/platform';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';

import {
  createEmptyProject,
  detectFormat,
  exportCollection,
  exportCollectionText,
  importPostmanCollection,
  readProject,
  serializeProject,
} from '../src/index';
import { normalizePostman } from './postman-normalize';

const fixtures = fileURLToPath(new URL('../../fixtures/postman/', import.meta.url));
const COLLECTIONS = readdirSync(fixtures).filter((name) => /\.v2\.[01]\.json$/.test(name));
const schema = JSON.parse(readFileSync(join(fixtures, 'schema/collection-v2.1.0.json'), 'utf8'));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

/** Import → project files → read back → the imported collection (what an export starts from). */
async function importThroughFiles(name: string) {
  const detected = detectFormat(readFileSync(join(fixtures, name)));
  if (detected.kind !== 'postman-collection') throw new Error(name);
  const { collection } = importPostmanCollection(detected.data, detected.version);
  const fs = new MemoryFs();
  for (const [path, bytes] of serializeProject({
    ...createEmptyProject('P').model,
    collections: [collection],
  })) {
    await fs.writeFileAtomic(path, bytes);
  }
  const read = await readProject(fs);
  expect(read.problems).toEqual([]);
  return { source: detected.data, collection: read.model.collections[0]! };
}

describe('Postman export (PIGN-029)', () => {
  it.each(COLLECTIONS)('%s: export validates and round-trips with the original', async (name) => {
    const { source, collection } = await importThroughFiles(name);
    const { data, warnings } = exportCollection(collection);
    expect(warnings).toEqual([]);
    const valid = validate(data);
    expect(validate.errors ?? [], JSON.stringify(validate.errors)).toEqual([]);
    expect(valid).toBe(true);
    expect(normalizePostman(data)).toEqual(normalizePostman(source));
  });

  it('regenerates URL parts, strips _pigeon unless asked, and inlines example bodies', async () => {
    const { collection } = await importThroughFiles('examples.v2.1.json');
    const request = collection.children[0]!;
    if (request.kind !== 'request') throw new Error('request');
    request.settings.timeoutMs = 1500;
    const plain = exportCollection(collection).data as {
      item: Array<{
        request: { url: Record<string, unknown> };
        response: Array<Record<string, unknown>>;
        _pigeon?: unknown;
      }>;
    };
    expect(plain.item[0]!.request.url).toMatchObject({
      raw: '{{baseUrl}}/users?limit=20',
      host: ['{{baseUrl}}'],
      path: ['users'],
    });
    expect(plain.item[0]!._pigeon).toBeUndefined();
    expect(plain.item[0]!.response[0]).toMatchObject({
      name: '200 OK',
      body: '[{"id":1,"name":"Ada Lovelace","big":12345678901234567890}]',
    });
    expect(JSON.stringify(plain)).not.toContain('bodyFile');
    expect(JSON.stringify(plain)).not.toContain('requestId');

    const withMetadata = exportCollection(collection, { includePigeonMetadata: true })
      .data as typeof plain;
    expect(withMetadata.item[0]!._pigeon).toEqual({ timeoutMs: 1500 });
    const withoutExamples = exportCollection(collection, { includeExamples: false })
      .data as typeof plain;
    expect(withoutExamples.item[0]!.response).toBeUndefined();
  });

  it('exports a folder as a collection', async () => {
    const { collection } = await importThroughFiles('unknown-fields.v2.1.json');
    const folder = collection.children[0]!;
    if (folder.kind !== 'folder') throw new Error('folder');
    const result = exportCollection(folder);
    expect(result.fileName).toBe('Folder.postman_collection.json');
    expect(validate(result.data)).toBe(true);
    expect(result.data).toMatchObject({
      info: { _postman_id: 'f1', name: 'Folder', description: { content: 'Folder docs' } },
      item: [{ id: 'r1', name: 'Request' }],
      variable: [{ key: 'v', value: '1' }],
      'x-folder': { a: 1 },
    });
    expect(exportCollectionText(result).startsWith('{\n\t"info"')).toBe(true);
  });
});
