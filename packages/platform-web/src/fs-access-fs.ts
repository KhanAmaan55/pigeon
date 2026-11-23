/**
 * `ProjectFileSystem` over a File System Access `FileSystemDirectoryHandle` (Chromium; docs/
 * platform.md §6.3). Writes use `createWritable()`, which Chromium applies atomically on
 * `close()`. Renames copy and then delete (handle `move()` is not available everywhere).
 */

import type {
  FsEntry,
  FsErrorCode,
  FsStat,
  ProjectFileSystem,
  ProjectLocation,
  ProjectPath,
} from '@pigeon/platform';
import { assertProjectPath, baseName, FsError, parentPath } from '@pigeon/platform';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** Chromium's swap file while a `createWritable()` stream is open. */
const SWAP_SUFFIX = '.crswap';

type EntryHandle = FileSystemDirectoryHandle | FileSystemFileHandle;
interface IterableDirectory extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, EntryHandle]>;
}

function domName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : undefined;
}

function fsError(code: FsErrorCode, path: ProjectPath, cause?: unknown): FsError {
  const error = new FsError(code, path);
  if (cause !== undefined) Object.defineProperty(error, 'cause', { value: cause });
  return error;
}

export class FsAccessFs implements ProjectFileSystem {
  readonly root: ProjectLocation;
  readonly #handle: FileSystemDirectoryHandle;
  /**
   * Directory handles by path (PIGN-042): every read used to walk from the root, one
   * `getDirectoryHandle` per segment. Cleared below a path that is removed; a lookup that fails
   * through a cached handle is retried from the root.
   */
  readonly #dirs = new Map<ProjectPath, FileSystemDirectoryHandle>();

  constructor(handle: FileSystemDirectoryHandle, root: ProjectLocation) {
    this.#handle = handle;
    this.root = root;
  }

  async readFile(path: ProjectPath): Promise<Uint8Array> {
    assertProjectPath(path);
    if (path === '') throw fsError('is-a-directory', path);
    const file = await this.#retryUncached(async () => (await this.#fileHandle(path)).getFile());
    return new Uint8Array(await file.arrayBuffer());
  }

  /** Runs `read`; on a not-found it runs once more with an empty handle cache. */
  async #retryUncached<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (this.#dirs.size === 0 || !(error instanceof FsError) || error.code !== 'not-found') {
        throw error;
      }
      this.#dirs.clear();
      return read();
    }
  }

  #forget(path: ProjectPath): void {
    for (const key of [...this.#dirs.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.#dirs.delete(key);
    }
  }

  async readText(path: ProjectPath): Promise<string> {
    return decoder.decode(await this.readFile(path));
  }

  async writeFileAtomic(path: ProjectPath, data: Uint8Array | string): Promise<void> {
    assertProjectPath(path);
    if (path === '') throw fsError('is-a-directory', path);
    const bytes = typeof data === 'string' ? encoder.encode(data) : data.slice();
    const parent = await this.#dir(parentPath(path), true);
    const name = baseName(path);
    if (await this.#isDir(parent, name)) throw fsError('is-a-directory', path);
    const file = await parent.getFileHandle(name, { create: true });
    const writable = await file.createWritable({ keepExistingData: false });
    try {
      await writable.write(bytes as Uint8Array<ArrayBuffer>);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }

  async exists(path: ProjectPath): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  async stat(path: ProjectPath): Promise<FsStat | null> {
    assertProjectPath(path);
    if (path === '') return { kind: 'dir', size: 0 };
    const found = await this.#stat(path);
    if (found !== null || this.#dirs.size === 0) return found;
    // A cached handle may be stale (the folder was replaced outside Pigeon): check again.
    this.#dirs.clear();
    return this.#stat(path);
  }

  async #stat(path: ProjectPath): Promise<FsStat | null> {
    let parent: FileSystemDirectoryHandle;
    try {
      parent = await this.#dir(parentPath(path), false);
    } catch {
      return null;
    }
    const name = baseName(path);
    try {
      const file = await (await parent.getFileHandle(name)).getFile();
      return { kind: 'file', size: file.size, mtimeMs: file.lastModified };
    } catch (error) {
      if (domName(error) === 'TypeMismatchError') return { kind: 'dir', size: 0 };
      if (domName(error) === 'NotFoundError') return null;
      throw error;
    }
  }

  async list(dir: ProjectPath, opts: { recursive?: boolean } = {}): Promise<FsEntry[]> {
    assertProjectPath(dir);
    const handle = await this.#dir(dir, false, true);
    const entries: FsEntry[] = [];
    await this.#collect(handle, dir, opts.recursive ?? false, entries);
    return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async mkdirp(dir: ProjectPath): Promise<void> {
    assertProjectPath(dir);
    await this.#dir(dir, true);
  }

  async remove(path: ProjectPath, opts: { recursive?: boolean } = {}): Promise<void> {
    assertProjectPath(path);
    if (path === '') throw new FsError('invalid-path', path, 'The project root cannot be removed');
    if ((await this.stat(path)) === null) throw fsError('not-found', path);
    const parent = await this.#dir(parentPath(path), false);
    this.#forget(path);
    try {
      await parent.removeEntry(baseName(path), { recursive: opts.recursive ?? false });
    } catch (error) {
      if (domName(error) === 'InvalidModificationError') throw fsError('not-empty', path, error);
      if (domName(error) === 'NotFoundError') throw fsError('not-found', path, error);
      throw error;
    }
  }

  async rename(from: ProjectPath, to: ProjectPath): Promise<void> {
    assertProjectPath(from);
    assertProjectPath(to);
    if (from === '' || to === '') throw new FsError('invalid-path', from === '' ? from : to);
    const source = await this.stat(from);
    if (!source) throw fsError('not-found', from);
    if (to.startsWith(`${from}/`)) throw fsError('invalid-path', to);
    if (from === to) return;
    const caseOnly = from.toLowerCase() === to.toLowerCase();
    if (caseOnly) {
      // On case-insensitive disks both names are the same entry: go through a temporary name.
      const temp = `${parentPath(from) === '' ? '' : `${parentPath(from)}/`}.${baseName(from)}.pigeon-rename`;
      await this.rename(from, temp);
      await this.rename(temp, to);
      return;
    }
    const target = await this.stat(to);
    if (target?.kind === 'dir') throw fsError('already-exists', to);
    if (source.kind === 'file') {
      await this.writeFileAtomic(to, await this.readFile(from));
    } else {
      await this.mkdirp(to);
      for (const entry of await this.list(from, { recursive: true })) {
        const dest = `${to}${entry.path.slice(from.length)}`;
        if (entry.kind === 'dir') await this.mkdirp(dest);
        else await this.writeFileAtomic(dest, await this.readFile(entry.path));
      }
    }
    await this.remove(from, { recursive: true });
  }

  /** Walks to `dir`, creating it when `create`. A file in the way is `not-a-directory`. */
  async #dir(
    dir: ProjectPath,
    create: boolean,
    strict = false,
  ): Promise<FileSystemDirectoryHandle> {
    let handle = this.#handle;
    if (dir === '') return handle;
    const cached = this.#dirs.get(dir);
    if (cached) return cached;
    let current = '';
    for (const segment of dir.split('/')) {
      current = current === '' ? segment : `${current}/${segment}`;
      const known = this.#dirs.get(current);
      if (known) {
        handle = known;
        continue;
      }
      try {
        handle = await handle.getDirectoryHandle(segment, { create });
        this.#dirs.set(current, handle);
      } catch (error) {
        if (domName(error) === 'TypeMismatchError')
          throw fsError('not-a-directory', strict ? dir : current, error);
        if (domName(error) === 'NotFoundError')
          throw fsError('not-found', strict ? dir : current, error);
        throw error;
      }
    }
    return handle;
  }

  async #fileHandle(path: ProjectPath): Promise<FileSystemFileHandle> {
    let parent: FileSystemDirectoryHandle;
    try {
      parent = await this.#dir(parentPath(path), false);
    } catch (error) {
      if (error instanceof FsError) throw fsError('not-found', path, error);
      throw error;
    }
    try {
      return await parent.getFileHandle(baseName(path));
    } catch (error) {
      if (domName(error) === 'TypeMismatchError') throw fsError('is-a-directory', path, error);
      if (domName(error) === 'NotFoundError') throw fsError('not-found', path, error);
      throw error;
    }
  }

  async #isDir(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
    try {
      await parent.getDirectoryHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  async #collect(
    handle: FileSystemDirectoryHandle,
    dir: ProjectPath,
    recursive: boolean,
    out: FsEntry[],
  ): Promise<void> {
    const subdirectories: Array<Promise<void>> = [];
    for await (const [name, entry] of (handle as IterableDirectory).entries()) {
      if (name.endsWith(SWAP_SUFFIX)) continue;
      const path = dir === '' ? name : `${dir}/${name}`;
      if (entry.kind === 'directory') {
        out.push({ path, kind: 'dir' });
        this.#dirs.set(path, entry as FileSystemDirectoryHandle);
        // Siblings are listed in parallel (the caller sorts).
        if (recursive) {
          subdirectories.push(this.#collect(entry as FileSystemDirectoryHandle, path, true, out));
        }
      } else {
        out.push({ path, kind: 'file' });
      }
    }
    await Promise.all(subdirectories);
  }
}
