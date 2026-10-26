import type { Platform } from '@pigeon/platform';

import { TooltipProvider } from '../components/Tooltip';
import { AppShell } from './AppShell';
import { PlatformProvider } from './PlatformProvider';
import { ThemeProvider } from './theme';

/** Root component rendered by apps/web and apps/desktop, each with its own `Platform`. */
export function PigeonApp({ platform }: { platform: Platform }) {
  return (
    <PlatformProvider platform={platform}>
      <ThemeProvider>
        <TooltipProvider delayDuration={400}>
          <AppShell />
        </TooltipProvider>
      </ThemeProvider>
    </PlatformProvider>
  );
}
