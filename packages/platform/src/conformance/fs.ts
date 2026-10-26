import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProjectFileSystem } from '../fs';

export interface FsConformanceOptions {
  /** Releases whatever `createFs` allocated (temp folders, IndexedDB databases). */
  cleanup?: (fs: ProjectFileSystem) => void | Promise<void>;
}

const bytes = (...values: number[]) => new Uint8Array(values);

/**
 * Behaviour every `ProjectFileSystem` must share (docs/platform.md §2). Register it from a test
 * file: `fsConformance('MemoryFs', () => new MemoryFs())`. `createFs` must return an empty project.
 */
export function fsConformance(
  name: string,
  createFs: () => ProjectFileSystem | Promise<ProjectFileSystem>,
  opts: FsConformanceOptions = {},
): void {
  describe(`ProjectFileSystem conformance: ${name}`, () => {
    let fs: ProjectFileSystem;

    beforeEach(async () => {
      fs = await createFs();
    });
    afterEach(async () => {
      await opts.cleanup?.(fs);
    });

    it('starts empty', async () => {
      expect(await fs.list('')).toEqual([]);
      expect(await fs.stat('')).toMatchObject({ kind: 'dir' });
    });

    describe('read & write', () => {
      it('round-trips UTF-8 text', async () => {
        await fs.writeFileAtomic('notes.txt', 'héllo ✓\n');
        expect(await fs.readText('notes.txt')).toBe('héllo ✓\n');
        expect(await fs.readFile('notes.txt')).toEqual(new TextEncoder().encode('héllo ✓\n'));
      });

      it('round-trips bytes exactly, including invalid UTF-8 and NUL', async () => {
        const data = bytes(0, 255, 254, 0x80, 10, 13);
        await fs.writeFileAtomic('blob.bin', data);
        expect(await fs.readFile('blob.bin')).toEqual(data);
      });

      it('copies data: later changes to the written or returned buffer have no effect', async () => {
        const data = bytes(1, 2, 3);
        await fs.writeFileAtomic('a.bin', data);
        data[0] = 9;
        const read = await fs.readFile('a.bin');
        read[1] = 9;
        expect(await fs.readFile('a.bin')).toEqual(bytes(1, 2, 3));
      });

      it('overwrites completely, also with shorter content', async () => {
        await fs.writeFileAtomic('a.json', '{"long": "content"}');
        await fs.writeFileAtomic('a.json', '{}');
        expect(await fs.readText('a.json')).toBe('{}');
        expect(await fs.stat('a.json')).toMatchObject({ kind: 'file', size: 2 });
      });

      it('writes an empty file', async () => {
        await fs.writeFileAtomic('empty.txt', '');
        expect(await fs.readText('empty.txt')).toBe('');
        expect(await fs.stat('empty.txt')).toMatchObject({ kind: 'file', size: 0 });
      });

      it('rejects reading a missing file or a directory', async () => {
        await expect(fs.readFile('missing.json')).rejects.toMatchObject({ code: 'not-found' });
        await fs.mkdirp('dir');
        await expect(fs.readText('dir')).rejects.toMatchObject({ code: 'is-a-directory' });
      });
    });

    describe('atomic write', () => {
      it('creates missing parent directories', async () => {
        await fs.writeFileAtomic('a/b/c.json', '1');
        expect(await fs.stat('a')).toMatchObject({ kind: 'dir' });
        expect(await fs.stat('a/b')).toMatchObject({ kind: 'dir' });
        expect(await fs.readText('a/b/c.json')).toBe('1');
      });

      it('leaves no temporary files behind', async () => {
        await fs.writeFileAtomic('dir/a.json', '1');
        await fs.writeFileAtomic('dir/a.json', '2');
        expect(await fs.list('', { recursive: true })).toEqual([
          { path: 'dir', kind: 'dir' },
          { path: 'dir/a.json', kind: 'file' },
        ]);
      });

      it('never exposes partial content to concurrent readers', async () => {
        const big = 'x'.repeat(256 * 1024);
        await fs.writeFileAtomic('big.txt', 'old');
        const reads: Array<Promise<string>> = [];
        const write = fs.writeFileAtomic('big.txt', big);
        for (let i = 0; i < 5; i++) reads.push(fs.readText('big.txt'));
        await write;
        for (const content of await Promise.all(reads)) expect([`old`, big]).toContain(content);
        expect(await fs.readText('big.txt')).toBe(big);
      });

      it('refuses to replace a directory or write below a file', async () => {
        await fs.mkdirp('dir');
        await expect(fs.writeFileAtomic('dir', 'x')).rejects.toMatchObject({
          code: 'is-a-directory',
        });
        await fs.writeFileAtomic('file.txt', 'x');
        await expect(fs.writeFileAtomic('file.txt/child', 'x')).rejects.toMatchObject({
          code: 'not-a-directory',
        });
      });
    });

    describe('exists & stat', () => {
      it('reports files, directories and missing paths', async () => {
        await fs.writeFileAtomic('dir/a.txt', 'abc');
        expect(await fs.exists('dir')).toBe(true);
        expect(await fs.exists('dir/a.txt')).toBe(true);
        expect(await fs.exists('dir/b.txt')).toBe(false);
        expect(await fs.stat('dir')).toMatchObject({ kind: 'dir' });
        expect(await fs.stat('dir/a.txt')).toMatchObject({ kind: 'file', size: 3 });
        expect(await fs.stat('nope')).toBeNull();
      });

      it('reports the size in bytes, not characters', async () => {
        await fs.writeFileAtomic('utf8.txt', 'é✓');
        expect(await fs.stat('utf8.txt')).toMatchObject({ size: 5 });
      });
    });

    describe('list', () => {
      beforeEach(async () => {
        await fs.writeFileAtomic('b.json', '1');
        await fs.writeFileAtomic('a/x.json', '1');
        await fs.writeFileAtomic('a/sub/y.json', '1');
        await fs.mkdirp('a/empty');
      });

      it('lists direct children with project paths, sorted', async () => {
        expect(await fs.list('')).toEqual([
          { path: 'a', kind: 'dir' },
          { path: 'b.json', kind: 'file' },
        ]);
        expect(await fs.list('a')).toEqual([
          { path: 'a/empty', kind: 'dir' },
          { path: 'a/sub', kind: 'dir' },
          { path: 'a/x.json', kind: 'file' },
        ]);
      });

      it('lists recursively', async () => {
        expect(await fs.list('a', { recursive: true })).toEqual([
          { path: 'a/empty', kind: 'dir' },
          { path: 'a/sub', kind: 'dir' },
          { path: 'a/sub/y.json', kind: 'file' },
          { path: 'a/x.json', kind: 'file' },
        ]);
      });

      it('rejects missing directories and files', async () => {
        await expect(fs.list('missing')).rejects.toMatchObject({ code: 'not-found' });
        await expect(fs.list('b.json')).rejects.toMatchObject({ code: 'not-a-directory' });
      });
    });

    describe('mkdirp', () => {
      it('creates nested directories and is idempotent', async () => {
        await fs.mkdirp('a/b/c');
        await fs.mkdirp('a/b/c');
        await fs.mkdirp('a');
        expect(await fs.list('', { recursive: true })).toEqual([
          { path: 'a', kind: 'dir' },
          { path: 'a/b', kind: 'dir' },
          { path: 'a/b/c', kind: 'dir' },
        ]);
      });

      it('fails when a file is in the way', async () => {
        await fs.writeFileAtomic('a', 'x');
        await expect(fs.mkdirp('a')).rejects.toMatchObject({ code: 'not-a-directory' });
        await expect(fs.mkdirp('a/b')).rejects.toMatchObject({ code: 'not-a-directory' });
      });
    });

    describe('remove', () => {
      it('removes a file', async () => {
        await fs.writeFileAtomic('dir/a.json', '1');
        await fs.remove('dir/a.json');
        expect(await fs.exists('dir/a.json')).toBe(false);
        expect(await fs.exists('dir')).toBe(true);
      });

      it('removes an empty directory without recursive', async () => {
        await fs.mkdirp('dir');
        await fs.remove('dir');
        expect(await fs.exists('dir')).toBe(false);
      });

      it('refuses a non-empty directory unless recursive', async () => {
        await fs.writeFileAtomic('dir/sub/a.json', '1');
        await expect(fs.remove('dir')).rejects.toMatchObject({ code: 'not-empty' });
        await fs.remove('dir', { recursive: true });
        expect(await fs.list('')).toEqual([]);
      });

      it('rejects missing paths and the root', async () => {
        await expect(fs.remove('missing')).rejects.toMatchObject({ code: 'not-found' });
        await expect(fs.remove('', { recursive: true })).rejects.toMatchObject({
          code: 'invalid-path',
        });
      });
    });

    describe('rename', () => {
      it('renames a file', async () => {
        await fs.writeFileAtomic('a.json', 'A');
        await fs.rename('a.json', 'b.json');
        expect(await fs.exists('a.json')).toBe(false);
        expect(await fs.readText('b.json')).toBe('A');
      });

      it('changes only the case of a name', async () => {
        await fs.writeFileAtomic('users.json', 'A');
        await fs.rename('users.json', 'Users.json');
        expect(await fs.list('')).toEqual([{ path: 'Users.json', kind: 'file' }]);
      });

      it('moves a file into a new directory', async () => {
        await fs.writeFileAtomic('a.json', 'A');
        await fs.rename('a.json', 'x/y/a.json');
        expect(await fs.readText('x/y/a.json')).toBe('A');
      });

      it('replaces an existing file', async () => {
        await fs.writeFileAtomic('.a.json.pigeon-tmp', 'new');
        await fs.writeFileAtomic('a.json', 'old');
        await fs.rename('.a.json.pigeon-tmp', 'a.json');
        expect(await fs.list('')).toEqual([{ path: 'a.json', kind: 'file' }]);
        expect(await fs.readText('a.json')).toBe('new');
      });

      it('renames a directory with its contents', async () => {
        await fs.writeFileAtomic('old/a.json', 'A');
        await fs.writeFileAtomic('old/sub/b.json', 'B');
        await fs.rename('old', 'new');
        expect(await fs.exists('old')).toBe(false);
        expect(await fs.list('new', { recursive: true })).toEqual([
          { path: 'new/a.json', kind: 'file' },
          { path: 'new/sub', kind: 'dir' },
          { path: 'new/sub/b.json', kind: 'file' },
        ]);
        expect(await fs.readText('new/sub/b.json')).toBe('B');
      });

      it('rejects missing sources, existing directory targets and moves into itself', async () => {
        await expect(fs.rename('missing', 'x')).rejects.toMatchObject({ code: 'not-found' });
        await fs.mkdirp('a/inner');
        await fs.mkdirp('b');
        await expect(fs.rename('a', 'b')).rejects.toMatchObject({ code: 'already-exists' });
        await expect(fs.rename('a', 'a/inner/a')).rejects.toMatchObject({
          code: 'invalid-path',
        });
        expect(await fs.exists('a/inner')).toBe(true);
      });
    });

    describe('names', () => {
      const names = ['Café crème.json', '日本語', 'emoji 🐦', 'spaces  and.dots..json', '-dash_'];

      it.each(names)('stores and lists %j', async (name) => {
        await fs.writeFileAtomic(`dir/${name}`, name);
        expect(await fs.readText(`dir/${name}`)).toBe(name);
        expect(await fs.list('dir')).toEqual([{ path: `dir/${name}`, kind: 'file' }]);
        await fs.rename(`dir/${name}`, `${name}-renamed`);
        expect(await fs.readText(`${name}-renamed`)).toBe(name);
      });

      it.each(['/abs.json', 'C:/x.json', '../up.json', 'a/../b', 'a//b', './a', 'a\\b', 'a/'])(
        'rejects the invalid path %j',
        async (path) => {
          await expect(fs.writeFileAtomic(path, 'x')).rejects.toMatchObject({
            code: 'invalid-path',
          });
          await expect(fs.readFile(path)).rejects.toMatchObject({ code: 'invalid-path' });
          await expect(fs.exists(path)).rejects.toMatchObject({ code: 'invalid-path' });
        },
      );
    });
  });
}
