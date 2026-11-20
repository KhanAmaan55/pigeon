import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readProject, serializeProject } from '@pigeon/formats';
import type { ProjectFileSystem } from '@pigeon/platform';
import { MemoryAppState, MemoryFs } from '@pigeon/platform';
import { NodeFs } from '@pigeon/platform-node';
import { describe, expect, it } from 'vitest';

import { CommitError, initializeProject, ProjectSession } from '../src/index';

const fixtureDirectory = join(import.meta.dirname, '../../fixtures/projects/basic');
const decoder = new TextDecoder();

async function copyInto(fs: ProjectFileSystem, local: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await copyInto(fs, join(local, entry.name), path);
    else await fs.writeFileAtomic(path, new Uint8Array(await readFile(join(local, entry.name))));
  }
}

async function fixtureSession(fs: ProjectFileSystem = new MemoryFs()) {
  await copyInto(fs, fixtureDirectory);
  const appState = new MemoryAppState();
  return { fs, appState, session: await ProjectSession.fromFs(fs, { appState }) };
}

async function files(fs: ProjectFileSystem): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await fs.list('', { recursive: true })) {
    if (entry.kind === 'file') out.set(entry.path, await fs.readText(entry.path));
  }
  return out;
}

function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
}

describe('Save for Commit (PIGN-019)', () => {
  it('writes exactly one file with a minimal diff for one header change', async () => {
    const { fs, session } = await fixtureSession();
    const before = await files(fs);
    const request = session.findRequest('get-invoices')!;
    session.apply({
      type: 'updateRequest',
      id: 'get-invoices',
      patch: { headers: [request.headers[0]!, { ...request.headers[1]!, value: '2' }] },
    });

    const { plan, result } = await session.saveForCommit(['get-invoices']);

    expect(plan.writes.map((w) => [w.path, w.kind])).toEqual([
      ['collections/billing/get-invoices.request.json', 'modify'],
    ]);
    expect(result.written).toEqual(['collections/billing/get-invoices.request.json']);
    const after = await files(fs);
    expect(changed(before, after)).toEqual(['collections/billing/get-invoices.request.json']);
    const oldLines = before.get('collections/billing/get-invoices.request.json')!.split('\n');
    const newLines = after.get('collections/billing/get-invoices.request.json')!.split('\n');
    expect(newLines.filter((line, i) => line !== oldLines[i])).toEqual(['        "value": "2",']);
    expect(session.drafts).toEqual([]);
    expect(session.changeState('get-invoices')).toBe('clean');
    expect(session.getWorkingModel()).toEqual(session.getBaseModel());
  });

  it('writes nothing without drafts', async () => {
    const { fs, session } = await fixtureSession();
    const before = await files(fs);
    const plan = await session.planCommit();
    expect([plan.writes, plan.deletes, plan.rmdirs]).toEqual([[], [], []]);
    await session.commit(plan);
    expect(changed(before, await files(fs))).toEqual([]);
  });

  it('shows a rename as R old → new (delete + write) and updates the parent order', async () => {
    const { fs, session } = await fixtureSession();
    session.apply({ type: 'renameItem', id: 'list-users', name: 'List all users' });
    await session.save();
    const plan = await session.planCommit(['list-users']);
    expect(plan.renames).toEqual([
      {
        from: 'collections/users-api/list-users.request.json',
        to: 'collections/users-api/list-all-users.request.json',
        entityId: 'list-users',
      },
    ]);
    // The collection's order lists file keys, so its file changes too.
    expect(plan.prerequisites).toEqual([]);
    expect(plan.writes.map((w) => w.path).sort()).toEqual([
      'collections/users-api/collection.json',
      'collections/users-api/list-all-users.request.json',
    ]);
    await session.commit(plan);
    expect(await fs.exists('collections/users-api/list-users.request.json')).toBe(false);
    expect((await readProject(fs)).problems).toEqual([]);
  });

  it('writes a new folder with a request committed inside it', async () => {
    const { fs, session } = await fixtureSession();
    session.apply({
      type: 'createFolder',
      id: 'f',
      parentId: 'billing-collection',
      name: 'Refunds',
    });
    session.apply({ type: 'createRequest', id: 'r', parentId: 'f', name: 'Refund' });
    await session.save();
    const plan = await session.planCommit(['r']);
    expect(plan.prerequisites.sort()).toEqual(['billing-collection', 'f']);
    expect(plan.writes.map((w) => [w.path, w.kind]).sort()).toEqual([
      ['collections/billing/collection.json', 'modify'],
      ['collections/billing/refunds/folder.json', 'add'],
      ['collections/billing/refunds/refund.request.json', 'add'],
    ]);
    await session.commit(plan);
    const read = await readProject(fs);
    expect(read.model).toEqual(session.getBaseModel());
    expect(session.drafts).toEqual([]);
  });

  it('deletes a folder, removes empty directories and keeps ones with user files', async () => {
    const { fs, session } = await fixtureSession();
    await fs.writeFileAtomic('collections/users-api/admin/nested/notes.md', 'mine');
    await session.reload();
    session.apply({ type: 'deleteItem', id: 'admin-folder' });
    await session.save();
    const plan = await session.planCommit();
    expect(plan.deletes).toEqual([
      'collections/users-api/admin/delete-user.request.json',
      'collections/users-api/admin/folder.json',
      'collections/users-api/admin/nested/folder.json',
      'collections/users-api/admin/nested/get-audit.request.json',
    ]);
    expect(plan.rmdirs).toEqual([]);
    expect(plan.warnings).toEqual([
      "collections/users-api/admin/nested is kept: it contains files Pigeon doesn't manage (notes.md).",
      "collections/users-api/admin is kept: it contains files Pigeon doesn't manage (nested/notes.md).",
    ]);
    await session.commit(plan);
    expect(await fs.readText('collections/users-api/admin/nested/notes.md')).toBe('mine');

    const clean = await fixtureSession();
    clean.session.apply({ type: 'deleteItem', id: 'admin-folder' });
    await clean.session.save();
    const cleanPlan = await clean.session.planCommit();
    expect(cleanPlan.rmdirs).toEqual([
      'collections/users-api/admin/nested',
      'collections/users-api/admin',
    ]);
    await clean.session.commit(cleanPlan);
    expect(await clean.fs.exists('collections/users-api/admin')).toBe(false);
  });

  it('never overwrites or deletes broken files, and blocks drafts whose file changed on disk', async () => {
    const { fs, session } = await fixtureSession();
    session.apply({ type: 'updateRequest', id: 'get-invoices', patch: { method: 'PUT' } });
    session.apply({ type: 'updateRequest', id: 'pay-invoice', patch: { method: 'PUT' } });
    await session.save();
    // Schema-invalid but with its id: the entity stays known and is marked broken.
    await fs.writeFileAtomic(
      'collections/billing/get-invoices.request.json',
      '{"id": "get-invoices", "name": "x"}',
    );
    await fs.writeFileAtomic('collections/users-api/broken.request.json', '<<<<<<<');
    await session.reload();
    session.apply({ type: 'deleteItem', id: 'users-collection' });
    await session.save();

    const plan = await session.planCommit();
    expect(plan.blocked).toEqual([
      {
        entityId: 'get-invoices',
        path: 'collections/billing/get-invoices.request.json',
        reason: 'broken-file',
      },
    ]);
    expect(plan.deletes).not.toContain('collections/users-api/broken.request.json');
    expect(plan.writes.map((w) => w.path)).not.toContain(
      'collections/billing/get-invoices.request.json',
    );
    await session.commit(plan);
    expect(await fs.readText('collections/users-api/broken.request.json')).toBe('<<<<<<<');
    expect(session.drafts.map((d) => d.ref.id)).toEqual(['get-invoices']);
  });

  it('blocks an entity whose file changed on disk after its draft', async () => {
    const { fs, session } = await fixtureSession();
    session.apply({ type: 'updateRequest', id: 'pay-invoice', patch: { method: 'PUT' } });
    await session.save();
    const original = await fs.readText('collections/billing/pay-invoice.request.json');
    await fs.writeFileAtomic(
      'collections/billing/pay-invoice.request.json',
      original.replace('Pay invoice', 'Pay it'),
    );
    const plan = await session.planCommit();
    expect(plan.blocked).toEqual([
      {
        entityId: 'pay-invoice',
        path: 'collections/billing/pay-invoice.request.json',
        reason: 'changed-on-disk',
      },
    ]);
    expect(plan.writes).toEqual([]);
  });

  it('keeps the failed draft and leaves no temporary files when a write fails mid-plan', async () => {
    const memory = new MemoryFs();
    let writes = 0;
    const failing: ProjectFileSystem = {
      root: memory.root,
      readFile: (p) => memory.readFile(p),
      readText: (p) => memory.readText(p),
      writeFileAtomic: async (path, data) => {
        if (++writes === 2) throw new Error('disk full');
        return memory.writeFileAtomic(path, data);
      },
      exists: (p) => memory.exists(p),
      stat: (p) => memory.stat(p),
      list: (d, o) => memory.list(d, o),
      mkdirp: (d) => memory.mkdirp(d),
      remove: (p, o) => memory.remove(p, o),
      rename: (a, b) => memory.rename(a, b),
    };
    await copyInto(memory, fixtureDirectory);
    const session = await ProjectSession.fromFs(failing, { appState: new MemoryAppState() });
    session.apply({ type: 'createRequest', id: 'a', parentId: 'billing-collection', name: 'A' });
    session.apply({ type: 'createRequest', id: 'b', parentId: 'billing-collection', name: 'B' });
    await session.save();

    const error = await session.commit(await session.planCommit()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommitError);
    // The other files are still written (PIGN-040): only the failed entity keeps its draft.
    const failed = (error as CommitError).failed;
    expect(failed).toHaveLength(1);
    expect((error as CommitError).message).toContain(`${failed[0]} (disk full)`);
    expect(session.drafts.map((d) => d.ref.id)).toEqual(['a']);
    expect(session.conflicts).toEqual([]);
    expect((await memory.list('', { recursive: true })).some((e) => e.path.includes('.tmp'))).toBe(
      false,
    );
    expect(session.findRequest('a')).toBeDefined();
  });

  it('commits through NodeFs into a Git working tree with only the expected diff', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pigeon-git-'));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Pigeon Test', ...args],
        {
          cwd: dir,
          encoding: 'utf8',
        },
      );
    try {
      git('init', '-q');
      const fs = new NodeFs(dir);
      await initializeProject(fs, 'Git API');
      const appState = new MemoryAppState();
      const session = await ProjectSession.fromFs(fs, { appState });
      session.apply({ type: 'createCollection', id: 'c', name: 'Users' });
      session.apply({ type: 'createRequest', id: 'r', parentId: 'c', name: 'List users' });
      await session.saveForCommit();
      git('add', '-A');
      git('commit', '-q', '-m', 'init');

      session.apply({ type: 'updateRequest', id: 'r', patch: { method: 'POST' } });
      await session.saveForCommit(['r']);
      expect(git('diff', '--stat').trim().split('\n')[0]).toContain(
        'collections/users/list-users.request.json',
      );
      expect(git('diff', '--numstat').trim()).toBe(
        '1\t1\tcollections/users/list-users.request.json',
      );
      expect(git('status', '--porcelain').trim()).toBe(
        'M collections/users/list-users.request.json',
      );

      // Nothing to commit → nothing changes.
      await session.saveForCommit();
      expect(git('status', '--porcelain').trim()).toBe(
        'M collections/users/list-users.request.json',
      );
      expect(decoder.decode(serializeProject(session.getBaseModel()).get('pigeon.json'))).toContain(
        '"users"',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
