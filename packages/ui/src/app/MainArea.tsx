import { FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Group, Panel } from 'react-resizable-panels';

import { EmptyState } from '../components/ui';
import { ResizeHandle } from '../components/ResizeHandle';
import { EnvironmentEditor } from '../features/environments/EnvironmentEditor';
import { ContainerSettings, GlobalsEditor } from '../features/environments/ScopeEditors';
import { findContainer, GLOBALS_ENTITY_ID } from '@pigeon/core';
import { BrokenFilePanel } from '../features/explorer/BrokenFilePanel';
import { RequestEditor } from '../features/request-editor/RequestEditor';
import {
  ScratchRequestProvider,
  useEditorEnvironment,
} from '../features/request-editor/ScratchRequestProvider';
import type { ResponseDock } from '../features/response-viewer/ResponseViewer';
import { ResponseViewer } from '../features/response-viewer/ResponseViewer';
import { ChangeBanners } from '../features/tabs/ChangeBanners';
import { getTabEditor, projectScopes } from '../features/tabs/editor-registry';
import { VariablesProvider } from '../components/VariableInput';
import { ExampleView } from '../features/examples/ExampleView';
import { RequestTabs } from '../features/tabs/RequestTabs';
import { RunDialog, RunnerView } from '../features/runner/Runner';
import { RUNNER_TAB_ID } from '../features/runner/tab';
import type { OpenProject } from '../stores/app-store';
import { useAppStore, useProjectState } from '../stores/AppStoreProvider';
import { useCommand } from '../features/command-palette/CommandsProvider';
import { usePlatform } from './PlatformProvider';

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

  // Cmd/Ctrl+Alt+L (docs/ui-ux.md §4).
  useCommand('view.toggleResponseLayout', toggleDock);

  const split = <EditorSplit dock={dock} onToggleDock={toggleDock} />;
  return (
    <main aria-label="Request" className="flex h-full min-w-0 flex-col bg-bg">
      {project ? (
        <ProjectTabs key={project.key} project={project} split={split} />
      ) : (
        <ScratchRequestProvider>
          <div
            role="tablist"
            aria-label="Open requests"
            data-testid="request-tabs"
            className="flex h-tabbar shrink-0 items-center border-b border-border bg-bg px-2 text-sm"
          >
            <span
              role="tab"
              aria-selected
              data-testid="scratch-tab"
              className="flex h-8 items-center rounded-full bg-selected px-3.5 text-sm font-semibold text-fg"
            >
              Scratch request
            </span>
          </div>
          {split}
        </ScratchRequestProvider>
      )}
    </main>
  );
}

function ProjectTabs({ project, split }: { project: OpenProject; split: React.ReactNode }) {
  const platform = usePlatform();
  const env = useEditorEnvironment();
  const activeTabId = useProjectState((s) => s.activeTabId, null);
  // Re-render when the working model changes (e.g. the request became broken on reload).
  const model = useProjectState((s) => s.model, null);
  const selectedEnvironmentId = useProjectState((s) => s.selectedEnvironmentId, null);
  const currentValues = useProjectState((s) => s.currentValues, null);
  // Highlighting follows the environment, its values and current values.
  const scopes = useMemo(
    () => projectScopes(project.session, activeTabId ?? undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.session, model, selectedEnvironmentId, currentValues, activeTabId],
  );
  const request = activeTabId ? project.session.findRequest(activeTabId) : undefined;
  const environment = activeTabId ? project.session.findEnvironment(activeTabId) : undefined;
  const container =
    activeTabId && model
      ? findContainer(project.session.getWorkingModel(), activeTabId)
      : undefined;

  const example = activeTabId && !request ? project.session.findExample(activeTabId) : undefined;

  let content: React.ReactNode;
  if (activeTabId === RUNNER_TAB_ID) {
    content = <RunnerView />;
  } else if (activeTabId && example) {
    content = (
      <ExampleView session={project.session} store={project.store} exampleId={activeTabId} />
    );
  } else if (activeTabId === GLOBALS_ENTITY_ID) {
    content = <GlobalsEditor session={project.session} />;
  } else if (activeTabId && container) {
    content = <ContainerSettings session={project.session} containerId={activeTabId} />;
  } else if (activeTabId && environment) {
    content = <EnvironmentEditor session={project.session} environmentId={activeTabId} />;
  } else if (!activeTabId || !request) {
    content = (
      <EmptyState
        data-testid="no-tab"
        icon={<FileText aria-hidden />}
        title="No request open"
        description="Open a request from the explorer."
      />
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
        <ChangeBanners session={project.session} requestId={activeTabId} />
        {split}
      </ScratchRequestProvider>
    );
  }
  return (
    <VariablesProvider scopes={scopes}>
      <RequestTabs project={project} />
      {content}
      <RunDialog />
    </VariablesProvider>
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
