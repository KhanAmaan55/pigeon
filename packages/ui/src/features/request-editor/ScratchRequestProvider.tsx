import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';
import { useStore } from 'zustand';

import { usePlatform } from '../../app/PlatformProvider';
import { usePreferencesStore } from '../../app/preferences';
import type {
  ScratchRequestEnvironment,
  ScratchRequestState,
  ScratchRequestStore,
} from './scratch-store';
import { createScratchRequestStore } from './scratch-store';

const ScratchRequestContext = createContext<ScratchRequestStore | null>(null);

/** Execution environment of editor stores: current preferences and the page origin. */
export function useEditorEnvironment(): ScratchRequestEnvironment {
  const preferences = usePreferencesStore();
  return {
    preferences: () => preferences?.getState().execution,
    autoCompare: () => preferences?.getState().autoCompare ?? true,
    recordHistory: () => preferences?.getState().recordHistory ?? true,
    // An https page cannot call http APIs; core tells that apart from CORS by the origin.
    pageOrigin: () => globalThis.location?.origin,
  };
}

/**
 * Provides the editor store the request editor and response viewer work on: `store` (a project
 * tab's), or a scratch-request store owned by this provider, so tests and windows never share
 * state.
 */
export function ScratchRequestProvider({
  children,
  store: given,
}: {
  children: ReactNode;
  store?: ScratchRequestStore;
}) {
  const platform = usePlatform();
  const env = useEditorEnvironment();
  const [own] = useState(() => (given ? null : createScratchRequestStore(platform, env)));
  const store = given ?? own!;
  return <ScratchRequestContext.Provider value={store}>{children}</ScratchRequestContext.Provider>;
}

export function useScratchRequest<T>(selector: (state: ScratchRequestState) => T): T {
  const store = useContext(ScratchRequestContext);
  if (!store) throw new Error('useScratchRequest() must be used inside <ScratchRequestProvider>');
  return useStore(store, selector);
}

/** The store itself, for code that drives it (e.g. opening a project request). */
export function useScratchRequestStore(): ScratchRequestStore {
  const store = useContext(ScratchRequestContext);
  if (!store)
    throw new Error('useScratchRequestStore() must be used inside <ScratchRequestProvider>');
  return store;
}
