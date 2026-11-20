import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { ProjectModel, ProjectRequest } from '../src/index';
import {
  decodeBase64,
  encodeBase64,
  exampleBodyFileName,
  exampleBodyFromFile,
  isManagedPath,
  readProject,
  serializeProject,
} from '../src/index';

const fixtureDirectory = fileURLToPath(
  new URL('../../fixtures/projects/examples/', import.meta.url),
);
const decoder = new TextDecoder();

async function copyInto(
  local: string,
  project: string,
  fs: MemoryFs,
  files: Map<string, Uint8Array>,
) {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = project === '' ? entry.name : `${project}/${entry.name}`;
    if (entry.isDirectory()) {
      await copyInto(join(local, entry.name), path, fs, files);
      continue;
    }
    const bytes = new Uint8Array(await readFile(join(local, entry.name)));
    files.set(path, bytes);
    await fs.writeFileAtomic(path, bytes);
  }
}

async function fixture() {
  const fs = new MemoryFs();
  const files = new Map<string, Uint8Array>();
  await copyInto(fixtureDirectory, '', fs, files);
  return { files, result: await readProject(fs) };
}

function request(model: ProjectModel, id: string): ProjectRequest {
  const visit = (
    items: ProjectModel['collections'][number]['children'],
  ): ProjectRequest | undefined => {
    for (const item of items) {
      if (item.kind === 'request' && item.id === id) return item;
      if (item.kind === 'folder') {
        const found = visit(item.children);
        if (found) return found;
      }
    }
    return undefined;
  };
  return visit(model.collections[0]!.children)!;
}

describe('golden fixture: projects/examples (PIGN-027)', () => {
  it('round-trips examples and their body sidecars byte-for-byte', async () => {
    const { files, result } = await fixture();
    const serialized = serializeProject(result.model);
    if (process.env['UPDATE_GOLDEN'] === '1') {
      for (const [path, bytes] of serialized) {
        await mkdir(dirname(join(fixtureDirectory, path)), { recursive: true });
        await writeFile(join(fixtureDirectory, path), bytes);
      }
      return;
    }
    const managed = [...files.keys()].filter(isManagedPath).sort();
    expect([...serialized.keys()].sort()).toEqual(managed);
    for (const [path, bytes] of serialized) {
      expect(decoder.decode(bytes), path).toBe(decoder.decode(files.get(path)));
      expect(bytes, path).toEqual(files.get(path));
    }
    // Every example file and sidecar was hashed (known paths for the commit planner).
    for (const path of managed) expect(result.files.has(path), path).toBe(true);
  });

  it('attaches examples to their request, sorted by file key, with typed bodies', async () => {
    const { result } = await fixture();
    const list = request(result.model, 'list-users');
    expect(list.examples.map((e) => e.fileKey)).toEqual(['200-ok', 'avatar']);
    const [ok, avatar] = list.examples;
    expect(ok).toMatchObject({
      id: 'example-200',
      requestId: 'list-users',
      name: '200 OK',
      request: { method: 'GET', url: { raw: '{{baseUrl}}/users?limit=20' } },
      response: {
        code: 200,
        status: 'OK',
        previewLanguage: 'json',
        headers: [{ key: 'Content-Type', value: 'application/json; charset=utf-8' }],
        body: { kind: 'text', format: 'json' },
      },
    });
    expect(ok!.response.body.kind === 'text' && ok!.response.body.text).toContain(
      '12345678901234567890',
    );
    expect(avatar!.response.body.kind).toBe('binary');
    expect(
      avatar!.response.body.kind === 'binary' && [...decodeBase64(avatar!.response.body.base64)],
    ).toEqual([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255, 254, 0x0a]);
    expect(avatar!.response.responseTimeMs).toBe(12);
    expect(avatar!.extra).toEqual({ 'x-example': 'kept', _pigeon: { 'x-pigeon': 'kept' } });

    const deleteUser = request(result.model, 'delete-user');
    expect(deleteUser.examples[0]).toMatchObject({
      fileKey: '204-no-content',
      response: { code: 204, body: { kind: 'none' } },
    });
    expect(exampleBodyFileName(deleteUser.examples[0]!)).toBeUndefined();
  });

  it('keeps examples of unknown requests as orphans and reports them', async () => {
    const { result } = await fixture();
    expect(result.model.orphanExamples).toMatchObject([
      { id: 'example-orphan', requestId: 'gone', directory: 'examples/users-api/old-request' },
    ]);
    expect(result.problems).toEqual([
      expect.objectContaining({
        path: 'examples/users-api/old-request/200-ok.example.json',
        kind: 'orphan',
        severity: 'warning',
      }),
    ]);
  });

  it('writes examples under the request’s current directory (rename and move follow)', async () => {
    const { result } = await fixture();
    const list = request(result.model, 'list-users');
    list.fileKey = 'all-users';
    const files = serializeProject(result.model);
    expect(files.has('examples/users-api/all-users/200-ok.example.json')).toBe(true);
    expect(files.has('examples/users-api/all-users/avatar.body.bin')).toBe(true);
    expect(files.has('examples/users-api/list-users/200-ok.example.json')).toBe(false);
  });
});

describe('example sidecars', () => {
  it('reads text extensions as text unless they are not UTF-8, everything else as bytes', () => {
    const text = new TextEncoder().encode('{"a":1}\n');
    expect(exampleBodyFromFile('x.body.json', text)).toEqual({
      kind: 'text',
      text: '{"a":1}\n',
      format: 'json',
    });
    expect(exampleBodyFromFile('x.body.txt', Uint8Array.of(0xff, 0xfe))).toEqual({
      kind: 'binary',
      base64: '//4=',
    });
    expect(exampleBodyFromFile('x.body.bin', text).kind).toBe('binary');
    expect(exampleBodyFromFile('x.body.js', text)).toMatchObject({ format: 'javascript' });
  });

  it('names sidecars from the example file key and body format', () => {
    const name = (body: Parameters<typeof exampleBodyFileName>[0]['response']['body']) =>
      exampleBodyFileName({
        fileKey: '200-ok',
        response: { code: 200, status: 'OK', headers: [], cookies: [], body },
      });
    expect(name({ kind: 'text', text: '', format: 'xml' })).toBe('200-ok.body.xml');
    expect(name({ kind: 'text', text: '', format: 'text' })).toBe('200-ok.body.txt');
    expect(name({ kind: 'text', text: '', format: 'html' })).toBe('200-ok.body.html');
    expect(name({ kind: 'binary', base64: '' })).toBe('200-ok.body.bin');
    expect(name({ kind: 'none' })).toBeUndefined();
  });

  it('base64 round-trips every byte value and length', () => {
    for (let length = 0; length < 260; length += 37) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 7) % 256);
      expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    }
    expect(encodeBase64(new TextEncoder().encode('ab'))).toBe('YWI=');
  });
});
