import { ChevronDown, Moon, Sun } from 'lucide-react';

import { IconButton } from '../components/IconButton';
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
      <div
        role="tablist"
        aria-label="Open projects"
        data-testid="project-tabs"
        className="flex min-w-0 flex-1 items-center text-sm text-fg-muted"
      >
        <span className="truncate">No project open</span>
      </div>
      <button
        type="button"
        disabled
        data-testid="environment-selector"
        className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-sm text-fg-muted disabled:opacity-60"
      >
        No environment
        <ChevronDown size={14} />
      </button>
      <IconButton
        label={`Switch to ${nextTheme} theme`}
        icon={resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        data-testid="theme-toggle"
        onClick={toggle}
      />
    </header>
  );
}
