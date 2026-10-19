import { TooltipProvider } from '../components/Tooltip';
import { AppShell } from './AppShell';
import { ThemeProvider } from './theme';

/** Root component rendered by apps/web and apps/desktop. Takes a `platform` prop from PIGN-004. */
export function PigeonApp() {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={400}>
        <AppShell />
      </TooltipProvider>
    </ThemeProvider>
  );
}
