/**
 * Project filesystem contract (docs/platform.md §2). Every implementation (memory, Tauri,
 * File System Access, IndexedDB, Node) must pass `fsConformance` from `@pigeon/platform/conformance`.
 */

/** POSIX-style path relative to the project root; `''` is the root. See `assertProjectPath`. */
export type ProjectPath = string;

export type Unsubscribe = () => void;

export type ProjectLocation =
  | { kind: 'native'; absolutePath: string } // desktop, node
  | { kind: 'fs-access'; handleKey: string; name: string } // web Chromium, handle persisted in IndexedDB
  | { kind: 'browser-workspace'; workspaceId: string; name: string } // web, IndexedDB-backed
  | { kind: 'memory'; id: string }; // tests

export interface FsStat {
  kind: 'file' | 'dir';
  size: number;
  mtimeMs?: number;
}

export interface FsEntry {
  path: ProjectPath;
  kind: 'file' | 'dir';
}

/** One change seen by `watch`. A rename is reported as `removed` + `created`. */
export interface FsChangeEvent {
  kind: 'created' | 'modified' | 'removed';
  path: ProjectPath;
}

export interface ProjectFileSystem {
  readonly root: ProjectLocation;
  readFile(path: ProjectPath): Promise<Uint8Array>;
  /** UTF-8. */
  readText(path: ProjectPath): Promise<string>;
  /** Readers see either the old or the new content, never a mix. Creates missing parent directories. */
  writeFileAtomic(path: ProjectPath, data: Uint8Array | string): Promise<void>;
  exists(path: ProjectPath): Promise<boolean>;
  /** `null` when nothing exists at `path`. */
  stat(path: ProjectPath): Promise<FsStat | null>;
  /** Entries below `dir` with full project paths, sorted by path. */
  list(dir: ProjectPath, opts?: { recursive?: boolean }): Promise<FsEntry[]>;
  mkdirp(dir: ProjectPath): Promise<void>;
  /** Directories need `recursive: true` unless empty. The root cannot be removed. */
  remove(path: ProjectPath, opts?: { recursive?: boolean }): Promise<void>;
  /** Replaces an existing file at `to`; creates missing parents of `to`. */
  rename(from: ProjectPath, to: ProjectPath): Promise<void>;
  /** Present only when `capabilities.fileWatch`. Events arrive in batches, asynchronously. */
  watch?(onEvent: (events: FsChangeEvent[]) => void): Unsubscribe;
}

export type FsErrorCode =
  | 'invalid-path'
  | 'not-found'
  | 'already-exists'
  | 'not-a-directory'
  | 'is-a-directory'
  | 'not-empty';

/** The only error type `ProjectFileSystem` methods reject with for expected failures. */
export class FsError extends Error {
  override readonly name = 'FsError';

  constructor(
    readonly code: FsErrorCode,
    readonly path: ProjectPath,
    message = `${code}: ${path === '' ? '<project root>' : path}`,
  ) {
    super(message);
  }
}
