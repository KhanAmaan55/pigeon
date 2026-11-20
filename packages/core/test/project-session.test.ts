import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createMemoryPlatform,
  MEMORY_CAPABILITIES,
  MemoryFs,
  MockTransport,
  PickedFileStore,
} from '@pigeon/platform';
import { describe, expect, it, vi } from 'vitest';

import {
  createExecutionContext,
  createRequest,
  initializeProject,
  isPigeonProject,
  ProjectSession,
  RequestExecutor,
} from '../src/index';

const fixtureDirectory = fileURLToPath(new URL('../../fixtures/projects/basic/', import.meta.url));

async function copyInto(fs: MemoryFs, local: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await copyInto(fs, join(local, entry.name), path);
    else await fs.writeFileAtomic(path, new Uint8Array(await readFile(join(local, entry.name))));
  }
}

async function fixtureSession(): Promise<ProjectSession> {
  const platform = createMemoryPlatform();
  const location = await platform.projects.createProject('basic');
  await copyInto((await platform.openProjectFs(location)) as MemoryFs, fixtureDirectory);
  return ProjectSession.open(location, platform);
}

describe('ProjectSession (read-only)', () => {
  it('opens a project through the platform and exposes the working model', async () => {
    const session = await fixtureSession();

    expect(session.id).toBe('project-basic');
    expect(session.name).toBe('Basic project');
    expect(session.readOnly).toBe(false);
    expect(session.problems).toEqual([]);
    expect(session.getWorkingModel()).toBe(session.getBaseModel());
    expect(session.location.kind).toBe('memory');
    expect(session.fileHashes.size).toBe(11);
  });

  it('locates items and their files', async () => {
    const session = await fixtureSession();
    const audit = session.locate('get-audit')!;

    expect(audit.collection.fileKey).toBe('users-api');
    expect(audit.ancestors.map((folder) => folder.fileKey)).toEqual(['admin', 'nested']);
    expect(session.itemFilePath('get-audit')).toBe(
      'collections/users-api/admin/nested/get-audit.request.json',
    );
    expect(session.itemFilePath('admin-folder')).toBe('collections/users-api/admin/folder.json');
    expect(session.findRequest('list-users')?.name).toBe('List users');
    expect(session.findRequest('admin-folder')).toBeUndefined();
    expect(session.locate('nope')).toBeUndefined();
    expect(session.itemFilePath('nope')).toBeUndefined();
  });

  it('reloads from disk and notifies listeners', async () => {
    const session = await fixtureSession();
    const listener = vi.fn();
    const unsubscribe = session.onChange(listener);
    await session.fs.writeFileAtomic('collections/billing/broken.request.json', '{');

    await session.reload();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.problemsFor('collections/billing/broken.request.json')).toHaveLength(1);
    unsubscribe();
    await session.reload();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('initializeProject', () => {
  it('writes the manifest, .gitattributes and the managed directories', async () => {
    const fs = new MemoryFs();
    expect(await isPigeonProject(fs)).toBe(false);

    await initializeProject(fs, 'My API');

    expect(await isPigeonProject(fs)).toBe(true);
    expect((await fs.list('')).map((entry) => entry.path)).toEqual([
      '.gitattributes',
      'collections',
      'environments',
      'examples',
      'pigeon.json',
    ]);
    const session = await ProjectSession.fromFs(fs);
    expect(session.name).toBe('My API');
    expect(session.problems).toEqual([]);
  });

  it('keeps an existing .gitattributes', async () => {
    const fs = new MemoryFs();
    await fs.writeFileAtomic('.gitattributes', '* text=auto\n');
    await initializeProject(fs, 'x');
    expect(await fs.readText('.gitattributes')).toBe('* text=auto\n');
  });
});

describe('project file references', () => {
  const formRequest = (src: string) =>
    createRequest({
      method: 'POST',
      url: 'http://localhost:4010/echo',
      body: { mode: 'formdata', params: [{ key: 'doc', value: '', kind: 'file', src }] },
    });

  it('reads project-relative files through the project and releases them after the send', async () => {
    const fs = new MemoryFs();
    await fs.writeFileAtomic('fixtures/avatar.png', new Uint8Array([1, 2, 3]));
    const pickedFiles = new PickedFileStore();
    const seen: Array<{ kind: string; bytes?: number[] }> = [];
    const transport = new MockTransport().on({ url: /echo/ }, (req) => {
      const part = req.body?.kind === 'multipart' ? req.body.parts[0] : undefined;
      if (part?.kind === 'file') {
        const ref = part.file;
        seen.push({
          kind: ref.kind,
          ...(ref.kind === 'picked' ? { bytes: [...pickedFiles.get(ref.id)!.bytes] } : {}),
        });
      }
      return { body: 'ok' };
    });
    const ctx = createExecutionContext({ capabilities: MEMORY_CAPABILITIES, projectFs: fs });

    const result = await new RequestExecutor(transport, { pickedFiles }).execute(
      formRequest('fixtures/avatar.png'),
      ctx,
    );

    expect(result.error).toBeUndefined();
    expect(seen).toEqual([{ kind: 'picked', bytes: [1, 2, 3] }]);
    expect(pickedFiles.size).toBe(0);
  });

  it('reports missing project files and requests without a project', async () => {
    const transport = new MockTransport().on({ url: /./ }, { body: 'x' });
    const pickedFiles = new PickedFileStore();
    const executor = new RequestExecutor(transport, { pickedFiles });

    const missing = await executor.execute(
      createRequest({ method: 'POST', url: 'http://x/', body: { mode: 'file', src: 'nope.bin' } }),
      createExecutionContext({ capabilities: MEMORY_CAPABILITIES, projectFs: new MemoryFs() }),
    );
    expect(missing.error).toMatchObject({
      kind: 'file-unavailable',
      message: 'The project file "nope.bin" cannot be read.',
    });

    const noProject = await executor.execute(
      formRequest('a.txt'),
      createExecutionContext({ capabilities: MEMORY_CAPABILITIES }),
    );
    expect(noProject.error?.kind).toBe('file-unavailable');
    expect(transport.requests).toHaveLength(0);
  });
});
