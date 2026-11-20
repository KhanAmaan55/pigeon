/**
 * One store per open project (docs/architecture.md §8): mirrors `ProjectSession` through
 * `onChange` and adds the project's UI state (explorer expansion, selection, request tabs).
 * Stores are never shared between projects.
 */

import type { ChangeState, Problem, ProjectModel, ProjectSession } from '@pigeon/core';
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
  /** Non-clean entities: unsaved edits or saved drafts (data-model.md §10). */
  changes: Readonly<Record<string, Exclude<ChangeState, 'clean'>>>;
  /** Entities deleted by a saved draft (still in the files), for the explorer. */
  deleted: ReturnType<ProjectSession['deletedEntities']>;
  /** Response panel position, remembered per project. */
  dock: 'bottom' | 'right';
  setDock: (dock: 'bottom' | 'right') => void;
  /** Expanded collection/folder ids. */
  expanded: Readonly<Record<string, true>>;
  /** Selected explorer item. */
  selectedId: string | null;
  tabs: readonly TabRef[];
  activeTabId: string | null;
  /** Entity being renamed inline in the explorer. */
  renamingId: string | null;
  /** Explorer filter text. */
  filter: string;
  startRename: (id: string) => void;
  cancelRename: () => void;
  setFilter: (filter: string) => void;
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
  const snapshot = () => {
    const changes: Record<string, Exclude<ChangeState, 'clean'>> = {};
    for (const draft of session.drafts) {
      const state = session.changeState(draft.ref.id);
      if (state !== 'clean') changes[draft.ref.id] = state;
    }
    for (const id of session.unsavedIds()) changes[id] = 'unsaved';
    return {
      model: session.getWorkingModel(),
      problems: session.problems,
      readOnly: session.readOnly,
      unsaved: Object.fromEntries(session.unsavedIds().map((id) => [id, true as const])),
      changes,
      deleted: session.deletedEntities(),
    };
  };
  // Restore UI state from local state (PIGN-018), dropping tabs of requests that are gone.
  const saved = session.localState;
  const restoredTabs = (saved?.tabs.open ?? []).filter((tab) => session.findRequest(tab.id));
  const restoredActive =
    saved?.tabs.activeId && restoredTabs.some((t) => t.id === saved.tabs.activeId)
      ? saved.tabs.activeId
      : (restoredTabs.at(-1)?.id ?? null);
  const store = createStore<ProjectState>()((set, get) => ({
    ...snapshot(),
    // Collections start expanded, folders collapsed (unless local state remembers otherwise).
    expanded: Object.fromEntries(
      (saved && saved.explorer.expanded.length > 0
        ? saved.explorer.expanded
        : session.getWorkingModel().collections.map((c) => c.id)
      ).map((id) => [id, true as const]),
    ),
    selectedId: restoredActive,
    tabs: restoredTabs,
    activeTabId: restoredActive,
    dock: saved?.layout.responsePanel ?? 'bottom',
    setDock: (dock) => set({ dock }),
    renamingId: null,
    filter: '',
    startRename: (renamingId) => set({ renamingId }),
    cancelRename: () => set({ renamingId: null }),
    setFilter: (filter) => set({ filter }),
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
  // Persist UI state (debounced in core) whenever tabs, expansion or layout change.
  const unsubscribeUi = store.subscribe((state, previous) => {
    if (
      state.tabs === previous.tabs &&
      state.activeTabId === previous.activeTabId &&
      state.expanded === previous.expanded &&
      state.dock === previous.dock
    ) {
      return;
    }
    session.updateLocalState({
      tabs: { open: state.tabs.map((tab) => ({ ...tab })), activeId: state.activeTabId },
      explorer: { expanded: Object.keys(state.expanded) },
      layout: { responsePanel: state.dock },
    });
  });
  return Object.assign(store, {
    dispose: () => {
      unsubscribe();
      unsubscribeUi();
    },
  });
}
