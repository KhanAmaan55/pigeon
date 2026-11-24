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
      className="flex h-topbar shrink-0 items-center gap-3 bg-surface pr-2 pl-3"
    >
      <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight">
        <span
          aria-hidden
          className="flex size-5 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-accent-fg shadow-sm"
        >
          P
        </span>
        Pigeon
      </h1>
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
