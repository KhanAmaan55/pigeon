import { FolderTree, GitCompareArrows, Play, Settings, Variable } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconButton } from '../components/IconButton';
import type { SidebarView } from './views';
import { SIDEBAR_VIEW_TITLES } from './views';

const ICON_SIZE = 18;

const PRIMARY_VIEWS: Array<{ view: SidebarView; icon: ReactNode }> = [
  { view: 'collections', icon: <FolderTree size={ICON_SIZE} /> },
  { view: 'environments', icon: <Variable size={ICON_SIZE} /> },
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
  const button = (view: SidebarView, icon: ReactNode) => (
    <IconButton
      key={view}
      label={SIDEBAR_VIEW_TITLES[view]}
      icon={icon}
      active={active === view}
      indicator
      aria-pressed={active === view}
      tooltipSide="right"
      data-testid={`activity-${view}`}
      onClick={() => onSelect(view)}
    />
  );

  return (
    <nav
      aria-label="Views"
      data-testid="activity-bar"
      className="flex w-activitybar shrink-0 flex-col items-center gap-1 border-r border-border bg-surface-raised py-2"
    >
      {PRIMARY_VIEWS.map(({ view, icon }) => button(view, icon))}
      <div className="flex-1" />
      {button('settings', <Settings size={ICON_SIZE} />)}
    </nav>
  );
}
