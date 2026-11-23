import { isCurlCommand } from '@pigeon/formats';
import type { DragEvent } from 'react';
import { useEffect, useState } from 'react';
import { Group, Panel } from 'react-resizable-panels';

import { ResizeHandle } from '../components/ResizeHandle';
import { Toast } from '../components/Toast';
import { useAppStore, useAppStoreApi } from '../stores/AppStoreProvider';
import { newRequest } from '../features/explorer/actions';
import type { AppCommand } from './commands';
import { COMMAND_EVENT } from './commands';
import type { CommandId } from '../features/command-palette/commands';
import { useCommand, useCommandRegistry } from '../features/command-palette/CommandsProvider';
import { ActivityBar } from './ActivityBar';
import { MainArea } from './MainArea';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import type { SidebarView } from './views';

/** Desktop menu commands → registry commands. */
const MENU_COMMANDS: Record<AppCommand, CommandId> = {
  'new-request': 'request.new',
  'open-project': 'project.open',
  import: 'file.import',
  'export-project': 'project.export',
  'close-project': 'project.close',
  'toggle-sidebar': 'view.toggleSidebar',
  'toggle-response-layout': 'view.toggleResponseLayout',
  'web-limitations': 'help.webLimitations',
};

/** Top-level layout from docs/ui-ux.md §2. */
export function AppShell() {
  const [view, setView] = useState<SidebarView>('collections');
  const hasProject = useAppStore((s) => s.project !== null);
  const setPendingImport = useAppStore((s) => s.setPendingImport);
  const pickImportFile = useAppStore((s) => s.pickImportFile);
  const notify = useAppStore((s) => s.notify);
  const [dragging, setDragging] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const appStore = useAppStoreApi();

  const registry = useCommandRegistry();
  const needsProject = () => {
    if (appStore.getState().project) return false;
    appStore.getState().notify('Open or create a project first.');
    return true;
  };
  // Commands (PIGN-042): shortcuts, the palette and the desktop menus run these.
  useCommand('request.new', () => {
    if (needsProject()) return;
    const { project } = appStore.getState();
    if (!project) return;
    if (project.session.readOnly) return notify('This project is read-only.');
    setView('collections');
    setSidebarHidden(false);
    newRequest(project.session, project.store);
  });
  // Cmd/Ctrl+O: import a file into the open project (docs/ui-ux.md §3.9).
  useCommand('file.import', hasProject ? () => void pickImportFile() : undefined);
  useCommand('project.open', () => void appStore.getState().openFolder());
  useCommand('project.close', hasProject ? () => appStore.getState().closeProject() : undefined);
  useCommand(
    'project.export',
    hasProject ? () => void appStore.getState().exportProjectZip() : undefined,
  );
  useCommand('view.toggleSidebar', () => setSidebarHidden((hidden) => !hidden));
  useCommand('help.webLimitations', () => appStore.getState().openHelp());
  useCommand('settings.keyboard', () => {
    setView('settings');
    setSidebarHidden(false);
    setTimeout(() => document.getElementById('settings-keyboard')?.scrollIntoView?.(), 0);
  });

  // App commands from the desktop menus (PIGN-041; `pigeon:command` DOM events, see
  // apps/desktop/src/main.tsx).
  useEffect(() => {
    const onCommand = (event: Event) => {
      const command = MENU_COMMANDS[(event as CustomEvent<AppCommand>).detail];
      if (command === 'file.import' || command === 'project.export') {
        if (needsProject()) return;
      }
      if (command) registry?.run(command);
    };
    window.addEventListener(COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(COMMAND_EVENT, onCommand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry]);

  // A cURL command pasted outside a text field opens the import preview (PIGN-050); the URL bar
  // handles its own paste.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor'))
        return;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!isCurlCommand(text)) return;
      event.preventDefault();
      if (!appStore.getState().project) {
        notify('Open or create a project first, then paste the cURL command.');
        return;
      }
      setPendingImport([
        { name: 'Pasted cURL command', bytes: new TextEncoder().encode(text), mime: 'text/plain' },
      ]);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [appStore, notify, setPendingImport]);

  // Other features ask for a sidebar view (e.g. "Edit in project settings").
  useEffect(() => {
    const onOpenView = (event: Event) => {
      const requested = (event as CustomEvent<SidebarView>).detail;
      if (requested) setView(requested);
    };
    window.addEventListener('pigeon:open-view', onOpenView);
    return () => window.removeEventListener('pigeon:open-view', onOpenView);
  }, []);

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
        <ActivityBar
          active={view}
          onSelect={(next) => {
            setView(next);
            setSidebarHidden(false);
          }}
        />
        <Group orientation="horizontal" className="min-w-0 flex-1">
          {!sidebarHidden && (
            <>
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
            </>
          )}
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
