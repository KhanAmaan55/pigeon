import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';
import { useStore } from 'zustand';

import { usePlatform } from '../../app/PlatformProvider';
import { usePreferencesStore } from '../../app/preferences';
import type { ScratchRequestState, ScratchRequestStore } from './scratch-store';
import { createScratchRequestStore } from './scratch-store';

const ScratchRequestContext = createContext<ScratchRequestStore | null>(null);

/** One scratch-request store per mounted main area, so tests and windows never share state. */
export function ScratchRequestProvider({ children }: { children: ReactNode }) {
  const platform = usePlatform();
  const preferences = usePreferencesStore();
  const [store] = useState(() =>
    createScratchRequestStore(platform, {
      preferences: () => preferences?.getState().execution,
      // An https page cannot call http APIs; core tells that apart from CORS by the origin.
      pageOrigin: () => globalThis.location?.origin,
    }),
  );
  return <ScratchRequestContext.Provider value={store}>{children}</ScratchRequestContext.Provider>;
}

export function useScratchRequest<T>(selector: (state: ScratchRequestState) => T): T {
  const store = useContext(ScratchRequestContext);
  if (!store) throw new Error('useScratchRequest() must be used inside <ScratchRequestProvider>');
  return useStore(store, selector);
}
