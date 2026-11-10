import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';
import { useStore } from 'zustand';

import { usePlatform } from '../../app/PlatformProvider';
import type { ScratchRequestState, ScratchRequestStore } from './scratch-store';
import { createScratchRequestStore } from './scratch-store';

const ScratchRequestContext = createContext<ScratchRequestStore | null>(null);

/** One scratch-request store per mounted main area, so tests and windows never share state. */
export function ScratchRequestProvider({ children }: { children: ReactNode }) {
  const platform = usePlatform();
  const [store] = useState(() => createScratchRequestStore(platform));
  return <ScratchRequestContext.Provider value={store}>{children}</ScratchRequestContext.Provider>;
}

export function useScratchRequest<T>(selector: (state: ScratchRequestState) => T): T {
  const store = useContext(ScratchRequestContext);
  if (!store) throw new Error('useScratchRequest() must be used inside <ScratchRequestProvider>');
  return useStore(store, selector);
}
