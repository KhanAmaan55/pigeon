/**
 * `ProjectLocator` in the browser (docs/platform.md §6.3): real folders through the File System
 * Access API (Chromium), handles persisted in IndexedDB (`handles`), and IndexedDB browser
 * workspaces (`workspaces`) everywhere.
 */

import type { ProjectFileSystem, ProjectLocation, ProjectLocator } from '@pigeon/platform';

import { FsAccessFs } from './fs-access-fs';
import { request, transact } from './idb';
import type { WorkspaceRecord } from './idb-fs';
import { IdbFs } from './idb-fs';

type PermissionState = 'granted' | 'denied' | 'prompt';

/** Permission methods Chromium adds to handles (not in TypeScript's DOM lib yet). */
interface PermissionedHandle extends FileSystemDirectoryHandle {
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export interface HandleRecord {
  handle: FileSystemDirectoryHandle;
  name: string;
}

/** Where folder handles are kept; IndexedDB `handles` by default (handles are structured-clonable). */
export interface HandleStore {
  get(key: string): Promise<HandleRecord | undefined>;
  put(key: string, record: HandleRecord): Promise<void>;
}

export interface WebProjectLocatorOptions {
  db: () => Promise<IDBDatabase>;
  /** Tests replace the IndexedDB store (fake handles can't be cloned). */
  handles?: HandleStore;
  /** `window.showDirectoryPicker`, when the browser has it. */
  pickDirectory?: () => Promise<FileSystemDirectoryHandle>;
  /** `navigator.storage.persist`, when the browser has it. */
  persistStorage?: () => Promise<boolean>;
}

const isAbort = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  (error as { name?: unknown }).name === 'AbortError';

export class WebProjectLocator implements ProjectLocator {
  readonly #db: () => Promise<IDBDatabase>;
  readonly #handles: HandleStore;
  readonly #pickDirectory: (() => Promise<FileSystemDirectoryHandle>) | undefined;
  readonly #persistStorage: (() => Promise<boolean>) | undefined;
  #storagePersisted: boolean | undefined;
  #persistRequested = false;
  /** Test hooks (E2E builds): the next picked folder, and a simulated permission state. */
  nextPickedHandle: FileSystemDirectoryHandle | null = null;
  permissionOverride: PermissionState | null = null;

  constructor(opts: WebProjectLocatorOptions) {
    this.#db = opts.db;
    this.#handles = opts.handles ?? {
      get: async (key) =>
        transact(await this.#db(), 'handles', 'readonly', (tx) =>
          request(tx.objectStore('handles').get(key) as IDBRequest<HandleRecord | undefined>),
        ),
      put: async (key, record) =>
        transact(await this.#db(), 'handles', 'readwrite', (tx) => {
          tx.objectStore('handles').put(record, key);
        }),
    };
    this.#pickDirectory = opts.pickDirectory;
    this.#persistStorage = opts.persistStorage;
  }

  get canPickFolders(): boolean {
    return this.#pickDirectory !== undefined || this.nextPickedHandle !== null;
  }

  async pickProjectFolder(): Promise<ProjectLocation | null> {
    const handle = await this.#pick();
    return handle ? this.#remember(handle) : null;
  }

  /** A new folder `<picked parent>/<name>` when folders are available, else a browser workspace. */
  async createProject(name: string): Promise<ProjectLocation | null> {
    if (!this.canPickFolders) return this.createBrowserWorkspace(name);
    const parent = await this.#pick();
    if (!parent) return null;
    const folder = await parent.getDirectoryHandle(name, { create: true });
    for await (const _entry of (folder as unknown as { keys(): AsyncIterable<string> }).keys()) {
      throw new Error(`The folder "${name}" already exists and is not empty.`);
    }
    return this.#remember(folder);
  }

  async createBrowserWorkspace(name: string): Promise<ProjectLocation> {
    const record: WorkspaceRecord = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
    };
    await transact(await this.#db(), 'workspaces', 'readwrite', (tx) => {
      tx.objectStore('workspaces').put(record, record.id);
    });
    // Ask once that the browser keeps our storage under pressure (docs/platform.md §6.3). Not
    // awaited: Firefox answers through a permission prompt that may stay open indefinitely.
    if (!this.#persistRequested && this.#persistStorage) {
      this.#persistRequested = true;
      void this.#persistStorage().then(
        (persisted) => (this.#storagePersisted = persisted),
        () => (this.#storagePersisted = false),
      );
    }
    return { kind: 'browser-workspace', workspaceId: record.id, name };
  }

  /** Whether the browser agreed to keep Pigeon's storage; `undefined` until asked. */
  storagePersisted(): boolean | undefined {
    return this.#storagePersisted;
  }

  async reopen(loc: ProjectLocation): Promise<'ok' | 'needs-permission' | 'missing'> {
    if (loc.kind === 'browser-workspace') {
      return (await this.#workspace(loc.workspaceId)) ? 'ok' : 'missing';
    }
    if (loc.kind !== 'fs-access') return 'missing';
    const record = await this.#handleRecord(loc.handleKey);
    if (!record) return 'missing';
    const handle = record.handle as PermissionedHandle;
    const state =
      this.permissionOverride ??
      (await handle.queryPermission?.({ mode: 'readwrite' })) ??
      'granted';
    if (state !== 'granted') return 'needs-permission';
    return (await this.#accessible(handle)) ? 'ok' : 'missing';
  }

  /** Must run inside a user gesture (a click on "Reconnect"). */
  async requestPermission(loc: ProjectLocation): Promise<boolean> {
    if (loc.kind !== 'fs-access') return false;
    const record = await this.#handleRecord(loc.handleKey);
    if (!record) return false;
    if (this.permissionOverride !== null) {
      this.permissionOverride = null;
      return true;
    }
    const handle = record.handle as PermissionedHandle;
    return ((await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'granted') === 'granted';
  }

  async open(loc: ProjectLocation): Promise<ProjectFileSystem> {
    if (loc.kind === 'browser-workspace') {
      const record = await this.#workspace(loc.workspaceId);
      if (!record) throw new Error(`The browser workspace "${loc.name}" no longer exists.`);
      return IdbFs.open(await this.#db(), loc.workspaceId, record.name);
    }
    if (loc.kind === 'fs-access') {
      const record = await this.#handleRecord(loc.handleKey);
      if (!record) throw new Error(`The folder "${loc.name}" is no longer known to this browser.`);
      return new FsAccessFs(record.handle, loc);
    }
    throw new Error(`The browser cannot open a ${loc.kind} project.`);
  }

  async #pick(): Promise<FileSystemDirectoryHandle | null> {
    if (this.nextPickedHandle) {
      const handle = this.nextPickedHandle;
      this.nextPickedHandle = null;
      return handle;
    }
    if (!this.#pickDirectory) return null;
    try {
      return await this.#pickDirectory();
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
  }

  async #remember(handle: FileSystemDirectoryHandle): Promise<ProjectLocation> {
    const handleKey = crypto.randomUUID();
    await this.#handles.put(handleKey, { handle, name: handle.name });
    return { kind: 'fs-access', handleKey, name: handle.name };
  }

  #handleRecord(key: string): Promise<HandleRecord | undefined> {
    return this.#handles.get(key);
  }

  async #workspace(id: string): Promise<WorkspaceRecord | undefined> {
    return transact(await this.#db(), 'workspaces', 'readonly', (tx) =>
      request(tx.objectStore('workspaces').get(id) as IDBRequest<WorkspaceRecord | undefined>),
    );
  }

  /** False when the folder behind a handle was deleted or moved. */
  async #accessible(handle: FileSystemDirectoryHandle): Promise<boolean> {
    try {
      await (handle as unknown as { keys(): AsyncIterator<string> }).keys().next();
      return true;
    } catch {
      return false;
    }
  }
}
