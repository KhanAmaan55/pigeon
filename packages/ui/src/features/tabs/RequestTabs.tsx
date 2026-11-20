import { AlertTriangle, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';

import type { OpenProject } from '../../stores/app-store';
import { useProjectState } from '../../stores/AppStoreProvider';
import { methodLabel } from '../explorer/tree';
import { methodColorClass } from '../request-editor/methods';
import { disposeTabEditor } from './editor-registry';

const NO_TABS: never[] = [];

/** Cmd/Ctrl+W, or Alt+W where the browser keeps Cmd/Ctrl+W (docs/ui-ux.md §4). */
export function isCloseTabShortcut(event: KeyboardEvent): boolean {
  return (
    event.code === 'KeyW' && !event.shiftKey && (event.metaKey || event.ctrlKey || event.altKey)
  );
}

/**
 * Request tabs of the open project (docs/ui-ux.md §3.2): method + name, ● for unsaved edits,
 * italic preview tab, close (button, middle click, Cmd/Ctrl+W), Ctrl+Tab cycling.
 */
export function RequestTabs({ project }: { project: OpenProject }) {
  const { session, store } = project;
  const tabs = useProjectState((s) => s.tabs, NO_TABS);
  const activeTabId = useProjectState((s) => s.activeTabId, null);
  const unsaved = useProjectState((s) => s.unsaved, null);
  const model = useProjectState((s) => s.model, null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const close = (id: string) => {
    if (session.isUnsaved(id)) {
      setConfirming(id);
      return;
    }
    store.getState().closeTab(id);
    disposeTabEditor(session, id);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = store.getState();
      if (isCloseTabShortcut(event) && state.activeTabId) {
        event.preventDefault();
        close(state.activeTabId);
      } else if (event.key === 'Tab' && event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        state.cycleTab(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // `close` reads the latest state through the store; re-binding per render is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, session]);

  const pending = confirming ? session.findRequest(confirming) : undefined;
  return (
    <>
      <div
        role="tablist"
        aria-label="Open requests"
        data-testid="request-tabs"
        className="flex h-tabbar shrink-0 items-stretch overflow-x-auto border-b border-border bg-surface"
      >
        {tabs.length === 0 && (
          <span className="flex items-center px-3 text-sm text-fg-muted">No request open</span>
        )}
        {tabs.map((tab) => {
          // `model` in the dependency list keeps names current after edits.
          const request = model ? session.findRequest(tab.id) : undefined;
          const active = tab.id === activeTabId;
          const dirty = unsaved?.[tab.id] === true;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              data-testid="request-tab"
              data-pinned={tab.pinned}
              data-unsaved={dirty || undefined}
              title={request?.name}
              onClick={() => store.getState().activateTab(tab.id)}
              onDoubleClick={() => store.getState().pinTab(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) close(tab.id);
              }}
              className={`group flex max-w-56 shrink-0 cursor-default items-center gap-1.5 border-r border-border pr-1 pl-3 text-sm ${
                active ? 'bg-bg text-fg' : 'text-fg-muted hover:bg-hover'
              }`}
            >
              {request?.broken ? (
                <AlertTriangle size={12} className="shrink-0 text-warn" aria-hidden />
              ) : (
                <span
                  className={`font-mono text-[10px] font-bold ${methodColorClass(request?.method ?? '')}`}
                >
                  {methodLabel(request?.method ?? '')}
                </span>
              )}
              <span
                data-testid="request-tab-name"
                className={`truncate ${tab.pinned ? '' : 'italic'}`}
              >
                {request?.name ?? tab.id}
              </span>
              <span className="relative flex size-5 shrink-0 items-center justify-center">
                {dirty && (
                  <span
                    data-testid="request-tab-unsaved"
                    aria-label="(unsaved)"
                    className="size-2 rounded-full bg-fg-muted group-hover:hidden"
                  />
                )}
                <button
                  type="button"
                  aria-label={`Close ${request?.name ?? 'tab'}`}
                  data-testid="request-tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    close(tab.id);
                  }}
                  className={`absolute inset-0 items-center justify-center rounded hover:bg-hover ${
                    dirty ? 'hidden group-hover:flex' : 'flex'
                  } ${active || dirty ? '' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <Dialog.Root open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40" />
          <Dialog.Content
            data-testid="close-tab-dialog"
            className="fixed top-1/2 left-1/2 w-[min(26rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface-raised p-4 text-sm text-fg shadow-xl"
          >
            <Dialog.Title className="text-base font-semibold">
              Discard changes to “{pending?.name ?? ''}”?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-fg-muted">
              The request has unsaved changes. Discarding restores the version in the project files.
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="h-8 rounded border border-border px-3 hover:bg-hover"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                data-testid="close-tab-discard"
                onClick={() => {
                  if (!confirming) return;
                  session.discardUnsaved(confirming);
                  store.getState().closeTab(confirming);
                  disposeTabEditor(session, confirming);
                  setConfirming(null);
                }}
                className="h-8 rounded bg-fail px-3 font-semibold text-white hover:opacity-90"
              >
                Discard
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
