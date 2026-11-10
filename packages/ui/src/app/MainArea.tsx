import { Group, Panel } from 'react-resizable-panels';

import { ResizeHandle } from '../components/ResizeHandle';
import { RequestEditor } from '../features/request-editor/RequestEditor';
import { ScratchRequestProvider } from '../features/request-editor/ScratchRequestProvider';
import { ResponseViewer } from '../features/response-viewer/ResponseViewer';

/** Request editor / response split for the scratch request. Request tabs arrive with PIGN-016. */
export function MainArea() {
  return (
    <ScratchRequestProvider>
      <section className="flex h-full min-w-0 flex-col bg-bg">
        <div
          role="tablist"
          aria-label="Open requests"
          data-testid="request-tabs"
          className="flex h-tabbar shrink-0 items-center border-b border-border bg-surface px-3 text-sm text-fg-muted"
        >
          Scratch request
        </div>
        <Group orientation="vertical" className="min-h-0 flex-1">
          <Panel id="request-pane" defaultSize="45" minSize="15">
            <RequestEditor />
          </Panel>
          <ResizeHandle direction="vertical" testId="response-resize-handle" />
          <Panel id="response-pane" defaultSize="55" minSize="10">
            <ResponseViewer />
          </Panel>
        </Group>
      </section>
    </ScratchRequestProvider>
  );
}
