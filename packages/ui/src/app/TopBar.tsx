import { ChevronDown, Moon, Sun, X } from 'lucide-react';

import { IconButton } from '../components/IconButton';
import { useAppStore } from '../stores/AppStoreProvider';
import { locationLabel } from '../stores/locations';
import { useTheme } from './theme';

export function TopBar() {
  const { resolved, toggle } = useTheme();
  const nextTheme = resolved === 'dark' ? 'light' : 'dark';
  const project = useAppStore((s) => s.project);
  const closeProject = useAppStore((s) => s.closeProject);

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
        {project ? (
          <div
            role="tab"
            aria-selected
            data-testid="project-tab"
            title={locationLabel(project.session.location)}
            className="flex h-7 min-w-0 items-center gap-1 rounded border border-border bg-surface pr-0.5 pl-2 text-fg"
          >
            <span className="truncate">{project.session.name || 'Untitled project'}</span>
            <IconButton
              label="Close project"
              icon={<X size={12} />}
              data-testid="close-project"
              className="size-6"
              onClick={closeProject}
            />
          </div>
        ) : (
          <span className="truncate">No project open</span>
        )}
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
