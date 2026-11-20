/**
 * Per-project local state (docs/data-model.md §9, file-format.md §6), stored through
 * `AppStateStore` in the `project:<id>` namespace under the key `state`. Never in project files.
 *
 * Writes of UI state (tabs, layout) are debounced; drafts are written immediately. A document
 * that doesn't validate is backed up under `state.bak-<time>` and replaced by a clean state.
 */

import type { AppStateNamespace, AppStateStore } from '@pigeon/platform';

import { z } from '../model/zod';
import type { Draft } from './drafts';

export const LOCAL_STATE_KEY = 'state';
export const UI_STATE_DEBOUNCE_MS = 500;

export interface TabState {
  id: string;
  pinned: boolean;
}

export interface LocalProjectState {
  schemaVersion: 1;
  projectId: string;
  drafts: Draft[];
  tabs: { open: TabState[]; activeId: string | null };
  explorer: { expanded: string[] };
  layout: { responsePanel: 'bottom' | 'right' };
  /** Selected environment (PIGN-022); `null` = No environment. */
  selectedEnvironmentId?: string | null;
  /** Variable current values by scope (`env:<id>`, `collection:<id>`, `globals`); never in files. */
  currentValues?: Record<string, Record<string, string>>;
  /** Keys added by later stories, preserved as they are. */
  [key: string]: unknown;
}

const DraftSchema = z.object({
  ref: z.object({
    kind: z.enum(['project', 'collection', 'folder', 'request', 'environment']),
    id: z.string(),
  }),
  op: z.enum(['create', 'update', 'delete']),
  data: z.record(z.string(), z.unknown()).optional(),
  parentId: z.string().nullable().optional(),
  index: z.number().int().optional(),
  baseHash: z.string().nullable().optional(),
  savedAt: z.string(),
});

const StateSchema = z.looseObject({
  schemaVersion: z.literal(1),
  projectId: z.string(),
  drafts: z.array(DraftSchema),
  tabs: z.object({
    open: z.array(z.object({ id: z.string(), pinned: z.boolean() })),
    activeId: z.string().nullable(),
  }),
  explorer: z.object({ expanded: z.array(z.string()) }),
  layout: z.object({ responsePanel: z.enum(['bottom', 'right']) }),
});

export function emptyLocalState(projectId: string): LocalProjectState {
  return {
    schemaVersion: 1,
    projectId,
    drafts: [],
    tabs: { open: [], activeId: null },
    explorer: { expanded: [] },
    layout: { responsePanel: 'bottom' },
  };
}

export interface LoadedLocalState {
  store: LocalStateStore;
  /** Set when an unreadable state was backed up and reset. */
  backedUpAs?: string;
}

export class LocalStateStore {
  readonly #appState: AppStateStore;
  readonly #ns: AppStateNamespace;
  #state: LocalProjectState;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #writing: Promise<void> = Promise.resolve();

  private constructor(appState: AppStateStore, ns: AppStateNamespace, state: LocalProjectState) {
    this.#appState = appState;
    this.#ns = ns;
    this.#state = state;
  }

  /** Loads (or starts) the local state of `projectId`. */
  static async load(
    appState: AppStateStore,
    projectId: string,
    now: () => Date = () => new Date(),
  ): Promise<LoadedLocalState> {
    const ns: AppStateNamespace = `project:${projectId}`;
    const raw = await appState.get<unknown>(ns, LOCAL_STATE_KEY);
    if (raw === undefined)
      return { store: new LocalStateStore(appState, ns, emptyLocalState(projectId)) };
    const parsed = StateSchema.safeParse(raw);
    if (parsed.success && parsed.data.projectId === projectId) {
      return { store: new LocalStateStore(appState, ns, parsed.data as LocalProjectState) };
    }
    const backup = `${LOCAL_STATE_KEY}.bak-${now().toISOString().replace(/[:.]/g, '-')}`;
    await appState.set(ns, backup, raw);
    await appState.delete(ns, LOCAL_STATE_KEY);
    return {
      store: new LocalStateStore(appState, ns, emptyLocalState(projectId)),
      backedUpAs: backup,
    };
  }

  get state(): Readonly<LocalProjectState> {
    return this.#state;
  }

  /** Merges `patch`; written after a short delay (UI state) or at once (`immediate`, drafts). */
  update(patch: Partial<LocalProjectState>, { immediate = false } = {}): Promise<void> {
    this.#state = { ...this.#state, ...patch };
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (immediate) return this.#write();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#write();
    }, UI_STATE_DEBOUNCE_MS);
    return Promise.resolve();
  }

  /** Writes a pending debounced update now. */
  flush(): Promise<void> {
    if (this.#timer === undefined) return this.#writing;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    return this.#write();
  }

  #write(): Promise<void> {
    const snapshot = this.#state;
    this.#writing = this.#writing
      .catch(() => undefined)
      .then(() => this.#appState.set(this.#ns, LOCAL_STATE_KEY, snapshot));
    return this.#writing;
  }
}
