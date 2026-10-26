/** Local app state: namespaced key/value JSON documents (docs/file-format.md §6). */

export type AppStateNamespace = 'app' | `project:${string}`;

export interface AppStateStore {
  /** Values round-trip through JSON: `get` returns a copy, never the object passed to `set`. */
  get<T>(ns: AppStateNamespace, key: string): Promise<T | undefined>;
  set<T>(ns: AppStateNamespace, key: string, value: T): Promise<void>;
  delete(ns: string, key: string): Promise<void>;
  clearNamespace(ns: string): Promise<void>;
}
