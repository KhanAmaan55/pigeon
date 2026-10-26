import type {
  FsChangeEvent,
  FsEntry,
  FsStat,
  ProjectFileSystem,
  ProjectLocation,
  ProjectPath,
  Unsubscribe,
} from '../fs';
import { FsError } from '../fs';
import { assertProjectPath, isSameOrInside, parentPath } from '../paths';

type MemoryNode =
  { kind: 'file'; data: Uint8Array; mtimeMs: number } | { kind: 'dir'; mtimeMs: number };

const encoder = new TextEncoder();
const byPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** In-memory `ProjectFileSystem` for tests and placeholders. Supports `watch`. */
export class MemoryFs implements ProjectFileSystem {
  readonly root: ProjectLocation;
  readonly #nodes = new Map<ProjectPath, MemoryNode>([['', { kind: 'dir', mtimeMs: Date.now() }]]);
  readonly #listeners = new Set<(events: FsChangeEvent[]) => void>();

  constructor(opts: { id?: string } = {}) {
    this.root = { kind: 'memory', id: opts.id ?? crypto.randomUUID() };
  }

  async readFile(path: ProjectPath): Promise<Uint8Array> {
    return this.#file(path).data.slice();
  }

  async readText(path: ProjectPath): Promise<string> {
    return new TextDecoder().decode(this.#file(path).data);
  }

  async writeFileAtomic(path: ProjectPath, data: Uint8Array | string): Promise<void> {
    assertProjectPath(path);
    const existing = this.#nodes.get(path);
    if (path === '' || existing?.kind === 'dir') throw new FsError('is-a-directory', path);
    const events = this.#createParents(path);
    const bytes = typeof data === 'string' ? encoder.encode(data) : data.slice();
    this.#nodes.set(path, { kind: 'file', data: bytes, mtimeMs: Date.now() });
    events.push({ kind: existing ? 'modified' : 'created', path });
    this.#emit(events);
  }

  async exists(path: ProjectPath): Promise<boolean> {
    assertProjectPath(path);
    return this.#nodes.has(path);
  }

  async stat(path: ProjectPath): Promise<FsStat | null> {
    assertProjectPath(path);
    const node = this.#nodes.get(path);
    if (!node) return null;
    return {
      kind: node.kind,
      size: node.kind === 'file' ? node.data.byteLength : 0,
      mtimeMs: node.mtimeMs,
    };
  }

  async list(dir: ProjectPath, opts: { recursive?: boolean } = {}): Promise<FsEntry[]> {
    this.#dir(dir);
    const entries: FsEntry[] = [];
    for (const [path, node] of this.#nodes) {
      if (path === dir || !isSameOrInside(path, dir)) continue;
      if (!opts.recursive && parentPath(path) !== dir) continue;
      entries.push({ path, kind: node.kind });
    }
    return entries.sort(byPath);
  }

  async mkdirp(dir: ProjectPath): Promise<void> {
    assertProjectPath(dir);
    const existing = this.#nodes.get(dir);
    if (existing?.kind === 'dir') return;
    if (existing) throw new FsError('not-a-directory', dir);
    const events = this.#createParents(dir);
    this.#nodes.set(dir, { kind: 'dir', mtimeMs: Date.now() });
    events.push({ kind: 'created', path: dir });
    this.#emit(events);
  }

  async remove(path: ProjectPath, opts: { recursive?: boolean } = {}): Promise<void> {
    assertProjectPath(path);
    if (path === '') throw new FsError('invalid-path', path, 'The project root cannot be removed');
    const node = this.#nodes.get(path);
    if (!node) throw new FsError('not-found', path);
    const removed = this.#subtree(path);
    if (node.kind === 'dir' && removed.length > 1 && !opts.recursive) {
      throw new FsError('not-empty', path);
    }
    for (const entry of removed) this.#nodes.delete(entry);
    this.#emit(removed.map((entry) => ({ kind: 'removed', path: entry })));
  }

  async rename(from: ProjectPath, to: ProjectPath): Promise<void> {
    assertProjectPath(from);
    assertProjectPath(to);
    if (from === '' || to === '') {
      throw new FsError('invalid-path', '', 'The project root cannot be renamed');
    }
    const source = this.#nodes.get(from);
    if (!source) throw new FsError('not-found', from);
    if (from === to) return;
    if (source.kind === 'dir' && isSameOrInside(to, from)) {
      throw new FsError('invalid-path', to, `Cannot move "${from}" inside itself`);
    }
    const target = this.#nodes.get(to);
    if (target && (target.kind === 'dir' || source.kind === 'dir')) {
      throw new FsError('already-exists', to);
    }

    const events = this.#createParents(to);
    const moved = this.#subtree(from);
    for (const oldPath of moved) {
      const node = this.#nodes.get(oldPath) as MemoryNode;
      this.#nodes.delete(oldPath);
      this.#nodes.set(to + oldPath.slice(from.length), node);
    }
    for (const oldPath of moved) events.push({ kind: 'removed', path: oldPath });
    for (const oldPath of moved) {
      const newPath = to + oldPath.slice(from.length);
      events.push({ kind: newPath === to && target ? 'modified' : 'created', path: newPath });
    }
    this.#emit(events);
  }

  watch(onEvent: (events: FsChangeEvent[]) => void): Unsubscribe {
    this.#listeners.add(onEvent);
    return () => this.#listeners.delete(onEvent);
  }

  #file(path: ProjectPath) {
    assertProjectPath(path);
    const node = this.#nodes.get(path);
    if (!node) throw new FsError('not-found', path);
    if (node.kind === 'dir') throw new FsError('is-a-directory', path);
    return node;
  }

  #dir(path: ProjectPath) {
    assertProjectPath(path);
    const node = this.#nodes.get(path);
    if (!node) throw new FsError('not-found', path);
    if (node.kind === 'file') throw new FsError('not-a-directory', path);
    return node;
  }

  /** `path` and everything below it, sorted. */
  #subtree(path: ProjectPath): ProjectPath[] {
    return [...this.#nodes.keys()].filter((entry) => isSameOrInside(entry, path)).sort();
  }

  /** Creates missing ancestors of `path`; checks the whole chain before changing anything. */
  #createParents(path: ProjectPath): FsChangeEvent[] {
    const missing: ProjectPath[] = [];
    for (let dir = parentPath(path); dir !== ''; dir = parentPath(dir)) {
      const node = this.#nodes.get(dir);
      if (node?.kind === 'file') throw new FsError('not-a-directory', dir);
      if (node) break;
      missing.unshift(dir);
    }
    const now = Date.now();
    for (const dir of missing) this.#nodes.set(dir, { kind: 'dir', mtimeMs: now });
    return missing.map((dir) => ({ kind: 'created', path: dir }));
  }

  /** Delivers one batch per operation, asynchronously, like native watchers. */
  #emit(events: FsChangeEvent[]) {
    if (events.length === 0 || this.#listeners.size === 0) return;
    const listeners = [...this.#listeners];
    void Promise.resolve().then(() => {
      for (const listener of listeners) {
        if (this.#listeners.has(listener)) listener(events);
      }
    });
  }
}
