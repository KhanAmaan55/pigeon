import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProjectFileSystem } from '@pigeon/platform';
import { MemoryAppState, MemoryFs } from '@pigeon/platform';
import { NodeFs } from '@pigeon/platform-node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectSession, WATCH_DEBOUNCE_MS } from '../src/index';

const fixtureDirectory = join(import.meta.dirname, '../../fixtures/projects/basic');
const PAY = 'collections/billing/pay-invoice.request.json';

async function copyInto(fs: ProjectFileSystem, local: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await copyInto(fs, join(local, entry.name), path);
    else await fs.writeFileAtomic(path, new Uint8Array(await readFile(join(local, entry.name))));
  }
}

async function open(fs: ProjectFileSystem = new MemoryFs()) {
  await copyInto(fs, fixtureDirectory);
  const appState = new MemoryAppState();
  return { fs, appState, session: await ProjectSession.fromFs(fs, { appState }) };
}

async function editOnDisk(fs: ProjectFileSystem, path: string, from: string, to: string) {
  await fs.writeFileAtomic(path, (await fs.readText(path)).replace(from, to));
}

describe('external changes (PIGN-020)', () => {
  afterEach(() => vi.useRealTimers());

  it('updates entities without drafts silently', async () => {
    const { fs, session } = await open();
    await editOnDisk(fs, PAY, '"Pay invoice"', '"Pay now"');
    expect(await session.checkForChanges()).toBe(true);
    expect(session.findRequest('pay-invoice')?.name).toBe('Pay now');
    expect(session.conflicts).toEqual([]);
    expect(await session.checkForChanges()).toBe(false);
  });

  it('turns a draft whose file changed into a conflict; Keep mine rebases, Take theirs drops it', async () => {
    const { fs, session, appState } = await open();
    session.apply({ type: 'updateRequest', id: 'pay-invoice', patch: { method: 'PUT' } });
    await session.save();
    await editOnDisk(fs, PAY, '"Pay invoice"', '"Pay now"');
    await session.checkForChanges();

    expect(session.conflicts).toEqual([
      {
        entityId: 'pay-invoice',
        kind: 'request',
        name: 'Pay now',
        reason: 'changed-on-disk',
        path: PAY,
      },
    ]);
    expect(session.changeState('pay-invoice')).toBe('conflict');
    expect(session.findRequest('pay-invoice')?.method).toBe('PUT'); // mine is shown
    expect((await session.planCommit()).blocked).toHaveLength(1);
    // Conflicts are derived from drafts and files, so they survive a restart.
    expect((await ProjectSession.fromFs(fs, { appState })).conflicts).toHaveLength(1);

    await session.resolveConflict('pay-invoice', 'mine');
    expect(session.conflicts).toEqual([]);
    expect(session.changeState('pay-invoice')).toBe('updated');
    const plan = await session.planCommit();
    expect(plan.blocked).toEqual([]);
    expect(plan.writes.map((w) => w.path)).toEqual([PAY]);

    await editOnDisk(fs, PAY, '"Pay now"', '"Pay later"');
    await session.checkForChanges();
    await session.resolveConflict('pay-invoice', 'theirs');
    expect(session.drafts).toEqual([]);
    expect(session.findRequest('pay-invoice')).toMatchObject({ name: 'Pay later', method: 'POST' });
  });

  it('reports a draft on a file deleted on disk; Keep mine re-creates it', async () => {
    const { fs, session } = await open();
    session.apply({ type: 'updateRequest', id: 'pay-invoice', patch: { method: 'PUT' } });
    await session.save();
    await fs.remove(PAY);
    await session.checkForChanges();
    expect(session.conflicts).toMatchObject([
      { entityId: 'pay-invoice', reason: 'deleted-on-disk' },
    ]);

    await session.resolveConflict('pay-invoice', 'mine');
    expect(session.changeState('pay-invoice')).toBe('created');
    expect(session.findRequest('pay-invoice')?.method).toBe('PUT');
    await session.saveForCommit();
    expect(await fs.exists(PAY)).toBe(true);
  });

  it('flags unsaved edits whose file changed: Reload or keep editing', async () => {
    const { fs, session } = await open();
    session.apply({ type: 'updateRequest', id: 'pay-invoice', patch: { method: 'PATCH' } });
    await editOnDisk(fs, PAY, '"Pay invoice"', '"Pay now"');
    await session.checkForChanges();
    expect(session.externallyChanged()).toEqual(['pay-invoice']);
    expect(session.findRequest('pay-invoice')?.method).toBe('PATCH');

    session.keepEditing('pay-invoice');
    expect(session.externallyChanged()).toEqual([]);
    await editOnDisk(fs, PAY, '"Pay now"', '"Pay soon"');
    await session.checkForChanges();
    session.reloadEntity('pay-invoice');
    expect(session.findRequest('pay-invoice')).toMatchObject({ name: 'Pay soon', method: 'POST' });
    expect(session.isUnsaved('pay-invoice')).toBe(false);
  });

  it('marks files with merge conflict markers broken and never writes them', async () => {
    const { fs, session } = await open();
    session.apply({ type: 'updateRequest', id: 'get-invoices', patch: { method: 'PUT' } });
    await session.save();
    await fs.writeFileAtomic(
      PAY,
      '<<<<<<< HEAD\n{"id":"pay-invoice"}\n=======\n{}\n>>>>>>> branch\n',
    );
    await session.checkForChanges();
    expect(session.problemsFor(PAY)[0]?.kind).toBe('parse');
    expect(session.getWorkingModel().collections[1]!.children.find((c) => c.broken)).toBeDefined();
    await session.saveForCommit();
    expect(await fs.readText(PAY)).toContain('<<<<<<< HEAD');
  });

  it('watches the folder, coalesces bursts and ignores its own writes', async () => {
    vi.useFakeTimers();
    const { fs, session } = await open();
    const reload = vi.spyOn(session, 'reload');
    const stop = session.watch()!;
    for (let i = 0; i < 20; i++)
      await editOnDisk(fs, PAY, i === 0 ? '"Pay invoice"' : `"Pay ${i - 1}"`, `"Pay ${i}"`);
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS + 10);
    await vi.waitFor(() => expect(session.findRequest('pay-invoice')?.name).toBe('Pay 19'));
    expect(reload).toHaveBeenCalledTimes(1);

    session.apply({ type: 'updateRequest', id: 'get-invoices', patch: { method: 'PUT' } });
    await session.saveForCommit();
    reload.mockClear();
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS + 10);
    expect(reload).not.toHaveBeenCalled();
    expect(session.conflicts).toEqual([]);
    stop();
  });

  it('follows a git checkout to a branch with a different tree', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pigeon-checkout-'));
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
      git('init', '-q', '-b', 'main');
      const { fs, session } = await open(new NodeFs(dir));
      git('add', '-A');
      git('commit', '-q', '-m', 'fixture');
      git('checkout', '-q', '-b', 'feature');
      await editOnDisk(fs, PAY, '"Pay invoice"', '"Pay on feature"');
      await fs.remove('collections/users-api/admin', { recursive: true });
      git('add', '-A');
      git('commit', '-q', '-m', 'feature');
      git('checkout', '-q', 'main');
      await session.checkForChanges();

      // A draft on an untouched request stays; on main the feature changes are gone.
      session.apply({ type: 'updateRequest', id: 'get-invoices', patch: { method: 'PUT' } });
      await session.save();
      git('checkout', '-q', 'feature');
      expect(await session.checkForChanges()).toBe(true);
      expect(session.findRequest('pay-invoice')?.name).toBe('Pay on feature');
      expect(session.findRequest('delete-user')).toBeUndefined();
      expect(session.findRequest('get-invoices')?.method).toBe('PUT');
      expect(session.conflicts).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
