/**
 * Local request history storage (PIGN-051, docs/file-format.md §6): per project local key, a list
 * of small summaries (for the History view) and one full entry per id. Always app-data / browser
 * storage, never the project folder. Values are JSON-compatible; core owns their shape, limits
 * and eviction.
 */

export interface HistoryRecord {
  id: string;
  /** Small: what the History list shows and filters on. */
  summary: unknown;
  /** Everything: request, response (bounded), warnings. */
  entry: unknown;
}

export interface HistoryStore {
  /** Appends in order (one write for a batch). */
  append(projectKey: string, records: readonly HistoryRecord[]): Promise<void>;
  /** Summaries in append order (oldest first). */
  list(projectKey: string): Promise<unknown[]>;
  get(projectKey: string, id: string): Promise<unknown>;
  remove(projectKey: string, ids: readonly string[]): Promise<void>;
  clear(projectKey: string): Promise<void>;
}

/** In memory (tests, and platforms without persistent storage); values are copied like JSON. */
export class MemoryHistoryStore implements HistoryStore {
  readonly #projects = new Map<string, Map<string, { summary: string; entry: string }>>();

  #project(key: string) {
    let project = this.#projects.get(key);
    if (!project) {
      project = new Map();
      this.#projects.set(key, project);
    }
    return project;
  }

  append(projectKey: string, records: readonly HistoryRecord[]): Promise<void> {
    const project = this.#project(projectKey);
    for (const record of records) {
      project.delete(record.id);
      project.set(record.id, {
        summary: JSON.stringify(record.summary),
        entry: JSON.stringify(record.entry),
      });
    }
    return Promise.resolve();
  }

  list(projectKey: string): Promise<unknown[]> {
    return Promise.resolve(
      [...this.#project(projectKey).values()].map((r) => JSON.parse(r.summary) as unknown),
    );
  }

  get(projectKey: string, id: string): Promise<unknown> {
    const record = this.#project(projectKey).get(id);
    return Promise.resolve(record ? (JSON.parse(record.entry) as unknown) : undefined);
  }

  remove(projectKey: string, ids: readonly string[]): Promise<void> {
    const project = this.#project(projectKey);
    for (const id of ids) project.delete(id);
    return Promise.resolve();
  }

  clear(projectKey: string): Promise<void> {
    this.#projects.delete(projectKey);
    return Promise.resolve();
  }
}
