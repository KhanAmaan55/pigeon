/**
 * One store per open project (docs/architecture.md §8): mirrors `ProjectSession` through
 * `onChange` and adds the project's UI state (explorer expansion, selection). Stores are never
 * shared between projects.
 */

import type { Problem, ProjectModel, ProjectSession } from '@pigeon/core';
import { createStore } from 'zustand';

export interface ProjectState {
  model: ProjectModel;
  problems: readonly Problem[];
  readOnly: boolean;
  /** Expanded collection/folder ids. */
  expanded: Readonly<Record<string, true>>;
  /** Selected explorer item. */
  selectedId: string | null;
  toggle: (id: string) => void;
  setExpanded: (id: string, expanded: boolean) => void;
  select: (id: string | null) => void;
  refresh: () => Promise<void>;
}

export type ProjectStore = ReturnType<typeof createProjectStore> & { dispose: () => void };

export function createProjectStore(session: ProjectSession) {
  const snapshot = () => ({
    model: session.getWorkingModel(),
    problems: session.problems,
    readOnly: session.readOnly,
  });
  const store = createStore<ProjectState>()((set, get) => ({
    ...snapshot(),
    // Collections start expanded, folders collapsed.
    expanded: Object.fromEntries(
      session.getWorkingModel().collections.map((c) => [c.id, true as const]),
    ),
    selectedId: null,
    toggle: (id) => get().setExpanded(id, !get().expanded[id]),
    setExpanded: (id, expanded) => {
      const next = { ...get().expanded };
      if (expanded) next[id] = true;
      else delete next[id];
      set({ expanded: next });
    },
    select: (selectedId) => set({ selectedId }),
    refresh: () => session.reload(),
  }));
  const unsubscribe = session.onChange(() => store.setState(snapshot()));
  return Object.assign(store, { dispose: unsubscribe });
}
