/**
 * One store per open project (docs/architecture.md §8): mirrors `ProjectSession` through
 * `onChange` and adds the project's UI state (explorer expansion, selection, request tabs).
 * Stores are never shared between projects.
 */

import type { Problem, ProjectModel, ProjectSession } from '@pigeon/core';
import { createStore } from 'zustand';

/** An open request tab. An unpinned tab is the *preview* tab (at most one, replaced by the next preview). */
export interface TabRef {
  id: string;
  pinned: boolean;
}

export interface ProjectState {
  model: ProjectModel;
  problems: readonly Problem[];
  readOnly: boolean;
  /** Entities with in-memory (unsaved) edits. */
  unsaved: Readonly<Record<string, true>>;
  /** Expanded collection/folder ids. */
  expanded: Readonly<Record<string, true>>;
  /** Selected explorer item. */
  selectedId: string | null;
  tabs: readonly TabRef[];
  activeTabId: string | null;
  toggle: (id: string) => void;
  setExpanded: (id: string, expanded: boolean) => void;
  select: (id: string | null) => void;
  /** Opens (or focuses) a request tab; `pin: false` uses the preview tab. */
  openTab: (id: string, opts?: { pin?: boolean }) => void;
  pinTab: (id: string) => void;
  /** Closes without asking; callers check `unsaved` first. */
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  /** Activates the next (`1`) or previous (`-1`) tab, wrapping around. */
  cycleTab: (delta: 1 | -1) => void;
  refresh: () => Promise<void>;
}

export type ProjectStore = ReturnType<typeof createProjectStore> & { dispose: () => void };

export function createProjectStore(session: ProjectSession) {
  const snapshot = () => ({
    model: session.getWorkingModel(),
    problems: session.problems,
    readOnly: session.readOnly,
    unsaved: Object.fromEntries(session.unsavedIds().map((id) => [id, true as const])),
  });
  const store = createStore<ProjectState>()((set, get) => ({
    ...snapshot(),
    // Collections start expanded, folders collapsed.
    expanded: Object.fromEntries(
      session.getWorkingModel().collections.map((c) => [c.id, true as const]),
    ),
    selectedId: null,
    tabs: [],
    activeTabId: null,
    toggle: (id) => get().setExpanded(id, !get().expanded[id]),
    setExpanded: (id, expanded) => {
      const next = { ...get().expanded };
      if (expanded) next[id] = true;
      else delete next[id];
      set({ expanded: next });
    },
    select: (selectedId) => set({ selectedId }),
    openTab: (id, { pin = false } = {}) => {
      const { tabs } = get();
      const existing = tabs.find((tab) => tab.id === id);
      if (existing) {
        set({
          activeTabId: id,
          selectedId: id,
          tabs:
            pin && !existing.pinned
              ? tabs.map((t) => (t.id === id ? { id, pinned: true } : t))
              : tabs,
        });
        return;
      }
      const tab = { id, pinned: pin };
      const previewIndex = tabs.findIndex((t) => !t.pinned);
      const next =
        !pin && previewIndex !== -1
          ? tabs.map((t, index) => (index === previewIndex ? tab : t))
          : [...tabs, tab];
      set({ tabs: next, activeTabId: id, selectedId: id });
    },
    pinTab: (id) => {
      const { tabs } = get();
      if (tabs.some((t) => t.id === id && !t.pinned)) {
        set({ tabs: tabs.map((t) => (t.id === id ? { id, pinned: true } : t)) });
      }
    },
    closeTab: (id) => {
      const { tabs, activeTabId } = get();
      const index = tabs.findIndex((t) => t.id === id);
      if (index === -1) return;
      const next = tabs.filter((t) => t.id !== id);
      const neighbour = next[Math.min(index, next.length - 1)];
      set({ tabs: next, activeTabId: activeTabId === id ? (neighbour?.id ?? null) : activeTabId });
    },
    activateTab: (id) => set({ activeTabId: id, selectedId: id }),
    cycleTab: (delta) => {
      const { tabs, activeTabId } = get();
      if (tabs.length === 0) return;
      const index = tabs.findIndex((t) => t.id === activeTabId);
      const next = tabs[(index + delta + tabs.length) % tabs.length]!;
      set({ activeTabId: next.id, selectedId: next.id });
    },
    refresh: () => session.reload(),
  }));
  const unsubscribe = session.onChange(() => {
    store.setState(snapshot());
    // Tabs of requests that no longer exist (deleted, or gone on disk) close.
    const { tabs } = store.getState();
    for (const tab of tabs) {
      if (!session.findRequest(tab.id)) store.getState().closeTab(tab.id);
    }
  });
  return Object.assign(store, { dispose: unsubscribe });
}
