import { FolderTree, GitCompareArrows, History, Play, Settings, Variable } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconButton } from '../components/IconButton';
import { useProjectState } from '../stores/AppStoreProvider';
import type { SidebarView } from './views';
import { SIDEBAR_VIEW_TITLES } from './views';

const ICON_SIZE = 18;

const PRIMARY_VIEWS: Array<{ view: SidebarView; icon: ReactNode }> = [
  { view: 'collections', icon: <FolderTree size={ICON_SIZE} /> },
  { view: 'environments', icon: <Variable size={ICON_SIZE} /> },
  { view: 'history', icon: <History size={ICON_SIZE} /> },
  { view: 'pending', icon: <GitCompareArrows size={ICON_SIZE} /> },
  { view: 'runner', icon: <Play size={ICON_SIZE} /> },
];

export function ActivityBar({
  active,
  onSelect,
}: {
  active: SidebarView;
  onSelect: (view: SidebarView) => void;
}) {
  const pending = useProjectState((s) => Object.keys(s.changes).length, 0);
  const button = (view: SidebarView, icon: ReactNode) => (
    <span key={view} className="relative">
      <IconButton
        label={SIDEBAR_VIEW_TITLES[view]}
        icon={icon}
        active={active === view}
        indicator
        aria-pressed={active === view}
        tooltipSide="right"
        data-testid={`activity-${view}`}
        onClick={() => onSelect(view)}
      />
      {view === 'pending' && pending > 0 && (
        <span
          data-testid="pending-count"
          aria-label={`${pending} pending changes`}
          className="pointer-events-none absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-semibold text-accent-fg"
        >
          {pending}
        </span>
      )}
    </span>
  );

  return (
    <nav
      aria-label="Views"
      data-testid="activity-bar"
      className="flex w-activitybar shrink-0 flex-col items-center gap-1.5 bg-surface pt-1 pb-2"
    >
      {PRIMARY_VIEWS.map(({ view, icon }) => button(view, icon))}
      <div className="flex-1" />
      {button('settings', <Settings size={ICON_SIZE} />)}
    </nav>
  );
}
