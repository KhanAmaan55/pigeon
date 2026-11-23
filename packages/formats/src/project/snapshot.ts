/**
 * Reading a whole project fast (PIGN-042): one recursive listing per project directory, then
 * the managed files read in parallel. Through browser folder handles each read is a slow async
 * round trip, so 7,000 sequential reads took seconds; the reader works on this snapshot instead.
 */

import type { FsEntry, FsStat, ProjectFileSystem, ProjectPath } from '@pigeon/platform';
import { FsError } from '@pigeon/platform';

import { contentHash } from '../hash';
import { isManagedPath } from './managed';

/** Concurrent reads at a time: enough to hide latency without flooding the platform. */
export const READ_CONCURRENCY = 32;

/** Reads `paths` with at most `concurrency` reads in flight; results in the same order. */
export async function readFilesConcurrently(
  fs: Pick<ProjectFileSystem, 'readFile'>,
  paths: readonly ProjectPath[],
  concurrency = READ_CONCURRENCY,
): Promise<Uint8Array[]> {
  const out = new Array<Uint8Array>(paths.length);
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const index = next++;
      out[index] = await fs.readFile(paths[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  return out;
}

const PROJECT_DIRECTORIES = ['collections', 'environments', 'examples'];

/**
 * A read-only view of `fs` as it is now: listings and managed file contents are cached; other
 * reads (and failures) go to `fs` as before.
 */
export async function snapshotProject(fs: ProjectFileSystem): Promise<ProjectFileSystem> {
  const entries = new Map<ProjectPath, FsEntry['kind']>();
  const add = (list: readonly FsEntry[]) => {
    for (const entry of list) entries.set(entry.path, entry.kind);
  };
  add(await fs.list(''));
  for (const dir of PROJECT_DIRECTORIES) {
    if (entries.get(dir) === 'dir') add(await fs.list(dir, { recursive: true }));
  }
  const managed = [...entries]
    .filter(([path, kind]) => kind === 'file' && isManagedPath(path))
    .map(([path]) => path);
  const contents = new Map<ProjectPath, Uint8Array>();
  // A file that can't be read is left to `fs`, so the reader reports it as before.
  const settled = await Promise.allSettled(
    chunk(managed, 500).map(async (paths) => {
      const bytes = await readFilesConcurrently(fs, paths);
      paths.forEach((path, i) => contents.set(path, bytes[i]!));
      // Hash in parallel too (Web Crypto works off the main thread); the reader reuses them.
      await Promise.all(paths.map((path, i) => contentHash(path, bytes[i]!)));
    }),
  );
  void settled;

  const stat = (path: ProjectPath): FsStat | null => {
    if (path === '') return { kind: 'dir', size: 0 };
    const kind = entries.get(path);
    if (!kind) return null;
    return { kind, size: kind === 'file' ? (contents.get(path)?.byteLength ?? 0) : 0 };
  };
  const view: ProjectFileSystem = {
    root: fs.root,
    readFile: async (path) => contents.get(path) ?? fs.readFile(path),
    readText: async (path) => new TextDecoder().decode(await view.readFile(path)),
    exists: async (path) => stat(path) !== null,
    stat: async (path) => stat(path),
    list: async (dir, opts = {}) => {
      const info = stat(dir);
      if (!info) throw new FsError('not-found', dir);
      if (info.kind !== 'dir') throw new FsError('not-a-directory', dir);
      const prefix = dir === '' ? '' : `${dir}/`;
      const top = !PROJECT_DIRECTORIES.some((d) => dir === d || dir.startsWith(`${d}/`));
      // Only the project directories were listed deeply.
      if (top && opts.recursive) return fs.list(dir, opts);
      return [...entries]
        .filter(
          ([path]) =>
            path.startsWith(prefix) &&
            path !== dir &&
            (opts.recursive || !path.slice(prefix.length).includes('/')),
        )
        .map(([path, kind]) => ({ path, kind }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
    writeFileAtomic: (path, data) => fs.writeFileAtomic(path, data),
    mkdirp: (dir) => fs.mkdirp(dir),
    remove: (path, opts) => fs.remove(path, opts),
    rename: (from, to) => fs.rename(from, to),
  };
  return view;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
