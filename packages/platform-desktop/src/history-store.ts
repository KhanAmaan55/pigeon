/**
 * `HistoryStore` on desktop (PIGN-051): append-only files in the app-data directory
 * (apps/desktop/src-tauri/src/history.rs). Summaries and entries cross IPC as JSON text.
 */

import type { HistoryRecord, HistoryStore } from '@pigeon/platform';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import type { Invoke } from './native-transport';

export class FileHistoryStore implements HistoryStore {
  readonly #invoke: Invoke;

  constructor(opts: { invoke?: Invoke } = {}) {
    this.#invoke = opts.invoke ?? tauriInvoke;
  }

  async append(projectKey: string, records: readonly HistoryRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.#invoke('history_append', {
      projectKey,
      records: records.map((r) => ({
        id: r.id,
        summary: JSON.stringify(r.summary),
        entry: JSON.stringify(r.entry),
      })),
    });
  }

  list(projectKey: string): Promise<unknown[]> {
    return this.#invoke<unknown[]>('history_list', { projectKey });
  }

  async get(projectKey: string, id: string): Promise<unknown> {
    const text = await this.#invoke<string | null>('history_get', { projectKey, id });
    return text === null ? undefined : (JSON.parse(text) as unknown);
  }

  async remove(projectKey: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.#invoke('history_remove', { projectKey, ids });
  }

  async clear(projectKey: string): Promise<void> {
    await this.#invoke('history_clear', { projectKey });
  }
}
