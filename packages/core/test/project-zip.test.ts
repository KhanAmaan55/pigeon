import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { MemoryFs } from '@pigeon/platform';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  collectProjectFiles,
  exportProjectZip,
  importProjectZip,
  readProjectZip,
} from '../src/index';

const fixtureDirectory = join(import.meta.dirname, '../../fixtures/projects/basic');

async function copyInto(fs: MemoryFs, local: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await copyInto(fs, join(local, entry.name), path);
    else await fs.writeFileAtomic(path, new Uint8Array(await readFile(join(local, entry.name))));
  }
}

describe('project zip', () => {
  it('exports project files only and imports them byte-equal', async () => {
    const source = new MemoryFs();
    await copyInto(source, fixtureDirectory);
    await source.writeFileAtomic('.gitattributes', 'pigeon.json text eol=lf\n');
    await source.writeFileAtomic(
      'examples/users-api/list-users/200-ok.body.bin',
      new Uint8Array([0, 1, 255]),
    );

    const zip = await exportProjectZip(source);
    expect(await exportProjectZip(source)).toEqual(zip); // deterministic

    const target = new MemoryFs();
    const contents = await importProjectZip(zip, target);
    expect(contents.projectName).toBe('Basic project');
    expect(contents.skipped).toEqual([]);
    const before = await collectProjectFiles(source);
    const after = await collectProjectFiles(target);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [path, bytes] of before) expect(after.get(path), path).toEqual(bytes);
    expect(before.has('collections/users-api/README.md')).toBe(false);
    expect(await target.exists('collections/users-api/README.md')).toBe(false);
  });

  it('unwraps a single top-level folder and skips unsafe or unmanaged entries', () => {
    const zip = zipSync({
      'my-api/pigeon.json': strToU8('{"name":"Wrapped"}'),
      'my-api/collections/a/collection.json': strToU8('{}'),
      'my-api/notes.txt': strToU8('x'),
      'my-api/../evil/pigeon.json': strToU8('x'),
      'other/pigeon.json': strToU8('{}'),
      'my-api/collections/a/b.request.json': strToU8('{}'),
    });
    const contents = readProjectZip(zip);
    expect([...contents.files.keys()].sort()).toEqual([
      'collections/a/b.request.json',
      'collections/a/collection.json',
      'pigeon.json',
    ]);
    expect(contents.projectName).toBe('Wrapped');
    expect(contents.skipped).toEqual([
      'my-api/../evil/pigeon.json',
      'my-api/notes.txt',
      'other/pigeon.json',
    ]);
  });

  it('rejects archives without pigeon.json and non-zip bytes', () => {
    expect(() => readProjectZip(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/no pigeon\.json/);
    expect(() => readProjectZip(new Uint8Array([1, 2, 3]))).toThrow(/not a valid zip/);
    const unnamed = readProjectZip(zipSync({ 'pigeon.json': strToU8('not json') }));
    expect(unnamed.projectName).toBeUndefined();
  });
});
