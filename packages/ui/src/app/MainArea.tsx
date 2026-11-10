import { useEffect, useState } from 'react';
import { Group, Panel } from 'react-resizable-panels';

import { ResizeHandle } from '../components/ResizeHandle';
import { RequestEditor } from '../features/request-editor/RequestEditor';
import { ScratchRequestProvider } from '../features/request-editor/ScratchRequestProvider';
import type { ResponseDock } from '../features/response-viewer/ResponseViewer';
import { ResponseViewer } from '../features/response-viewer/ResponseViewer';

/** Cmd/Ctrl+Alt+L (docs/ui-ux.md §4). `code`, since Alt changes `key` on macOS (`¬`). */
export function isToggleDockShortcut(event: KeyboardEvent): boolean {
  return (
    event.code === 'KeyL' && event.altKey && (event.metaKey || event.ctrlKey) && !event.shiftKey
  );
}

/**
 * Request editor / response split for the scratch request; the response docks at the bottom or
 * on the right (in memory for now). Request tabs arrive with PIGN-016.
 */
export function MainArea() {
  const [dock, setDock] = useState<ResponseDock>('bottom');
  const toggleDock = () => setDock((current) => (current === 'bottom' ? 'right' : 'bottom'));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isToggleDockShortcut(event)) return;
      event.preventDefault();
      setDock((current) => (current === 'bottom' ? 'right' : 'bottom'));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const right = dock === 'right';
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
          <ResizeHandle
            direction={right ? 'horizontal' : 'vertical'}
            testId="response-resize-handle"
          />
          <Panel id="response-pane" defaultSize="55" minSize="10">
            <ResponseViewer dock={dock} onToggleDock={toggleDock} />
          </Panel>
        </Group>
      </section>
    </ScratchRequestProvider>
  );
}
