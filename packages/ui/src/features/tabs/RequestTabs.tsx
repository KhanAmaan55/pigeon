import { Bookmark, AlertTriangle, ChevronDown, Save, Variable, X } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';

import type { OpenProject } from '../../stores/app-store';
import { findContainer, GLOBALS_ENTITY_ID } from '@pigeon/core';

import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';
import { methodLabel } from '../explorer/tree';
import { methodColorClass } from '../request-editor/methods';
import { disposeTabEditor } from './editor-registry';

const NO_TABS: never[] = [];

/** Cmd/Ctrl+S: Save (docs/ui-ux.md §4); Shift is Save for Commit (PIGN-019). */
export function isSaveShortcut(event: KeyboardEvent): boolean {
  return (
    event.code === 'KeyS' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey
  );
}

/** Cmd/Ctrl+Shift+S: Save for Commit (docs/ui-ux.md §4). */
export function isSaveForCommitShortcut(event: KeyboardEvent): boolean {
  return (
    event.code === 'KeyS' && (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey
  );
}

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
  const [saveError, setSaveError] = useState<string | null>(null);
  const changes = useProjectState((s) => s.changes, null);
  const canSave = session.localState !== undefined && !session.readOnly;
  const hasUnsaved = Object.values(changes ?? {}).includes('unsaved');

  const save = async (ids?: string[]) => {
    try {
      setSaveError(null);
      await session.save(ids);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const notify = useAppStore((s) => s.notify);
  /** Save (if needed) + Save for Commit of `ids`, then a toast with the number of files. */
  const saveForCommit = async (ids?: string[]) => {
    try {
      setSaveError(null);
      const { plan, result } = await session.saveForCommit(ids);
      const count = result.written.length + result.deleted.length;
      if (plan.blocked.length > 0) {
        setSaveError(
          `${plan.blocked.length} change(s) could not be written: the file changed on disk.`,
        );
      }
      notify(count === 0 ? 'Nothing to write.' : `Wrote ${count} file${count === 1 ? '' : 's'}.`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const close = (id: string) => {
    if (session.isUnsaved(id)) {
      setConfirming(id);
      return;
    }
    store.getState().closeTab(id);
    disposeTabEditor(session, id);
  };

  useEffect(() => {
    // An example tab saves its request, which holds the example (PIGN-027).
    const entityOf = (id: string) => session.findExample(id)?.request.id ?? id;
    const onKeyDown = (event: KeyboardEvent) => {
      const state = store.getState();
      const active = state.activeTabId ? entityOf(state.activeTabId) : null;
      if (isSaveForCommitShortcut(event)) {
        event.preventDefault();
        if (active) void saveForCommit([active]);
      } else if (isSaveShortcut(event)) {
        event.preventDefault();
        if (active && session.isUnsaved(active)) void save([active]);
      } else if (isCloseTabShortcut(event) && state.activeTabId) {
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

  const pending = confirming
    ? (session.findRequest(confirming) ??
      session.findEnvironment(confirming) ??
      findContainer(session.getWorkingModel(), confirming) ??
      (confirming === GLOBALS_ENTITY_ID ? { name: 'Globals' } : undefined))
    : undefined;
  return (
    <>
      <div className="flex h-tabbar shrink-0 items-stretch border-b border-border bg-surface">
        <div
          role="tablist"
          aria-label="Open requests"
          data-testid="request-tabs"
          className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
        >
          {tabs.length === 0 && (
            <span className="flex items-center px-3 text-sm text-fg-muted">No request open</span>
          )}
          {tabs.map((tab) => {
            // `model` in the dependency list keeps names current after edits.
            const request = model ? session.findRequest(tab.id) : undefined;
            const environment = model && !request ? session.findEnvironment(tab.id) : undefined;
            const container =
              model && !request && !environment ? findContainer(model, tab.id) : undefined;
            const example =
              model && !request && !environment && !container
                ? session.findExample(tab.id)?.example
                : undefined;
            const label =
              request?.name ??
              environment?.name ??
              example?.name ??
              (tab.id === GLOBALS_ENTITY_ID
                ? 'Globals'
                : container
                  ? `${container.name} variables`
                  : tab.id);
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
                title={label}
                onClick={() => store.getState().activateTab(tab.id)}
                onDoubleClick={() => store.getState().pinTab(tab.id)}
                onAuxClick={(event) => {
                  if (event.button === 1) close(tab.id);
                }}
                className={`group flex max-w-56 shrink-0 cursor-default items-center gap-1.5 border-r border-border pr-1 pl-3 text-sm ${
                  active ? 'bg-bg text-fg' : 'text-fg-muted hover:bg-hover'
                }`}
              >
                {environment || container || tab.id === GLOBALS_ENTITY_ID ? (
                  <Variable size={12} className="shrink-0 text-fg-muted" aria-hidden />
                ) : example ? (
                  <Bookmark size={12} className="shrink-0 text-fg-muted" aria-hidden />
                ) : request?.broken ? (
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
                  {label}
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
        {saveError && (
          <span
            role="alert"
            data-testid="save-error"
            title={saveError}
            className="flex max-w-48 items-center truncate px-2 text-xs text-fail"
          >
            {saveError}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-px px-2">
          <button
            type="button"
            data-testid="save-button"
            disabled={!canSave || !activeTabId || unsaved?.[activeTabId] !== true}
            title="Save (Ctrl/⌘ S): keep the changes in local state; project files don't change"
            onClick={() => activeTabId && void save([activeTabId])}
            className="inline-flex h-7 items-center gap-1 rounded-l border border-border px-2 text-xs text-fg hover:bg-hover disabled:opacity-50"
          >
            <Save size={12} aria-hidden />
            Save
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="More save options"
                data-testid="save-menu"
                disabled={!canSave}
                className="inline-flex h-7 items-center rounded-r border border-l-0 border-border px-1 text-fg hover:bg-hover disabled:opacity-50"
              >
                <ChevronDown size={12} aria-hidden />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                className="z-50 min-w-40 rounded-md border border-border bg-surface-raised p-1 text-sm text-fg shadow-lg"
              >
                <DropdownMenu.Item
                  data-testid="save-all"
                  disabled={!hasUnsaved}
                  onSelect={() => void save()}
                  className="cursor-default rounded px-2 py-1 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover"
                >
                  Save all
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
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
              {canSave && (
                <button
                  type="button"
                  data-testid="close-tab-save"
                  onClick={() => {
                    if (!confirming) return;
                    const id = confirming;
                    setConfirming(null);
                    void save([id]).then(() => {
                      store.getState().closeTab(id);
                      disposeTabEditor(session, id);
                    });
                  }}
                  className="h-8 rounded bg-accent px-3 font-semibold text-accent-fg hover:opacity-90"
                >
                  Save
                </button>
              )}
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
                className="h-8 rounded border border-fail px-3 font-semibold text-fail hover:bg-fail/10"
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
