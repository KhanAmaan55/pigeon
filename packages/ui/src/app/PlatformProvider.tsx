import type { Capabilities, Platform } from '@pigeon/platform';
import type { ReactNode } from 'react';
import { createContext, useContext, useSyncExternalStore } from 'react';

const PlatformContext = createContext<Platform | null>(null);
const CapabilitiesContext = createContext<Readonly<Capabilities> | null>(null);

const noSubscription = () => () => undefined;

export function PlatformProvider({
  platform,
  children,
}: {
  platform: Platform;
  children: ReactNode;
}) {
  // Web proxy mode (PIGN-052) changes the capabilities at runtime; views re-render with them.
  const capabilities = useSyncExternalStore(
    platform.corsProxy ? (listener) => platform.corsProxy!.subscribe(listener) : noSubscription,
    () => platform.capabilities,
  );
  return (
    <PlatformContext.Provider value={platform}>
      <CapabilitiesContext.Provider value={capabilities}>{children}</CapabilitiesContext.Provider>
    </PlatformContext.Provider>
  );
}

export function usePlatform(): Platform {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error('usePlatform() must be used inside <PlatformProvider>');
  return platform;
}

/** What the platform can do right now. Features branch on these, never on `platform.kind`. */
export function useCapabilities(): Readonly<Capabilities> {
  const capabilities = useContext(CapabilitiesContext);
  const platform = usePlatform();
  return capabilities ?? platform.capabilities;
}
