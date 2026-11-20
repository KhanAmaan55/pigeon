/**
 * `ProjectFileSystem` over the Rust `project_fs_*` commands (apps/desktop/src-tauri/src/
 * project_fs.rs). The webview has no general filesystem permission: Rust only serves folders the
 * user picked, and re-validates every path.
 */

import type {
  FsChangeEvent,
  FsEntry,
  FsErrorCode,
  FsStat,
  ProjectFileSystem,
  ProjectLocation,
  ProjectPath,
  Unsubscribe,
} from '@pigeon/platform';
import { assertProjectPath, FsError } from '@pigeon/platform';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

import type { Invoke } from './native-transport';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FS_ERROR_CODES: readonly FsErrorCode[] = [
  'invalid-path',
  'not-found',
  'already-exists',
  'not-a-directory',
  'is-a-directory',
  'not-empty',
];

/** What the commands reject with (Rust `FsErr`). */
interface WireFsError {
  code: string;
  path: string;
  message: string;
}

/** `@tauri-apps/api/event` `listen`, injectable for tests. */
export type Listen = <T>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

/** What `src-tauri/src/watch.rs` emits as `project-fs-change`. */
interface ChangeBatch {
  root: string;
  events: FsChangeEvent[];
}

export class TauriFs implements ProjectFileSystem {
  readonly root: Extract<ProjectLocation, { kind: 'native' }>;
  readonly #invoke: Invoke;
  readonly #listen: Listen;

  constructor(absolutePath: string, opts: { invoke?: Invoke; listen?: Listen } = {}) {
    this.root = { kind: 'native', absolutePath };
    this.#invoke = opts.invoke ?? tauriInvoke;
    this.#listen = opts.listen ?? (tauriListen as Listen);
  }

  /** Recursive native watcher (`project_watch`), debounced in Rust (PIGN-020). */
  watch(
    onEvent: (events: FsChangeEvent[]) => void,
    onError?: (error: unknown) => void,
  ): Unsubscribe {
    const root = this.root.absolutePath;
    let stopped = false;
    let unlisten: (() => void) | undefined;
    void this.#listen<ChangeBatch>('project-fs-change', ({ payload }) => {
      if (!stopped && payload.root === root && payload.events.length > 0) onEvent(payload.events);
    }).then(
      (fn) => (stopped ? fn() : (unlisten = fn)),
      (error: unknown) => onError?.(error),
    );
    void this.#invoke('project_watch', { root }).catch((error: unknown) => onError?.(error));
    return () => {
      stopped = true;
      unlisten?.();
      void this.#invoke('project_unwatch', { root }).catch(() => undefined);
    };
  }

  async readFile(path: ProjectPath): Promise<Uint8Array> {
    assertProjectPath(path);
    const buffer = await this.#call<ArrayBuffer>('project_fs_read', { path });
    return new Uint8Array(buffer);
  }

  async readText(path: ProjectPath): Promise<string> {
    return decoder.decode(await this.readFile(path));
  }

  async writeFileAtomic(path: ProjectPath, data: Uint8Array | string): Promise<void> {
    assertProjectPath(path);
    await this.#call('project_fs_write', encodeWriteFrame(this.root.absolutePath, path, data));
  }

  async exists(path: ProjectPath): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  async stat(path: ProjectPath): Promise<FsStat | null> {
    assertProjectPath(path);
    return await this.#call<FsStat | null>('project_fs_stat', { path });
  }

  async list(dir: ProjectPath, opts: { recursive?: boolean } = {}): Promise<FsEntry[]> {
    assertProjectPath(dir);
    return await this.#call<FsEntry[]>('project_fs_list', {
      dir,
      recursive: opts.recursive ?? false,
    });
  }

  async mkdirp(dir: ProjectPath): Promise<void> {
    assertProjectPath(dir);
    await this.#call('project_fs_mkdirp', { dir });
  }

  async remove(path: ProjectPath, opts: { recursive?: boolean } = {}): Promise<void> {
    assertProjectPath(path);
    await this.#call('project_fs_remove', { path, recursive: opts.recursive ?? false });
  }

  async rename(from: ProjectPath, to: ProjectPath): Promise<void> {
    assertProjectPath(from);
    assertProjectPath(to);
    await this.#call('project_fs_rename', { from, to });
  }

  async #call<T>(cmd: string, args: Record<string, unknown> | Uint8Array): Promise<T> {
    try {
      const withRoot =
        args instanceof Uint8Array ? args : { root: this.root.absolutePath, ...args };
      return await this.#invoke<T>(cmd, withRoot);
    } catch (error) {
      throw toFsError(error);
    }
  }
}

/** `[u32 LE JSON length][{ root, path }][bytes]`, the `project_fs_write` frame. */
export function encodeWriteFrame(
  root: string,
  path: ProjectPath,
  data: Uint8Array | string,
): Uint8Array {
  const json = encoder.encode(JSON.stringify({ root, path }));
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const frame = new Uint8Array(4 + json.byteLength + bytes.byteLength);
  new DataView(frame.buffer).setUint32(0, json.byteLength, true);
  frame.set(json, 4);
  frame.set(bytes, 4 + json.byteLength);
  return frame;
}

export function toFsError(error: unknown): Error {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code, path, message } = error as WireFsError;
    if ((FS_ERROR_CODES as readonly string[]).includes(code)) {
      return new FsError(code as FsErrorCode, path, message);
    }
    return new Error(message, { cause: error });
  }
  return new Error(typeof error === 'string' ? error : 'The file operation failed.', {
    cause: error,
  });
}
