/**
 * The CLI never writes project files (PIGN-054): the project is read through this wrapper, whose
 * write operations throw. Variables, cookies and tokens set during a run stay in memory.
 */

import type { FsEntry, FsStat, ProjectFileSystem, ProjectPath } from '@pigeon/platform';

export class ReadOnlyFs implements ProjectFileSystem {
  readonly #inner: ProjectFileSystem;

  constructor(inner: ProjectFileSystem) {
    this.#inner = inner;
  }

  get root() {
    return this.#inner.root;
  }

  readFile(path: ProjectPath): Promise<Uint8Array> {
    return this.#inner.readFile(path);
  }

  readText(path: ProjectPath): Promise<string> {
    return this.#inner.readText(path);
  }

  exists(path: ProjectPath): Promise<boolean> {
    return this.#inner.exists(path);
  }

  stat(path: ProjectPath): Promise<FsStat | null> {
    return this.#inner.stat(path);
  }

  list(dir: ProjectPath, opts?: { recursive?: boolean }): Promise<FsEntry[]> {
    return this.#inner.list(dir, opts);
  }

  #refuse(path: ProjectPath): Promise<never> {
    return Promise.reject(new Error(`The Pigeon CLI never writes project files (${path}).`));
  }

  writeFileAtomic(path: ProjectPath): Promise<void> {
    return this.#refuse(path);
  }

  mkdirp(dir: ProjectPath): Promise<void> {
    return this.#refuse(dir);
  }

  remove(path: ProjectPath): Promise<void> {
    return this.#refuse(path);
  }

  rename(from: ProjectPath): Promise<void> {
    return this.#refuse(from);
  }
}
