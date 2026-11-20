/**
 * Behaviour every `ProjectFileSystem` must share (docs/platform.md §2), as plain async functions
 * with a tiny built-in `expect`. No test-framework imports, so Vitest (`fsConformance`) and
 * Playwright (FsAccessFs on an OPFS handle in a real browser) run the same cases.
 */

import type { ProjectFileSystem } from '../fs';

export interface FsConformanceCase {
  /** `group › title`, stable. */
  name: string;
  /** `fs` is an empty project. */
  run(fs: ProjectFileSystem): Promise<void>;
}

class ConformanceError extends Error {
  override readonly name = 'ConformanceError';
}

const show = (value: unknown): string => {
  if (value instanceof Uint8Array) return `Uint8Array[${[...value].join(',')}]`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return (
      a instanceof Uint8Array &&
      b instanceof Uint8Array &&
      a.length === b.length &&
      a.every((byte, index) => byte === b[index])
    );
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const keysA = Object.keys(a).filter((key) => (a as Record<string, unknown>)[key] !== undefined);
    const keysB = Object.keys(b).filter((key) => (b as Record<string, unknown>)[key] !== undefined);
    return (
      keysA.length === keysB.length &&
      keysA.every((key) =>
        deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
      )
    );
  }
  return false;
}

function matches(actual: unknown, expected: Record<string, unknown>): boolean {
  if (typeof actual !== 'object' || actual === null) return false;
  return Object.entries(expected).every(([key, value]) =>
    deepEqual((actual as Record<string, unknown>)[key], value),
  );
}

function expect(actual: unknown) {
  const fail = (what: string, expected: unknown) => {
    throw new ConformanceError(`expected ${show(actual)} ${what} ${show(expected)}`);
  };
  return {
    toBe(expected: unknown) {
      if (!Object.is(actual, expected)) fail('to be', expected);
    },
    toEqual(expected: unknown) {
      if (!deepEqual(actual, expected)) fail('to equal', expected);
    },
    toMatchObject(expected: Record<string, unknown>) {
      if (!matches(actual, expected)) fail('to match', expected);
    },
    toBeNull() {
      if (actual !== null) fail('to be', null);
    },
    toContain(item: unknown) {
      if (!Array.isArray(actual) || !actual.some((entry) => deepEqual(entry, item))) {
        fail('to contain', item);
      }
    },
  };
}

/** `await rejects(promise, { code })`: the promise must reject with an error matching `expected`. */
async function rejects(
  promise: Promise<unknown>,
  expected: Record<string, unknown>,
): Promise<void> {
  let settled = false;
  try {
    await promise;
    settled = true;
  } catch (error) {
    if (!matches(error, expected)) {
      throw new ConformanceError(
        `expected a rejection matching ${show(expected)}, got ${String(error)}`,
      );
    }
  }
  if (settled)
    throw new ConformanceError(`expected a rejection matching ${show(expected)}, but it resolved`);
}

const bytes = (...values: number[]) => new Uint8Array(values);

async function listFixture(fs: ProjectFileSystem): Promise<void> {
  await fs.writeFileAtomic('b.json', '1');
  await fs.writeFileAtomic('a/x.json', '1');
  await fs.writeFileAtomic('a/sub/y.json', '1');
  await fs.mkdirp('a/empty');
}

const NAMES = ['Café crème.json', '日本語', 'emoji 🐦', 'spaces  and.dots..json', '-dash_'];
const INVALID_PATHS = [
  '/abs.json',
  'C:/x.json',
  '../up.json',
  'a/../b',
  'a//b',
  './a',
  'a\\b',
  'a/',
];

const CASES: FsConformanceCase[] = [
  {
    name: 'starts empty',
    async run(fs) {
      expect(await fs.list('')).toEqual([]);
      expect(await fs.stat('')).toMatchObject({ kind: 'dir' });
    },
  },
  {
    name: 'read & write › round-trips UTF-8 text',
    async run(fs) {
      await fs.writeFileAtomic('notes.txt', 'héllo ✓\n');
      expect(await fs.readText('notes.txt')).toBe('héllo ✓\n');
      expect(await fs.readFile('notes.txt')).toEqual(new TextEncoder().encode('héllo ✓\n'));
    },
  },
  {
    name: 'read & write › round-trips bytes exactly, including invalid UTF-8 and NUL',
    async run(fs) {
      const data = bytes(0, 255, 254, 0x80, 10, 13);
      await fs.writeFileAtomic('blob.bin', data);
      expect(await fs.readFile('blob.bin')).toEqual(data);
    },
  },
  {
    name: 'read & write › copies data: later changes to the written or returned buffer have no effect',
    async run(fs) {
      const data = bytes(1, 2, 3);
      await fs.writeFileAtomic('a.bin', data);
      data[0] = 9;
      const read = await fs.readFile('a.bin');
      read[1] = 9;
      expect(await fs.readFile('a.bin')).toEqual(bytes(1, 2, 3));
    },
  },
  {
    name: 'read & write › overwrites completely, also with shorter content',
    async run(fs) {
      await fs.writeFileAtomic('a.json', '{"long": "content"}');
      await fs.writeFileAtomic('a.json', '{}');
      expect(await fs.readText('a.json')).toBe('{}');
      expect(await fs.stat('a.json')).toMatchObject({ kind: 'file', size: 2 });
    },
  },
  {
    name: 'read & write › writes an empty file',
    async run(fs) {
      await fs.writeFileAtomic('empty.txt', '');
      expect(await fs.readText('empty.txt')).toBe('');
      expect(await fs.stat('empty.txt')).toMatchObject({ kind: 'file', size: 0 });
    },
  },
  {
    name: 'read & write › rejects reading a missing file or a directory',
    async run(fs) {
      await rejects(fs.readFile('missing.json'), { code: 'not-found' });
      await fs.mkdirp('dir');
      await rejects(fs.readText('dir'), { code: 'is-a-directory' });
    },
  },
  {
    name: 'atomic write › creates missing parent directories',
    async run(fs) {
      await fs.writeFileAtomic('a/b/c.json', '1');
      expect(await fs.stat('a')).toMatchObject({ kind: 'dir' });
      expect(await fs.stat('a/b')).toMatchObject({ kind: 'dir' });
      expect(await fs.readText('a/b/c.json')).toBe('1');
    },
  },
  {
    name: 'atomic write › leaves no temporary files behind',
    async run(fs) {
      await fs.writeFileAtomic('dir/a.json', '1');
      await fs.writeFileAtomic('dir/a.json', '2');
      expect(await fs.list('', { recursive: true })).toEqual([
        { path: 'dir', kind: 'dir' },
        { path: 'dir/a.json', kind: 'file' },
      ]);
    },
  },
  {
    name: 'atomic write › never exposes partial content to concurrent readers',
    async run(fs) {
      const big = 'x'.repeat(256 * 1024);
      await fs.writeFileAtomic('big.txt', 'old');
      const reads: Array<Promise<string>> = [];
      const write = fs.writeFileAtomic('big.txt', big);
      for (let i = 0; i < 5; i++) reads.push(fs.readText('big.txt'));
      await write;
      for (const content of await Promise.all(reads)) expect(['old', big]).toContain(content);
      expect(await fs.readText('big.txt')).toBe(big);
    },
  },
  {
    name: 'atomic write › refuses to replace a directory or write below a file',
    async run(fs) {
      await fs.mkdirp('dir');
      await rejects(fs.writeFileAtomic('dir', 'x'), { code: 'is-a-directory' });
      await fs.writeFileAtomic('file.txt', 'x');
      await rejects(fs.writeFileAtomic('file.txt/child', 'x'), { code: 'not-a-directory' });
    },
  },
  {
    name: 'exists & stat › reports files, directories and missing paths',
    async run(fs) {
      await fs.writeFileAtomic('dir/a.txt', 'abc');
      expect(await fs.exists('dir')).toBe(true);
      expect(await fs.exists('dir/a.txt')).toBe(true);
      expect(await fs.exists('dir/b.txt')).toBe(false);
      expect(await fs.stat('dir')).toMatchObject({ kind: 'dir' });
      expect(await fs.stat('dir/a.txt')).toMatchObject({ kind: 'file', size: 3 });
      expect(await fs.stat('nope')).toBeNull();
    },
  },
  {
    name: 'exists & stat › reports the size in bytes, not characters',
    async run(fs) {
      await fs.writeFileAtomic('utf8.txt', 'é✓');
      expect(await fs.stat('utf8.txt')).toMatchObject({ size: 5 });
    },
  },
  {
    name: 'list › lists direct children with project paths, sorted',
    async run(fs) {
      await listFixture(fs);
      expect(await fs.list('')).toEqual([
        { path: 'a', kind: 'dir' },
        { path: 'b.json', kind: 'file' },
      ]);
      expect(await fs.list('a')).toEqual([
        { path: 'a/empty', kind: 'dir' },
        { path: 'a/sub', kind: 'dir' },
        { path: 'a/x.json', kind: 'file' },
      ]);
    },
  },
  {
    name: 'list › lists recursively',
    async run(fs) {
      await listFixture(fs);
      expect(await fs.list('a', { recursive: true })).toEqual([
        { path: 'a/empty', kind: 'dir' },
        { path: 'a/sub', kind: 'dir' },
        { path: 'a/sub/y.json', kind: 'file' },
        { path: 'a/x.json', kind: 'file' },
      ]);
    },
  },
  {
    name: 'list › rejects missing directories and files',
    async run(fs) {
      await listFixture(fs);
      await rejects(fs.list('missing'), { code: 'not-found' });
      await rejects(fs.list('b.json'), { code: 'not-a-directory' });
    },
  },
  {
    name: 'mkdirp › creates nested directories and is idempotent',
    async run(fs) {
      await fs.mkdirp('a/b/c');
      await fs.mkdirp('a/b/c');
      await fs.mkdirp('a');
      expect(await fs.list('', { recursive: true })).toEqual([
        { path: 'a', kind: 'dir' },
        { path: 'a/b', kind: 'dir' },
        { path: 'a/b/c', kind: 'dir' },
      ]);
    },
  },
  {
    name: 'mkdirp › fails when a file is in the way',
    async run(fs) {
      await fs.writeFileAtomic('a', 'x');
      await rejects(fs.mkdirp('a'), { code: 'not-a-directory' });
      await rejects(fs.mkdirp('a/b'), { code: 'not-a-directory' });
    },
  },
  {
    name: 'remove › removes a file',
    async run(fs) {
      await fs.writeFileAtomic('dir/a.json', '1');
      await fs.remove('dir/a.json');
      expect(await fs.exists('dir/a.json')).toBe(false);
      expect(await fs.exists('dir')).toBe(true);
    },
  },
  {
    name: 'remove › removes an empty directory without recursive',
    async run(fs) {
      await fs.mkdirp('dir');
      await fs.remove('dir');
      expect(await fs.exists('dir')).toBe(false);
    },
  },
  {
    name: 'remove › refuses a non-empty directory unless recursive',
    async run(fs) {
      await fs.writeFileAtomic('dir/sub/a.json', '1');
      await rejects(fs.remove('dir'), { code: 'not-empty' });
      await fs.remove('dir', { recursive: true });
      expect(await fs.list('')).toEqual([]);
    },
  },
  {
    name: 'remove › rejects missing paths and the root',
    async run(fs) {
      await rejects(fs.remove('missing'), { code: 'not-found' });
      await rejects(fs.remove('', { recursive: true }), { code: 'invalid-path' });
    },
  },
  {
    name: 'rename › renames a file',
    async run(fs) {
      await fs.writeFileAtomic('a.json', 'A');
      await fs.rename('a.json', 'b.json');
      expect(await fs.exists('a.json')).toBe(false);
      expect(await fs.readText('b.json')).toBe('A');
    },
  },
  {
    name: 'rename › changes only the case of a name',
    async run(fs) {
      await fs.writeFileAtomic('users.json', 'A');
      await fs.rename('users.json', 'Users.json');
      expect(await fs.list('')).toEqual([{ path: 'Users.json', kind: 'file' }]);
    },
  },
  {
    name: 'rename › moves a file into a new directory',
    async run(fs) {
      await fs.writeFileAtomic('a.json', 'A');
      await fs.rename('a.json', 'x/y/a.json');
      expect(await fs.readText('x/y/a.json')).toBe('A');
    },
  },
  {
    name: 'rename › replaces an existing file',
    async run(fs) {
      await fs.writeFileAtomic('.a.json.pigeon-tmp', 'new');
      await fs.writeFileAtomic('a.json', 'old');
      await fs.rename('.a.json.pigeon-tmp', 'a.json');
      expect(await fs.list('')).toEqual([{ path: 'a.json', kind: 'file' }]);
      expect(await fs.readText('a.json')).toBe('new');
    },
  },
  {
    name: 'rename › renames a directory with its contents',
    async run(fs) {
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
    },
  },
  {
    name: 'rename › rejects missing sources, existing directory targets and moves into itself',
    async run(fs) {
      await rejects(fs.rename('missing', 'x'), { code: 'not-found' });
      await fs.mkdirp('a/inner');
      await fs.mkdirp('b');
      await rejects(fs.rename('a', 'b'), { code: 'already-exists' });
      await rejects(fs.rename('a', 'a/inner/a'), { code: 'invalid-path' });
      expect(await fs.exists('a/inner')).toBe(true);
    },
  },
  ...NAMES.map((name): FsConformanceCase => ({
    name: `names › stores and lists ${JSON.stringify(name)}`,
    async run(fs) {
      await fs.writeFileAtomic(`dir/${name}`, name);
      expect(await fs.readText(`dir/${name}`)).toBe(name);
      expect(await fs.list('dir')).toEqual([{ path: `dir/${name}`, kind: 'file' }]);
      await fs.rename(`dir/${name}`, `${name}-renamed`);
      expect(await fs.readText(`${name}-renamed`)).toBe(name);
    },
  })),
  ...INVALID_PATHS.map((path): FsConformanceCase => ({
    name: `names › rejects the invalid path ${JSON.stringify(path)}`,
    async run(fs) {
      await rejects(fs.writeFileAtomic(path, 'x'), { code: 'invalid-path' });
      await rejects(fs.readFile(path), { code: 'invalid-path' });
      await rejects(fs.exists(path), { code: 'invalid-path' });
    },
  })),
];

export function fsConformanceCases(): readonly FsConformanceCase[] {
  return CASES;
}
