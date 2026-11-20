import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Group, Panel } from 'react-resizable-panels';

import { ResizeHandle } from '../components/ResizeHandle';
import { BrokenFilePanel } from '../features/explorer/BrokenFilePanel';
import { RequestEditor } from '../features/request-editor/RequestEditor';
import {
  ScratchRequestProvider,
  useEditorEnvironment,
} from '../features/request-editor/ScratchRequestProvider';
import type { ResponseDock } from '../features/response-viewer/ResponseViewer';
import { ResponseViewer } from '../features/response-viewer/ResponseViewer';
import { getTabEditor } from '../features/tabs/editor-registry';
import { RequestTabs } from '../features/tabs/RequestTabs';
import type { OpenProject } from '../stores/app-store';
import { useAppStore, useProjectState } from '../stores/AppStoreProvider';
import { usePlatform } from './PlatformProvider';

/** Cmd/Ctrl+Alt+L (docs/ui-ux.md §4). `code`, since Alt changes `key` on macOS (`¬`). */
export function isToggleDockShortcut(event: KeyboardEvent): boolean {
  return (
    event.code === 'KeyL' && event.altKey && (event.metaKey || event.ctrlKey) && !event.shiftKey
  );
}

/**
 * Request tabs and the request editor / response split (docs/ui-ux.md §2). Without a project
 * there is one "Scratch request" tab; with one, the project's request tabs (PIGN-016). The
 * response docks at the bottom or on the right.
 */
export function MainArea() {
  const project = useAppStore((s) => s.project);
  // Without a project the dock lives here; a project remembers its own (local state).
  const [scratchDock, setScratchDock] = useState<ResponseDock>('bottom');
  const projectDock = useProjectState((s) => s.dock, null);
  const dock = projectDock ?? scratchDock;
  const toggleDock = () => {
    const next = dock === 'bottom' ? 'right' : 'bottom';
    if (project) project.store.getState().setDock(next);
    else setScratchDock(next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isToggleDockShortcut(event)) return;
      event.preventDefault();
      toggleDock();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const split = <EditorSplit dock={dock} onToggleDock={toggleDock} />;
  return (
    <section className="flex h-full min-w-0 flex-col bg-bg">
      {project ? (
        <ProjectTabs project={project} split={split} />
      ) : (
        <ScratchRequestProvider>
          <div
            role="tablist"
            aria-label="Open requests"
            data-testid="request-tabs"
            className="flex h-tabbar shrink-0 items-center border-b border-border bg-surface px-3 text-sm text-fg-muted"
          >
            <span role="tab" aria-selected data-testid="scratch-tab">
              Scratch request
            </span>
          </div>
          {split}
        </ScratchRequestProvider>
      )}
    </section>
  );
}

function ProjectTabs({ project, split }: { project: OpenProject; split: React.ReactNode }) {
  const platform = usePlatform();
  const env = useEditorEnvironment();
  const activeTabId = useProjectState((s) => s.activeTabId, null);
  // Re-render when the working model changes (e.g. the request became broken on reload).
  useProjectState((s) => s.model, null);
  const request = activeTabId ? project.session.findRequest(activeTabId) : undefined;

  let content: React.ReactNode;
  if (!activeTabId || !request) {
    content = (
      <div
        data-testid="no-tab"
        className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-fg-muted"
      >
        <FileText size={28} aria-hidden />
        Open a request from the explorer.
      </div>
    );
  } else if (request.broken) {
    const path = project.session.itemFilePath(request.id) ?? '';
    content = (
      <BrokenFilePanel
        name={request.name}
        path={path}
        message={project.session.problemsFor(path)[0]?.message ?? 'The file is invalid.'}
      />
    );
  } else {
    const editor = getTabEditor(project.session, project.store, activeTabId, platform, env);
    content = (
      <ScratchRequestProvider key={activeTabId} store={editor}>
        {split}
      </ScratchRequestProvider>
    );
  }
  return (
    <>
      <RequestTabs project={project} />
      {content}
    </>
  );
}

function EditorSplit({ dock, onToggleDock }: { dock: ResponseDock; onToggleDock: () => void }) {
  const right = dock === 'right';
  return (
    <Group
      orientation={right ? 'horizontal' : 'vertical'}
      data-testid="request-response-split"
      data-dock={dock}
      className="min-h-0 flex-1"
    >
      {/* Not remounted on a dock change, so the response keeps its tab and view. */}
      <Panel id="request-pane" defaultSize="45" minSize="15">
        <RequestEditor />
      </Panel>
      <ResizeHandle direction={right ? 'horizontal' : 'vertical'} testId="response-resize-handle" />
      <Panel id="response-pane" defaultSize="55" minSize="10">
        <ResponseViewer dock={dock} onToggleDock={onToggleDock} />
      </Panel>
    </Group>
  );
}
