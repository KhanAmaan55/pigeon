import type { Capabilities, Platform } from '@pigeon/platform';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

const PlatformContext = createContext<Platform | null>(null);

export function PlatformProvider({
  platform,
  children,
}: {
  platform: Platform;
  children: ReactNode;
}) {
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): Platform {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error('usePlatform() must be used inside <PlatformProvider>');
  return platform;
}

/** What the platform can do. Features branch on these, never on `platform.kind`. */
export function useCapabilities(): Readonly<Capabilities> {
  return usePlatform().capabilities;
}
