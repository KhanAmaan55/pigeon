import { FolderTree, GitCompareArrows, History, Play, Settings, Variable } from 'lucide-react';
import type { ReactNode } from 'react';

import { cx } from '../components/ui';
import { useProjectState } from '../stores/AppStoreProvider';
import type { SidebarView } from './views';
import { SIDEBAR_VIEW_TITLES } from './views';

const ICON_SIZE = 18;

/**
 * Short labels under the rail icons. They are the buttons' accessible names too (what is seen is
 * what voice control and screen readers use); the full title is the tooltip.
 */
const RAIL_LABELS: Record<SidebarView, string> = {
  collections: 'Collections',
  environments: 'Envs',
  history: 'History',
  pending: 'Changes',
  runner: 'Runner',
  settings: 'Settings',
};

const PRIMARY_VIEWS: Array<{ view: SidebarView; icon: ReactNode }> = [
  { view: 'collections', icon: <FolderTree size={ICON_SIZE} /> },
  { view: 'environments', icon: <Variable size={ICON_SIZE} /> },
  { view: 'history', icon: <History size={ICON_SIZE} /> },
  { view: 'pending', icon: <GitCompareArrows size={ICON_SIZE} /> },
  { view: 'runner', icon: <Play size={ICON_SIZE} /> },
];

/**
 * Navigation rail (PIGN-059): each view is an icon in a pill indicator with a short label below,
 * the active one filled with the lavender container colour (inspired by Material's rail).
 */
export function ActivityBar({
  active,
  onSelect,
}: {
  active: SidebarView;
  onSelect: (view: SidebarView) => void;
}) {
  const pending = useProjectState((s) => Object.keys(s.changes).length, 0);
  const item = (view: SidebarView, icon: ReactNode) => {
    const selected = active === view;
    return (
      <button
        key={view}
        type="button"
        title={SIDEBAR_VIEW_TITLES[view]}
        aria-pressed={selected}
        data-testid={`activity-${view}`}
        onClick={() => onSelect(view)}
        className="group flex w-full cursor-default flex-col items-center gap-1 py-1 outline-none"
      >
        <span
          className={cx(
            'relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-150 group-focus-visible:ring-2 group-focus-visible:ring-focus',
            selected
              ? 'bg-selected text-accent-text'
              : 'text-fg-muted group-hover:bg-hover group-hover:text-fg',
          )}
        >
          {icon}
          {view === 'pending' && pending > 0 && (
            <span
              data-testid="pending-count"
              aria-label={`${pending} pending changes`}
              className="pointer-events-none absolute -top-1 right-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-2xs leading-4 font-semibold text-accent-fg ring-2 ring-surface"
            >
              {pending}
            </span>
          )}
        </span>
        <span
          className={cx(
            'text-2xs leading-3',
            selected ? 'font-semibold text-fg' : 'font-medium text-fg-muted group-hover:text-fg',
          )}
        >
          {RAIL_LABELS[view]}
        </span>
      </button>
    );
  };

  return (
    <nav
      aria-label="Views"
      data-testid="activity-bar"
      className="flex w-activitybar shrink-0 flex-col items-center gap-2 bg-surface pt-1 pb-3"
    >
      {PRIMARY_VIEWS.map(({ view, icon }) => item(view, icon))}
      <div className="flex-1" />
      {item('settings', <Settings size={ICON_SIZE} />)}
    </nav>
  );
}
