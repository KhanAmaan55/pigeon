/**
 * Browser workspace (docs/platform.md §6.3): a project stored in IndexedDB, for browsers without
 * the File System Access API. Files live in the `blobs` store under `<workspaceId>\0<path>`.
 *
 * The whole workspace is loaded into a `MemoryFs` on open, which defines the semantics (the same
 * as every other implementation) and serves reads; each change is then written through to
 * IndexedDB in one transaction before the call resolves.
 */

import type {
  FsEntry,
  FsStat,
  ProjectFileSystem,
  ProjectLocation,
  ProjectPath,
} from '@pigeon/platform';
import { MemoryFs } from '@pigeon/platform';

import { prefixRange, request, transact } from './idb';

interface BlobRecord {
  kind: 'file' | 'dir';
  data?: Uint8Array;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  createdAt: string;
}

const keyOf = (workspaceId: string, path: ProjectPath) => `${workspaceId}\u0000${path}`;

export class IdbFs implements ProjectFileSystem {
  readonly root: Extract<ProjectLocation, { kind: 'browser-workspace' }>;
  readonly #db: IDBDatabase;
  readonly #memory: MemoryFs;
  #writes: Promise<void> = Promise.resolve();

  private constructor(db: IDBDatabase, workspaceId: string, name: string, memory: MemoryFs) {
    this.#db = db;
    this.root = { kind: 'browser-workspace', workspaceId, name };
    this.#memory = memory;
  }

  /** Loads a workspace (an unknown id opens as an empty workspace). */
  static async open(db: IDBDatabase, workspaceId: string, name: string): Promise<IdbFs> {
    const prefix = keyOf(workspaceId, '');
    const [keys, values] = await transact(db, 'blobs', 'readonly', (tx) => {
      const store = tx.objectStore('blobs');
      return [
        request(store.getAllKeys(prefixRange(prefix))),
        request(store.getAll(prefixRange(prefix))),
      ] as const;
    }).then((pair) => Promise.all(pair));
    const memory = new MemoryFs();
    const entries = keys.map(
      (key, index) => [String(key).slice(prefix.length), values[index] as BlobRecord] as const,
    );
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [path, record] of entries) {
      if (record.kind === 'dir') await memory.mkdirp(path);
      else await memory.writeFileAtomic(path, record.data ?? new Uint8Array());
    }
    return new IdbFs(db, workspaceId, name, memory);
  }

  readFile(path: ProjectPath): Promise<Uint8Array> {
    return this.#memory.readFile(path);
  }

  readText(path: ProjectPath): Promise<string> {
    return this.#memory.readText(path);
  }

  exists(path: ProjectPath): Promise<boolean> {
    return this.#memory.exists(path);
  }

  stat(path: ProjectPath): Promise<FsStat | null> {
    return this.#memory.stat(path);
  }

  list(dir: ProjectPath, opts?: { recursive?: boolean }): Promise<FsEntry[]> {
    return this.#memory.list(dir, opts);
  }

  async writeFileAtomic(path: ProjectPath, data: Uint8Array | string): Promise<void> {
    await this.#memory.writeFileAtomic(path, data);
    await this.#persist([path]);
  }

  async mkdirp(dir: ProjectPath): Promise<void> {
    await this.#memory.mkdirp(dir);
    if (dir !== '') await this.#persist([dir]);
  }

  async remove(path: ProjectPath, opts?: { recursive?: boolean }): Promise<void> {
    await this.#memory.remove(path, opts);
    await this.#persist([path]);
  }

  async rename(from: ProjectPath, to: ProjectPath): Promise<void> {
    await this.#memory.rename(from, to);
    await this.#persist([from, to]);
  }

  /** Mirrors `paths` (each with its subtree and ancestors) from memory into IndexedDB. */
  #persist(paths: ProjectPath[]): Promise<void> {
    const job = async () => {
      const puts = new Map<ProjectPath, BlobRecord>();
      for (const path of paths) {
        const segments = path.split('/');
        for (let i = 1; i < segments.length; i++)
          puts.set(segments.slice(0, i).join('/'), { kind: 'dir' });
        const stat = await this.#memory.stat(path);
        if (stat?.kind === 'file')
          puts.set(path, { kind: 'file', data: await this.#memory.readFile(path) });
        if (stat?.kind === 'dir') {
          puts.set(path, { kind: 'dir' });
          for (const entry of await this.#memory.list(path, { recursive: true })) {
            puts.set(
              entry.path,
              entry.kind === 'dir'
                ? { kind: 'dir' }
                : { kind: 'file', data: await this.#memory.readFile(entry.path) },
            );
          }
        }
      }
      const workspaceId = this.root.workspaceId;
      await transact(this.#db, 'blobs', 'readwrite', (tx) => {
        const store = tx.objectStore('blobs');
        for (const path of paths) {
          store.delete(keyOf(workspaceId, path));
          store.delete(prefixRange(keyOf(workspaceId, `${path}/`)));
        }
        for (const [path, record] of puts) store.put(record, keyOf(workspaceId, path));
      });
    };
    // One write-through at a time, in call order.
    const next = this.#writes.then(job, job);
    this.#writes = next.catch(() => undefined);
    return next;
  }
}

/** Removes a workspace's files and its record. */
export async function deleteWorkspace(db: IDBDatabase, workspaceId: string): Promise<void> {
  await transact(db, ['blobs', 'workspaces'], 'readwrite', (tx) => {
    tx.objectStore('blobs').delete(prefixRange(keyOf(workspaceId, '')));
    tx.objectStore('workspaces').delete(workspaceId);
  });
}
