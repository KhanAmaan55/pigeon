import { Moon, Sun } from 'lucide-react';

import { IconButton } from '../components/IconButton';
import { EnvironmentSelector } from '../features/environments/EnvironmentSelector';
import { ProjectTabs } from './ProjectTabs';
import { useTheme } from './theme';

export function TopBar() {
  const { resolved, toggle } = useTheme();
  const nextTheme = resolved === 'dark' ? 'light' : 'dark';

  return (
    <header
      data-testid="top-bar"
      className="flex h-topbar shrink-0 items-center gap-2 border-b border-border bg-surface-raised pr-2 pl-3"
    >
      <span className="font-semibold tracking-tight">Pigeon</span>
      <ProjectTabs />
      <EnvironmentSelector />
      <IconButton
        label={`Switch to ${nextTheme} theme`}
        icon={resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        data-testid="theme-toggle"
        onClick={toggle}
      />
    </header>
  );
}
