import type { DragEvent } from 'react';
import { useEffect, useState } from 'react';
import { Group, Panel } from 'react-resizable-panels';

import { ResizeHandle } from '../components/ResizeHandle';
import { Toast } from '../components/Toast';
import { useAppStore } from '../stores/AppStoreProvider';
import { ActivityBar } from './ActivityBar';
import { MainArea } from './MainArea';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import type { SidebarView } from './views';

/** Top-level layout from docs/ui-ux.md §2. */
export function AppShell() {
  const [view, setView] = useState<SidebarView>('collections');
  const hasProject = useAppStore((s) => s.project !== null);
  const setPendingImport = useAppStore((s) => s.setPendingImport);
  const pickImportFile = useAppStore((s) => s.pickImportFile);
  const notify = useAppStore((s) => s.notify);
  const [dragging, setDragging] = useState(false);

  // Other features ask for a sidebar view (e.g. "Edit in project settings").
  useEffect(() => {
    const onOpenView = (event: Event) => {
      const requested = (event as CustomEvent<SidebarView>).detail;
      if (requested) setView(requested);
    };
    window.addEventListener('pigeon:open-view', onOpenView);
    return () => window.removeEventListener('pigeon:open-view', onOpenView);
  }, []);

  // Cmd/Ctrl+O: import a file into the open project (docs/ui-ux.md §3.9).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyO' || event.shiftKey || event.altKey) return;
      if (!(event.metaKey || event.ctrlKey) || !hasProject) return;
      event.preventDefault();
      void pickImportFile();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasProject, pickImportFile]);

  /** Files dropped anywhere in the window open the import dialog. */
  // Explorer item drags carry no files; `types` may be missing on synthetic events.
  const isFileDrag = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const onDrop = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0) return;
    if (!hasProject) {
      notify('Open or create a project first, then drop the files to import them.');
      return;
    }
    // Several files (a collection and its environments) make one combined preview.
    void Promise.all(
      files.map(async (file) => ({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        mime: file.type,
      })),
    ).then(setPendingImport);
  };

  return (
    <div
      data-testid="app-shell"
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.relatedTarget === null) setDragging(false);
      }}
      onDrop={onDrop}
      className={`flex h-full flex-col bg-bg text-fg ${dragging ? 'ring-2 ring-accent ring-inset' : ''}`}
    >
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
      <Toast />
    </div>
  );
}
