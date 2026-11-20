import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import type { StoreApi } from 'zustand';
import { createStore, useStore } from 'zustand';

import { createMemoryServices } from '@pigeon/platform';

import { usePlatform } from '../app/PlatformProvider';
import type { AppState, AppStore } from './app-store';
import { createAppStore } from './app-store';
import type { ProjectState } from './project-store';

const AppStoreContext = createContext<AppStore | null>(null);

/** Never changes; stands in when no project is open so hooks run unconditionally. */
const noProjectStore: StoreApi<ProjectState | null> = createStore<ProjectState | null>()(
  () => null,
);

export function AppStoreProvider({
  children,
  store: given,
}: {
  children: ReactNode;
  store?: AppStore;
}) {
  const platform = usePlatform();
  const [store] = useState(() => given ?? createAppStore(platform));
  useEffect(() => {
    void store.getState().loadRecents();
  }, [store]);
  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>;
}

/** Used outside an `AppStoreProvider` (feature tests): no project, nothing persisted. */
let detachedStore: AppStore | undefined;

/** The provider's store; outside one (feature tests) an empty in-memory store. */
export function useAppStoreApi(): AppStore {
  const store = useContext(AppStoreContext);
  return store ?? (detachedStore ??= createAppStore(createMemoryServices()));
}

export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(useAppStoreApi(), selector);
}

/**
 * Selects from the open project's store, or returns `fallback` when no project is open.
 * `fallback` must be a stable value (a constant), as with any store selector.
 */
export function useProjectState<T>(selector: (state: ProjectState) => T, fallback: T): T {
  const project = useAppStore((state) => state.project);
  const store = (project?.store ?? noProjectStore) as StoreApi<ProjectState | null>;
  return useStore(store, (state) => (state === null ? fallback : selector(state)));
}
