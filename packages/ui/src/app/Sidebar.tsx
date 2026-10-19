import type { SidebarView } from './views';
import { SIDEBAR_VIEW_TITLES } from './views';

/** Placeholder sidebar; each view's content arrives with its feature story. */
export function Sidebar({ view }: { view: SidebarView }) {
  return (
    <aside
      aria-label={SIDEBAR_VIEW_TITLES[view]}
      data-testid="sidebar"
      className="flex h-full min-w-0 flex-col bg-surface"
    >
      <header className="flex h-tabbar shrink-0 items-center border-b border-border px-3 text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {SIDEBAR_VIEW_TITLES[view]}
      </header>
      <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-fg-muted">
        No project open
      </div>
    </aside>
  );
}
