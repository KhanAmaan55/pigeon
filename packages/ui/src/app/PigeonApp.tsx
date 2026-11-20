import type { Platform } from '@pigeon/platform';

import { TooltipProvider } from '../components/Tooltip';
import { ImportDialog } from '../features/import-export/ImportDialog';
import { InitProjectDialog } from '../features/projects/InitProjectDialog';
import type { AppStore } from '../stores/app-store';
import { AppStoreProvider } from '../stores/AppStoreProvider';
import { WebLimitationsDialog } from '../features/help/WebLimitations';
import type { AppConfig } from './AppConfig';
import { AppConfigProvider } from './AppConfig';
import { AppShell } from './AppShell';
import { PlatformProvider } from './PlatformProvider';
import { PreferencesProvider } from './preferences';
import { SettingsPersistence } from './SettingsPersistence';
import { ThemeProvider } from './theme';

/** Root component rendered by apps/web and apps/desktop, each with its own `Platform`. */
export function PigeonApp({
  platform,
  appStore,
  config = {},
}: {
  platform: Platform;
  appStore?: AppStore;
  config?: AppConfig;
}) {
  return (
    <AppConfigProvider config={config}>
      <PlatformProvider platform={platform}>
        <AppStoreProvider {...(appStore ? { store: appStore } : {})}>
          <PreferencesProvider>
            <ThemeProvider>
              <TooltipProvider delayDuration={400}>
                <SettingsPersistence />
                <AppShell />
                <InitProjectDialog />
                <ImportDialog />
                <WebLimitationsDialog />
              </TooltipProvider>
            </ThemeProvider>
          </PreferencesProvider>
        </AppStoreProvider>
      </PlatformProvider>
    </AppConfigProvider>
  );
}
