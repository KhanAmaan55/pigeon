/**
 * `ProjectFileSystem` on Node's `fs/promises` (docs/platform.md §7): Git scenario tests now, the
 * CLI runner later (PIGN-054). Same semantics as every other implementation (`fsConformance`).
 */

import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, rmdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

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

function code(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function fsError(kind: FsErrorCode, path: ProjectPath): FsError {
  return new FsError(kind, path);
}

export class NodeFs implements ProjectFileSystem {
  readonly root: ProjectLocation;
  readonly #rootPath: string;

  constructor(absolutePath: string) {
    this.#rootPath = absolutePath;
    this.root = { kind: 'native', absolutePath };
  }

  #native(path: ProjectPath): string {
    assertProjectPath(path);
    return path === '' ? this.#rootPath : join(this.#rootPath, ...path.split('/'));
  }

  async readFile(path: ProjectPath): Promise<Uint8Array> {
    const native = this.#native(path);
    const info = await this.stat(path);
    if (!info) throw fsError('not-found', path);
    if (info.kind === 'dir') throw fsError('is-a-directory', path);
    return new Uint8Array(await readFile(native));
  }

  async readText(path: ProjectPath): Promise<string> {
    return new TextDecoder().decode(await this.readFile(path));
  }

  async writeFileAtomic(path: ProjectPath, data: Uint8Array | string): Promise<void> {
    const native = this.#native(path);
    if (path === '') throw fsError('is-a-directory', path);
    await this.#checkAncestors(path);
    if ((await this.stat(path))?.kind === 'dir') throw fsError('is-a-directory', path);
    await mkdir(this.#native(parentPath(path)), { recursive: true });
    const temp = join(
      this.#native(parentPath(path)),
      `.${baseName(path)}.pigeon-${randomUUID()}.tmp`,
    );
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    try {
      const handle = await open(temp, 'w');
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, native);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async exists(path: ProjectPath): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  async stat(path: ProjectPath): Promise<FsStat | null> {
    try {
      const info = await stat(this.#native(path));
      return info.isDirectory()
        ? { kind: 'dir', size: 0, mtimeMs: info.mtimeMs }
        : { kind: 'file', size: info.size, mtimeMs: info.mtimeMs };
    } catch (error) {
      if (error instanceof FsError) throw error;
      if (code(error) === 'ENOENT' || code(error) === 'ENOTDIR') return null;
      throw error;
    }
  }

  async list(dir: ProjectPath, opts: { recursive?: boolean } = {}): Promise<FsEntry[]> {
    const info = await this.stat(dir);
    if (!info) throw fsError('not-found', dir);
    if (info.kind !== 'dir') throw fsError('not-a-directory', dir);
    const entries: FsEntry[] = [];
    const walk = async (current: ProjectPath) => {
      for (const entry of await readdir(this.#native(current), { withFileTypes: true })) {
        const path = current === '' ? entry.name : `${current}/${entry.name}`;
        const isDir =
          entry.isDirectory() ||
          (entry.isSymbolicLink() && (await this.stat(path))?.kind === 'dir');
        entries.push({ path, kind: isDir ? 'dir' : 'file' });
        if (isDir && opts.recursive) await walk(path);
      }
    };
    await walk(dir);
    return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async mkdirp(dir: ProjectPath): Promise<void> {
    const native = this.#native(dir);
    if (dir === '') return;
    await this.#checkAncestors(`${dir}/x`);
    await mkdir(native, { recursive: true });
  }

  async remove(path: ProjectPath, opts: { recursive?: boolean } = {}): Promise<void> {
    const native = this.#native(path);
    if (path === '') throw new FsError('invalid-path', path, 'The project root cannot be removed');
    const info = await this.stat(path);
    if (!info) throw fsError('not-found', path);
    if (info.kind === 'file') return unlink(native);
    if (opts.recursive) return rm(native, { recursive: true, force: true });
    try {
      await rmdir(native);
    } catch (error) {
      if (code(error) === 'ENOTEMPTY' || code(error) === 'EEXIST') throw fsError('not-empty', path);
      throw error;
    }
  }

  async rename(from: ProjectPath, to: ProjectPath): Promise<void> {
    const source = this.#native(from);
    const target = this.#native(to);
    if (from === '' || to === '') throw fsError('invalid-path', from === '' ? from : to);
    if (!(await this.stat(from))) throw fsError('not-found', from);
    if (to.startsWith(`${from}/`)) throw fsError('invalid-path', to);
    const caseOnly = from.toLowerCase() === to.toLowerCase();
    if (!caseOnly && (await this.stat(to))?.kind === 'dir') throw fsError('already-exists', to);
    await this.#checkAncestors(to);
    await mkdir(this.#native(parentPath(to)), { recursive: true });
    await rename(source, target);
  }

  /** `not-a-directory` when a file sits where one of `path`'s parent directories should be. */
  async #checkAncestors(path: ProjectPath): Promise<void> {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const ancestor = segments.slice(0, i).join('/');
      const info = await this.stat(ancestor);
      if (!info) return;
      if (info.kind !== 'dir') throw fsError('not-a-directory', ancestor);
    }
  }
}
