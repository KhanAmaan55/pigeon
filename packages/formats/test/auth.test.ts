import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { ProjectAuth, ProjectRequest } from '../src/index';
import { authFromPostman, authToPostman, readProject, serializeProject } from '../src/index';

const fixtureDirectory = fileURLToPath(new URL('../../fixtures/projects/auth/', import.meta.url));
const decoder = new TextDecoder();

async function copyInto(local: string, project: string, fs: MemoryFs, files: Map<string, string>) {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = project === '' ? entry.name : `${project}/${entry.name}`;
    if (entry.isDirectory()) {
      await copyInto(join(local, entry.name), path, fs, files);
      continue;
    }
    const bytes = new Uint8Array(await readFile(join(local, entry.name)));
    files.set(path, decoder.decode(bytes));
    await fs.writeFileAtomic(path, bytes);
  }
}

async function fixture() {
  const fs = new MemoryFs();
  const files = new Map<string, string>();
  await copyInto(fixtureDirectory, '', fs, files);
  return { files, result: await readProject(fs) };
}

function request(result: Awaited<ReturnType<typeof readProject>>, id: string): ProjectRequest {
  const found = result.model.collections[0]!.children.find((c) => c.id === id);
  if (found?.kind !== 'request') throw new Error(id);
  return found;
}

describe('golden fixture: projects/auth (PIGN-026)', () => {
  it('round-trips every auth type byte-for-byte, oauth2 included', async () => {
    const { files, result } = await fixture();
    if (process.env['UPDATE_GOLDEN'] === '1') {
      for (const [path, bytes] of serializeProject(result.model)) {
        await mkdir(dirname(join(fixtureDirectory, path)), { recursive: true });
        await writeFile(join(fixtureDirectory, path), bytes);
      }
      return;
    }
    expect(result.problems).toEqual([]);
    const serialized = serializeProject(result.model);
    expect([...serialized.keys()].sort()).toEqual([...files.keys()].sort());
    for (const [path, bytes] of serialized)
      expect(decoder.decode(bytes), path).toBe(files.get(path));
  });

  it('types basic, bearer, apikey, noauth, digest, awsv4 and oauth2; keeps the rest as unsupported', async () => {
    const { result } = await fixture();
    const collection = result.model.collections[0]!;
    expect(collection.auth).toMatchObject({ type: 'bearer', token: '{{token}}' });
    expect(request(result, 'inherit').auth).toBeUndefined();
    expect(request(result, 'basic').auth).toMatchObject({
      type: 'basic',
      username: 'ünï',
      password: 'pä ss',
    });
    expect(request(result, 'apikey-header').auth).toMatchObject({
      type: 'apikey',
      key: 'X-Api-Key',
      value: '{{apiKey}}',
      in: 'header',
    });
    expect(request(result, 'apikey-query').auth).toMatchObject({ in: 'query', key: 'api_key' });
    // Typed since PIGN-047.
    expect(request(result, 'oauth2').auth).toMatchObject({ type: 'oauth2' });
    // Typed since PIGN-046.
    expect(request(result, 'digest').auth).toMatchObject({
      type: 'digest',
      password: '{{password}}',
      algorithm: 'MD5',
    });
    // Postman v2.0 objects are read too.
    expect(request(result, 'legacy-basic').auth).toMatchObject({
      type: 'basic',
      username: 'user',
      password: 'pass',
    });
    const folder = collection.children.find((c) => c.id === 'public-folder');
    expect(folder?.kind === 'folder' && folder.auth).toMatchObject({ type: 'noauth' });
  });
});

describe('authToPostman', () => {
  it('writes new auth as Postman v2.1 arrays, omitting empty and default params', () => {
    expect(authToPostman({ type: 'bearer', token: '{{token}}' })).toEqual({
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{token}}', type: 'string' }],
    });
    expect(authToPostman({ type: 'apikey', key: 'X-Key', value: '', in: 'header' })).toEqual({
      type: 'apikey',
      apikey: [{ key: 'key', value: 'X-Key', type: 'string' }],
    });
    expect(authToPostman({ type: 'noauth' })).toEqual({ type: 'noauth' });
  });

  it('edits params in place, keeping unknown params, their order and extra keys', () => {
    const source = {
      type: 'basic',
      basic: [
        { key: 'password', value: 'old', type: 'string', x: 1 },
        { key: 'showPassword', value: false, type: 'boolean' },
      ],
      'x-auth': true,
    };
    const auth = authFromPostman(source);
    expect(auth).toMatchObject({ username: '', password: 'old' });
    const edited = { ...auth, username: 'ada', password: 'new' } as ProjectAuth;
    expect(authToPostman(edited)).toEqual({
      type: 'basic',
      basic: [
        { key: 'password', value: 'new', type: 'string', x: 1 },
        { key: 'showPassword', value: false, type: 'boolean' },
        { key: 'username', value: 'ada', type: 'string' },
      ],
      'x-auth': true,
    });
    // Unchanged: the very same object.
    expect(authToPostman(auth)).toBe(source);
  });

  it('starts afresh when the type changes, and converts edited v2.0 objects to arrays', () => {
    const bearer = authFromPostman({ type: 'bearer', bearer: [{ key: 'token', value: 't' }] });
    expect(
      authToPostman({
        type: 'basic',
        username: 'u',
        password: 'p',
        source: bearer.source! as never,
      }),
    ).toEqual({
      type: 'basic',
      basic: [
        { key: 'username', value: 'u', type: 'string' },
        { key: 'password', value: 'p', type: 'string' },
      ],
    });
    const legacy = authFromPostman({ type: 'bearer', bearer: { token: 'a' } });
    expect(authToPostman({ ...legacy, token: 'b' } as ProjectAuth)).toEqual({
      type: 'bearer',
      bearer: [{ key: 'token', value: 'b', type: 'string' }],
    });
  });

  it('keeps unsupported and malformed auth verbatim', () => {
    const hawk = { type: 'hawk', hawk: [{ key: 'authId', value: 'x' }] };
    expect(authFromPostman(hawk)).toEqual({ type: 'unsupported', authType: 'hawk', source: hawk });
    expect(authToPostman(authFromPostman(hawk))).toBe(hawk);
    expect(authFromPostman(null)).toEqual({
      type: 'unsupported',
      authType: 'unknown',
      source: null,
    });
    expect(authToPostman(authFromPostman(null))).toBeNull();
  });
});
