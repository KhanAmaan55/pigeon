/**
 * Cross-OS filesystem behaviour (PIGN-040, testing.md §3.6): real folders through NodeFs, so CI
 * runs it with each OS's semantics (case-insensitive APFS/NTFS, ext4, CRLF checkouts, …).
 */

import { execFileSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProjectFileSystem, ProjectPath } from '@pigeon/platform';
import { MemoryAppState } from '@pigeon/platform';
import { NodeFs } from '@pigeon/platform-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CommitError, initializeProject, LONG_PATH_LIMIT, ProjectSession } from '../src/index';

/** NodeFs that records every change it makes. */
class RecordingFs extends NodeFs {
  readonly changes: string[] = [];
  override async writeFileAtomic(path: ProjectPath, data: Uint8Array | string): Promise<void> {
    this.changes.push(`write ${path}`);
    return super.writeFileAtomic(path, data);
  }
  override async remove(path: ProjectPath, opts?: { recursive?: boolean }): Promise<void> {
    this.changes.push(`remove ${path}`);
    return super.remove(path, opts);
  }
  override async rename(from: ProjectPath, to: ProjectPath): Promise<void> {
    this.changes.push(`rename ${from} → ${to}`);
    return super.rename(from, to);
  }
}

let dir: string;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'pigeon-xos-')));
});
afterEach(async () => {
  await chmod(dir, 0o755).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

async function open(fs: ProjectFileSystem = new RecordingFs(dir)) {
  const appState = new MemoryAppState();
  return { fs, appState, session: await ProjectSession.fromFs(fs, { appState }) };
}

/** A committed project: collection Users (folder Admin with one request) and one request. */
async function project(root = dir) {
  const fs = new RecordingFs(root);
  await initializeProject(fs, 'Cross OS');
  const { session } = await open(fs);
  session.apply({ type: 'createCollection', id: 'c', name: 'Users' });
  session.apply({ type: 'createFolder', id: 'f', parentId: 'c', name: 'Admin' });
  session.apply({ type: 'createRequest', id: 'r', parentId: 'c', name: 'List users' });
  session.apply({ type: 'createRequest', id: 'd', parentId: 'f', name: 'Delete user' });
  await session.saveForCommit();
  return fs;
}

async function filesOnDisk(root = dir): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string, prefix: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(current, entry.name), path);
      else out.push(path);
    }
  };
  await walk(root, '');
  return out.sort();
}

describe('cross-OS project files (PIGN-040)', () => {
  it('reopening and committing without edits writes nothing', async () => {
    await project();
    const { fs, session } = await open();
    await session.saveForCommit();
    expect((fs as RecordingFs).changes).toEqual([]);
  });

  it('loads CRLF files, leaves unchanged ones alone and writes changed ones as LF', async () => {
    await project();
    for (const path of [
      'collections/users/collection.json',
      'collections/users/list-users.request.json',
      'collections/users/admin/delete-user.request.json',
    ]) {
      const native = join(dir, ...path.split('/'));
      await writeFile(native, (await readFile(native, 'utf8')).replaceAll('\n', '\r\n'));
    }
    const { fs, session } = await open();
    expect(session.findRequest('r')?.name).toBe('List users');
    expect(session.problems).toEqual([]);
    await session.saveForCommit();
    expect((fs as RecordingFs).changes).toEqual([]);

    session.apply({ type: 'updateRequest', id: 'r', patch: { method: 'POST' } });
    await session.saveForCommit();
    expect((fs as RecordingFs).changes).toEqual([
      'write collections/users/list-users.request.json',
    ]);
    const written = await readFile(join(dir, 'collections/users/list-users.request.json'), 'utf8');
    expect(written).not.toContain('\r');
    const untouched = await readFile(join(dir, 'collections/users/collection.json'), 'utf8');
    expect(untouched).toContain('\r\n');
  });

  it('a rename to the same slug moves nothing', async () => {
    await project();
    const { fs, session } = await open();
    session.apply({ type: 'renameItem', id: 'f', name: 'ADMIN' });
    await session.saveForCommit();
    expect((fs as RecordingFs).changes).toEqual(['write collections/users/admin/folder.json']);
  });

  it('renames a folder whose name on disk differs only in case (case-insensitive safe)', async () => {
    await project();
    // A folder created by hand (or another tool) with an upper-case directory name.
    await execRename(join(dir, 'collections/users/admin'), join(dir, 'collections/users/Admin'));
    const { session } = await open();
    expect(session.findRequest('d')?.name).toBe('Delete user');
    session.apply({ type: 'renameItem', id: 'f', name: 'admin' });
    await session.saveForCommit();
    expect(
      (await filesOnDisk()).filter((p) => p.includes('/admin') || p.includes('/Admin')),
    ).toEqual([
      'collections/users/admin/delete-user.request.json',
      'collections/users/admin/folder.json',
    ]);
    const { session: reopened } = await open();
    expect(reopened.findRequest('d')?.name).toBe('Delete user');
    expect(reopened.itemFilePath('f')).toBe('collections/users/admin/folder.json');
  });

  it('never produces reserved names or trailing dots and spaces', async () => {
    await project();
    const { session } = await open();
    const names = ['CON', 'aux.', 'Nul ', 'com1', 'LPT9', 'trailing...', ' spaced  '];
    names.forEach((name, i) =>
      session.apply({ type: 'createRequest', id: `x${i}`, parentId: 'c', name }),
    );
    await session.saveForCommit();
    const created = (await readdir(join(dir, 'collections/users'))).filter((n) =>
      n.endsWith('.request.json'),
    );
    for (const name of created) {
      const stem = name.replace(/\.request\.json$/, '');
      expect(stem).not.toMatch(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i);
      expect(stem).not.toMatch(/[. ]$/);
    }
    expect(created).toHaveLength(names.length + 1);
  });

  it('warns about paths that are too long for Windows, and still writes them', async () => {
    const root = join(dir, 'p'.repeat(150));
    await mkdir(root);
    const fs = new RecordingFs(root);
    await initializeProject(fs, 'Long');
    const { session } = await open(fs);
    session.apply({ type: 'createCollection', id: 'c', name: 'A collection with a long name' });
    session.apply({
      type: 'createRequest',
      id: 'r',
      parentId: 'c',
      name: 'A request whose name is long enough to pass the limit',
    });
    await session.save();
    const plan = await session.planCommit();
    const warning = plan.warnings.find((w) => w.includes('Windows'));
    expect(warning).toContain('a-request-whose-name-is-long-enough-to-pass-the');
    expect(warning).toContain(String(LONG_PATH_LIMIT));
    await session.commit(plan);
    expect(session.findRequest('r')).toBeDefined();
    expect((await filesOnDisk(root)).some((p) => p.includes('a-request-whose'))).toBe(true);
  });

  it('scans folders with NFD (macOS) file names without changes', async () => {
    await project();
    const nfd = 'Café';
    await mkdir(join(dir, 'collections/users', nfd));
    await writeFile(join(dir, 'collections/users', nfd, `${nfd}.txt`), 'notes');
    await writeFile(join(dir, 'collections/users', `${nfd}.md`), 'notes');
    const { fs, session } = await open();
    expect(session.problems).toEqual([]);
    await session.saveForCommit();
    expect((fs as RecordingFs).changes).toEqual([]);
  });

  it('works through a symlinked project root', async () => {
    await project();
    const link = `${dir}-link`;
    await symlink(dir, link, 'junction');
    try {
      const { session } = await open(new RecordingFs(link));
      expect(session.findRequest('d')?.name).toBe('Delete user');
      session.apply({ type: 'updateRequest', id: 'd', patch: { method: 'DELETE' } });
      await session.saveForCommit();
      expect(
        await readFile(join(dir, 'collections/users/admin/delete-user.request.json'), 'utf8'),
      ).toContain('"DELETE"');
    } finally {
      await rm(link, { force: true });
    }
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'a read-only file fails clearly; the other files are written and its draft is kept',
    async () => {
      await project();
      const { session } = await open();
      session.apply({ type: 'updateRequest', id: 'r', patch: { method: 'POST' } });
      session.apply({ type: 'updateRequest', id: 'd', patch: { method: 'PUT' } });
      // POSIX renames over read-only files; a read-only directory blocks the write.
      const locked = join(dir, 'collections/users/admin');
      await chmod(join(locked, 'delete-user.request.json'), 0o444);
      await chmod(locked, 0o555);
      try {
        const error = await session.saveForCommit().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(CommitError);
        expect((error as CommitError).message).toContain(
          'collections/users/admin/delete-user.request.json',
        );
        expect((error as CommitError).written).toEqual([
          'collections/users/list-users.request.json',
        ]);
        expect(
          await readFile(join(dir, 'collections/users/list-users.request.json'), 'utf8'),
        ).toContain('"POST"');
        expect(session.drafts.map((draft) => draft.ref.id)).toEqual(['d']);
        expect(session.findRequest('d')?.method).toBe('PUT');
      } finally {
        await chmod(locked, 0o755);
      }
      await session.saveForCommit();
      expect(session.drafts).toEqual([]);
    },
  );
});

describe('Git on every OS (PIGN-040)', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Pigeon Test', ...args],
      { cwd, encoding: 'utf8' },
    );

  it('a checkout with core.autocrlf=true has LF files and no phantom changes', async () => {
    const origin = join(dir, 'origin');
    await mkdir(origin);
    git(origin, 'init', '-q');
    await project(origin);
    git(origin, 'add', '-A');
    git(origin, 'commit', '-q', '-m', 'init');

    const clone = join(dir, 'clone');
    git(dir, '-c', 'core.autocrlf=true', 'clone', '-q', origin, clone);
    git(clone, 'config', 'core.autocrlf', 'true');
    const request = await readFile(
      join(clone, 'collections/users/list-users.request.json'),
      'utf8',
    );
    expect(request).not.toContain('\r');

    const fs = new RecordingFs(clone);
    const { session } = await open(fs);
    await session.saveForCommit();
    expect(fs.changes).toEqual([]);
    session.apply({ type: 'updateRequest', id: 'r', patch: { method: 'PATCH' } });
    await session.saveForCommit();
    expect(git(clone, 'status', '--porcelain').trim()).toBe(
      'M collections/users/list-users.request.json',
    );
    expect(git(clone, 'diff', '--numstat').trim()).toBe(
      '1\t1\tcollections/users/list-users.request.json',
    );
  });
});

async function execRename(from: string, to: string) {
  // Through a temporary name: a case-only rename is a no-op on some filesystems otherwise.
  const { rename } = await import('node:fs/promises');
  await rename(from, `${from}.tmp`);
  await rename(`${from}.tmp`, to);
}
