import { useState } from 'react';
import { Group, Panel } from 'react-resizable-panels';

import { ResizeHandle } from '../components/ResizeHandle';
import { ActivityBar } from './ActivityBar';
import { MainArea } from './MainArea';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import type { SidebarView } from './views';

/** Top-level layout from docs/ui-ux.md §2. */
export function AppShell() {
  const [view, setView] = useState<SidebarView>('collections');

  return (
    <div data-testid="app-shell" className="flex h-full flex-col bg-bg text-fg">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar active={view} onSelect={setView} />
        <Group orientation="horizontal" className="min-w-0 flex-1">
          <Panel
            id="sidebar-pane"
            defaultSize={280}
            minSize={180}
            maxSize="50"
            groupResizeBehavior="preserve-pixel-size"
          >
            <Sidebar view={view} />
          </Panel>
          <ResizeHandle direction="horizontal" testId="sidebar-resize-handle" />
          <Panel id="main-pane" minSize="30">
            <MainArea />
          </Panel>
        </Group>
      </div>
      <StatusBar />
    </div>
  );
}
