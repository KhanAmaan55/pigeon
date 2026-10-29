import { describe, expect, it } from 'vitest';

import type { FsChangeEvent } from '../src/index';
import { MemoryFs } from '../src/index';
import { fsConformance } from '../src/conformance/index';

fsConformance('MemoryFs', () => new MemoryFs());

/** Resolves with the next batch of watch events. */
function nextBatch(fs: MemoryFs) {
  return new Promise<FsChangeEvent[]>((resolve) => {
    const stop = fs.watch((events) => {
      stop();
      resolve(events);
    });
  });
}

describe('MemoryFs', () => {
  it('has a memory root location', () => {
    expect(new MemoryFs({ id: 'p1' }).root).toEqual({ kind: 'memory', id: 'p1' });
  });

  it('copies Node Buffer input instead of sharing its memory', async () => {
    const fs = new MemoryFs();
    const buffer = Buffer.from([1, 2, 3]);
    await fs.writeFileAtomic('a.bin', buffer);
    buffer[0] = 9;
    expect(await fs.readFile('a.bin')).toEqual(new Uint8Array([1, 2, 3]));
  });

  describe('watch', () => {
    it('reports created parents and the file in one batch', async () => {
      const fs = new MemoryFs();
      const batch = nextBatch(fs);
      await fs.writeFileAtomic('a/b.json', '1');
      expect(await batch).toEqual([
        { kind: 'created', path: 'a' },
        { kind: 'created', path: 'a/b.json' },
      ]);
    });

    it('reports modifications, renames and recursive removals', async () => {
      const fs = new MemoryFs();
      await fs.writeFileAtomic('dir/a.json', '1');

      let batch = nextBatch(fs);
      await fs.writeFileAtomic('dir/a.json', '2');
      expect(await batch).toEqual([{ kind: 'modified', path: 'dir/a.json' }]);

      batch = nextBatch(fs);
      await fs.rename('dir', 'moved');
      expect(await batch).toEqual([
        { kind: 'removed', path: 'dir' },
        { kind: 'removed', path: 'dir/a.json' },
        { kind: 'created', path: 'moved' },
        { kind: 'created', path: 'moved/a.json' },
      ]);

      batch = nextBatch(fs);
      await fs.remove('moved', { recursive: true });
      expect(await batch).toEqual([
        { kind: 'removed', path: 'moved' },
        { kind: 'removed', path: 'moved/a.json' },
      ]);
    });

    it('delivers asynchronously and stops after unsubscribe', async () => {
      const fs = new MemoryFs();
      const seen: FsChangeEvent[][] = [];
      const stop = fs.watch((events) => seen.push(events));

      const write = fs.writeFileAtomic('a.json', '1');
      expect(seen).toEqual([]); // never synchronously inside the call
      await write;
      await Promise.resolve();
      expect(seen).toHaveLength(1);

      stop();
      await fs.writeFileAtomic('b.json', '1');
      await Promise.resolve();
      expect(seen).toHaveLength(1);
    });

    it('emits nothing for failed operations', async () => {
      const fs = new MemoryFs();
      const seen: FsChangeEvent[][] = [];
      fs.watch((events) => seen.push(events));
      await fs.writeFileAtomic('file', 'x');
      await expect(fs.writeFileAtomic('file/a/b', 'x')).rejects.toMatchObject({
        code: 'not-a-directory',
      });
      await Promise.resolve();
      expect(seen).toEqual([[{ kind: 'created', path: 'file' }]]);
    });
  });
});
