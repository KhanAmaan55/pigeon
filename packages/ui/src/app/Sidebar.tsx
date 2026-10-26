import { Diagnostics } from '../features/settings/Diagnostics';
import type { SidebarView } from './views';
import { SIDEBAR_VIEW_TITLES } from './views';

/** Sidebar for the active view; most views stay placeholders until their feature story. */
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
      {view === 'settings' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Diagnostics />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-fg-muted">
          No project open
        </div>
      )}
    </aside>
  );
}
