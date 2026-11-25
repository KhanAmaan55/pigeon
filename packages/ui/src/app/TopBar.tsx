import { Moon, Sun } from 'lucide-react';

import pigeonIcon from '../assets/pigeon-icon.png';
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
      className="flex h-topbar shrink-0 items-center gap-4 bg-surface pr-3 pl-4"
    >
      <h1 className="font-round flex shrink-0 items-center gap-2 text-xl font-bold tracking-tight">
        <img src={pigeonIcon} alt="" aria-hidden width={26} height={26} className="size-[26px]" />
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
