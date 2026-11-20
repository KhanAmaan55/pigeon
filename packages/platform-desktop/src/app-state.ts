/**
 * `AppStateStore` on desktop: one JSON document per namespace in the app-data directory
 * (`app.json`, `projects/<id>/state.json`; apps/desktop/src-tauri/src/app_state.rs). Documents are
 * cached after the first read and written back whole; writes to one namespace are serialized.
 */

import type { AppStateNamespace, AppStateStore } from '@pigeon/platform';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import type { Invoke } from './native-transport';

type Doc = Record<string, unknown>;

export class FileAppState implements AppStateStore {
  readonly #invoke: Invoke;
  readonly #docs = new Map<string, Promise<Doc>>();
  readonly #writes = new Map<string, Promise<void>>();

  constructor(opts: { invoke?: Invoke } = {}) {
    this.#invoke = opts.invoke ?? tauriInvoke;
  }

  async get<T>(ns: AppStateNamespace, key: string): Promise<T | undefined> {
    const value = (await this.#doc(ns))[key];
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  async set<T>(ns: AppStateNamespace, key: string, value: T): Promise<void> {
    const json = JSON.stringify(value);
    if (json === undefined)
      throw new TypeError(`App state "${ns}/${key}" is not JSON-serializable`);
    const doc = await this.#doc(ns);
    doc[key] = JSON.parse(json) as unknown;
    await this.#flush(ns, doc);
  }

  async delete(ns: string, key: string): Promise<void> {
    const doc = await this.#doc(ns);
    if (!(key in doc)) return;
    delete doc[key];
    await this.#flush(ns, doc);
  }

  async clearNamespace(ns: string): Promise<void> {
    this.#docs.set(ns, Promise.resolve({}));
    await this.#queue(ns, () => this.#invoke('app_state_write', { namespace: ns, json: null }));
  }

  #doc(ns: string): Promise<Doc> {
    let doc = this.#docs.get(ns);
    if (!doc) {
      doc = this.#invoke<string | null>('app_state_read', { namespace: ns }).then((text) => {
        if (text === null) return {};
        try {
          const parsed: unknown = JSON.parse(text);
          return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Doc)
            : {};
        } catch {
          return {}; // unreadable state is reset (file-format.md §6); project files are unaffected
        }
      });
      this.#docs.set(ns, doc);
    }
    return doc;
  }

  #flush(ns: string, doc: Doc): Promise<void> {
    return this.#queue(ns, () =>
      this.#invoke('app_state_write', { namespace: ns, json: JSON.stringify(doc, null, 2) }),
    );
  }

  #queue(ns: string, write: () => Promise<unknown>): Promise<void> {
    const previous = this.#writes.get(ns) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(write)
      .then(() => undefined);
    this.#writes.set(ns, next);
    return next;
  }
}
