import { Group, Panel } from 'react-resizable-panels';

import { ResizeHandle } from '../components/ResizeHandle';

/** Request tabs + request editor / response split. Placeholders until PIGN-006/PIGN-016. */
export function MainArea() {
  return (
    <section className="flex h-full min-w-0 flex-col bg-bg">
      <div
        role="tablist"
        aria-label="Open requests"
        data-testid="request-tabs"
        className="flex h-tabbar shrink-0 items-center border-b border-border bg-surface px-3 text-sm text-fg-muted"
      >
        No requests open
      </div>
      <Group orientation="vertical" className="min-h-0 flex-1">
        <Panel id="request-pane" defaultSize="55" minSize="15">
          <div
            data-testid="request-editor"
            className="flex h-full items-center justify-center text-sm text-fg-muted"
          >
            Open a request to start editing
          </div>
        </Panel>
        <ResizeHandle direction="vertical" testId="response-resize-handle" />
        <Panel id="response-pane" defaultSize="45" minSize="10">
          <div
            data-testid="response-panel"
            className="flex h-full items-center justify-center bg-surface text-sm text-fg-muted"
          >
            Send a request to see the response
          </div>
        </Panel>
      </Group>
    </section>
  );
}
