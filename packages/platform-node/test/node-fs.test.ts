import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import type { FsChangeEvent } from '@pigeon/platform';
import { fsConformance } from '@pigeon/platform/conformance';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NodeFs, withRetry } from '../src/index';

fsConformance('NodeFs', async () => new NodeFs(await mkdtemp(join(tmpdir(), 'pigeon-nodefs-'))), {
  cleanup: async (fs) => {
    if (fs.root.kind === 'native') await rm(fs.root.absolutePath, { recursive: true, force: true });
  },
});

describe('NodeFs on a real disk (PIGN-040)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'pigeon-nodefs-os-')));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('retries a locked file three times with backoff, then fails', async () => {
    let calls = 0;
    const busy = Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
    await expect(
      withRetry(async () => {
        calls += 1;
        if (calls < 3) throw busy;
        return 'done';
      }),
    ).resolves.toBe('done');
    calls = 0;
    const started = Date.now();
    await expect(
      withRetry(async () => {
        calls += 1;
        throw busy;
      }),
    ).rejects.toBe(busy);
    expect(calls).toBe(4);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    calls = 0;
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    await expect(
      withRetry(async () => {
        calls += 1;
        throw missing;
      }),
    ).rejects.toBe(missing);
    expect(calls).toBe(1);
  });

  it.skipIf(process.platform === 'win32')(
    'leaves symlinked directories out and never deletes through a symlink',
    async () => {
      const outside = await mkdtemp(join(tmpdir(), 'pigeon-outside-'));
      try {
        await writeFile(join(outside, 'keep.json'), '{}');
        const fs = new NodeFs(dir);
        await fs.writeFileAtomic('collections/c/a.json', '{}');
        await symlink(outside, join(dir, 'collections', 'c', 'linked'));
        await writeFile(join(outside, 'file.txt'), 'x');
        await symlink(join(outside, 'file.txt'), join(dir, 'collections', 'c', 'file-link.txt'));
        expect((await fs.list('collections', { recursive: true })).map((e) => e.path)).toEqual([
          'collections/c',
          'collections/c/a.json',
          'collections/c/file-link.txt',
        ]);
        expect(await fs.readText('collections/c/file-link.txt')).toBe('x');
        await fs.remove('collections/c/linked');
        await fs.remove('collections/c/file-link.txt');
        await fs.remove('collections', { recursive: true });
        expect(await readFile(join(outside, 'keep.json'), 'utf8')).toBe('{}');
        expect(await readFile(join(outside, 'file.txt'), 'utf8')).toBe('x');
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    },
  );

  it('works through a symlinked project root', async () => {
    const link = `${dir}-link`;
    await symlink(dir, link, 'junction');
    try {
      const fs = new NodeFs(link);
      await fs.writeFileAtomic('pigeon.json', '{}');
      expect(await fs.list('')).toEqual([{ path: 'pigeon.json', kind: 'file' }]);
      expect(await readFile(join(dir, 'pigeon.json'), 'utf8')).toBe('{}');
    } finally {
      await rm(link, { force: true });
    }
  });

  it('watches the project: created, modified and removed files, without temp files', async () => {
    const fs = new NodeFs(dir);
    const events: FsChangeEvent[] = [];
    const stop = fs.watch((batch) => events.push(...batch));
    try {
      // Give the watcher a moment to start (macOS FSEvents).
      await sleep(200);
      await fs.writeFileAtomic('collections/a.json', '1');
      await vi.waitFor(
        () => expect(events.some((e) => e.path === 'collections/a.json')).toBe(true),
        { timeout: 5000 },
      );
      await fs.remove('collections/a.json');
      await vi.waitFor(
        () => expect(events).toContainEqual({ kind: 'removed', path: 'collections/a.json' }),
        { timeout: 5000 },
      );
      expect(events.some((e) => e.path.includes('.pigeon-'))).toBe(false);
    } finally {
      stop();
    }
  });
});
