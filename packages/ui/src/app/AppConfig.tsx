/**
 * Build-time configuration the host app passes to `PigeonApp` (PIGN-039), e.g. the web build's
 * `PIGEON_DESKTOP_URL`.
 */

import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

export interface AppConfig {
  /** Where to get the desktop app; the "Get the desktop app" link is hidden without it. */
  desktopAppUrl?: string;
}

const AppConfigContext = createContext<AppConfig>({});

export function AppConfigProvider({
  config,
  children,
}: {
  config: AppConfig;
  children: ReactNode;
}) {
  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig(): AppConfig {
  return useContext(AppConfigContext);
}
