import type { ExecutionPreferences } from '@pigeon/core';
import { DEFAULT_PREFERENCES } from '@pigeon/core';
import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';
import { createStore, useStore } from 'zustand';

/**
 * App preferences. Request defaults only for now (docs/api-execution.md §8: default timeout
 * 30 s, `0` = none); in memory until local state persistence lands (PIGN-018).
 */
export interface PreferencesState {
  execution: ExecutionPreferences;
  setExecution: (patch: Partial<ExecutionPreferences>) => void;
}

export type PreferencesStore = ReturnType<typeof createPreferencesStore>;

export function createPreferencesStore(initial: Partial<ExecutionPreferences> = {}) {
  return createStore<PreferencesState>()((set, get) => ({
    execution: { ...DEFAULT_PREFERENCES, ...initial },
    setExecution: (patch) => set({ execution: { ...get().execution, ...patch } }),
  }));
}

const PreferencesContext = createContext<PreferencesStore | null>(null);

export function PreferencesProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: Partial<ExecutionPreferences>;
}) {
  const [store] = useState(() => createPreferencesStore(initial));
  return <PreferencesContext.Provider value={store}>{children}</PreferencesContext.Provider>;
}

/** The provider's store, or `null` outside one (feature tests); callers fall back to defaults. */
export function usePreferencesStore(): PreferencesStore | null {
  return useContext(PreferencesContext);
}

/** Used outside a `PreferencesProvider` (feature tests): never changes. */
const defaultStore = createPreferencesStore();

/** Current request defaults; `DEFAULT_PREFERENCES` outside a provider. */
export function useExecutionDefaults(): ExecutionPreferences {
  return useStore(usePreferencesStore() ?? defaultStore, (state) => state.execution);
}

/** `30 s`, `1500 ms`, or `no timeout` for `0`. */
export function formatTimeoutPreference(ms: number): string {
  if (ms === 0) return 'no timeout';
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}

export function usePreferences<T>(selector: (state: PreferencesState) => T): T {
  const store = usePreferencesStore();
  if (!store) throw new Error('usePreferences() must be used inside <PreferencesProvider>');
  return useStore(store, selector);
}
