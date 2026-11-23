import { EnvironmentsView } from '../features/environments/EnvironmentsView';
import { Explorer } from '../features/explorer/Explorer';
import { HistoryView } from '../features/history/HistoryView';
import { PendingChanges } from '../features/pending-changes/PendingChanges';
import { RunnerSidebar } from '../features/runner/Runner';
import { Welcome } from '../features/projects/Welcome';
import { CorsProxySettings } from '../features/settings/CorsProxySettings';
import { Diagnostics } from '../features/settings/Diagnostics';
import { ExampleSettings } from '../features/settings/ExampleSettings';
import { KeyboardSettings } from '../features/settings/Keyboard';
import { ProjectComparisonSettings } from '../features/settings/ProjectComparisonSettings';
import { RequestDefaults } from '../features/settings/RequestDefaults';
import { ScriptSettings } from '../features/settings/ScriptSettings';
import { SecretsSettings } from '../features/settings/SecretsSettings';
import { useAppStore } from '../stores/AppStoreProvider';
import type { SidebarView } from './views';
import { SIDEBAR_VIEW_TITLES } from './views';

/** Sidebar for the active view; most views stay placeholders until their feature story. */
export function Sidebar({ view }: { view: SidebarView }) {
  const hasProject = useAppStore((s) => s.project !== null);
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
          <RequestDefaults />
          <CorsProxySettings />
          <ExampleSettings />
          <ProjectComparisonSettings />
          <SecretsSettings />
          <ScriptSettings />
          <KeyboardSettings />
          <Diagnostics />
        </div>
      ) : view === 'environments' ? (
        <EnvironmentsView />
      ) : view === 'history' ? (
        <HistoryView />
      ) : view === 'runner' ? (
        <RunnerSidebar />
      ) : view === 'pending' ? (
        <PendingChanges />
      ) : view === 'collections' ? (
        hasProject ? (
          <Explorer />
        ) : (
          <Welcome />
        )
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-fg-muted">
          No project open
        </div>
      )}
    </aside>
  );
}
