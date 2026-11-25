import { Bookmark, AlertTriangle, ChevronDown, Play, Save, Variable, X } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';

import type { OpenProject } from '../../stores/app-store';
import { findContainer, GLOBALS_ENTITY_ID } from '@pigeon/core';

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  menu,
} from '../../components/ui';
import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';
import { methodLabel } from '../explorer/tree';
import { methodColorClass } from '../request-editor/methods';
import { disposeTabEditor } from './editor-registry';
import { RUNNER_TAB_ID } from '../runner/tab';
import { useCommand } from '../command-palette/CommandsProvider';

const NO_TABS: never[] = [];

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

  // An example tab saves its request, which holds the example (PIGN-027).
  const activeEntity = () => {
    const id = store.getState().activeTabId;
    return id ? (session.findExample(id)?.request.id ?? id) : null;
  };
  // Cmd/Ctrl+S, Cmd/Ctrl+Shift+S (PIGN-019), Cmd/Ctrl+W (Alt+W on web), Ctrl+(Shift+)Tab.
  useCommand('file.saveForCommit', () => {
    const active = activeEntity();
    if (active) void saveForCommit([active]);
  });
  useCommand('file.save', () => {
    const active = activeEntity();
    if (active && session.isUnsaved(active)) void save([active]);
  });
  useCommand('tab.close', () => {
    const id = store.getState().activeTabId;
    if (!id) return false;
    close(id);
  });
  useCommand('tab.next', () => store.getState().cycleTab(1));
  useCommand('tab.previous', () => store.getState().cycleTab(-1));

  const pending = confirming
    ? (session.findRequest(confirming) ??
      session.findEnvironment(confirming) ??
      findContainer(session.getWorkingModel(), confirming) ??
      (confirming === GLOBALS_ENTITY_ID ? { name: 'Globals' } : undefined))
    : undefined;
  return (
    <>
      <div className="flex h-tabbar shrink-0 items-center border-b border-border bg-bg pl-2">
        <div
          role={tabs.length > 0 ? 'tablist' : 'group'}
          aria-label="Open requests"
          data-testid="request-tabs"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {tabs.length === 0 && (
            <span className="flex items-center px-1.5 text-sm text-fg-muted">No request open</span>
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
                : tab.id === RUNNER_TAB_ID
                  ? 'Runner'
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
                tabIndex={active ? 0 : -1}
                onKeyDown={(event) => {
                  // Keyboard access (PIGN-042): Enter/Space activate, ←/→ move between tabs.
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    store.getState().activateTab(tab.id);
                  } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    const tabs = [
                      ...event.currentTarget.parentElement!.querySelectorAll<HTMLElement>(
                        '[role="tab"]',
                      ),
                    ];
                    const index = tabs.indexOf(event.currentTarget);
                    const next =
                      tabs[
                        (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                      ];
                    next?.focus();
                    next?.click();
                  }
                }}
                data-pinned={tab.pinned}
                data-unsaved={dirty || undefined}
                title={label}
                onClick={() => store.getState().activateTab(tab.id)}
                onDoubleClick={() => store.getState().pinTab(tab.id)}
                onAuxClick={(event) => {
                  if (event.button === 1) close(tab.id);
                }}
                className={`group flex h-8 max-w-56 shrink-0 cursor-default items-center gap-1.5 rounded-full pr-1 pl-3 text-sm transition-colors ${
                  active
                    ? 'bg-selected font-semibold text-fg'
                    : 'font-medium text-fg-muted hover:bg-hover hover:text-fg'
                }`}
              >
                {tab.id === RUNNER_TAB_ID ? (
                  <Play size={12} className="shrink-0 text-fg-muted" aria-hidden />
                ) : environment || container || tab.id === GLOBALS_ENTITY_ID ? (
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
                    className={`absolute inset-0 items-center justify-center rounded-full text-fg-muted hover:bg-border hover:text-fg ${
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
        <div className="flex shrink-0 items-center px-2">
          <Button
            size="xs"
            data-testid="save-button"
            disabled={!canSave || !activeTabId || unsaved?.[activeTabId] !== true}
            title="Save (Ctrl/⌘ S): keep the changes in local state; project files don't change"
            onClick={() => activeTabId && void save([activeTabId])}
            icon={<Save aria-hidden />}
            className="rounded-r-none"
          >
            Save
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                size="xs"
                aria-label="More save options"
                data-testid="save-menu"
                disabled={!canSave}
                className="-ml-px rounded-l-none px-1"
              >
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4} className={menu.content}>
                <DropdownMenu.Item
                  data-testid="save-all"
                  disabled={!hasUnsaved}
                  onSelect={() => void save()}
                  className={menu.item}
                >
                  Save all
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent width="sm" data-testid="close-tab-dialog">
          <DialogTitle>Discard changes to “{pending?.name ?? ''}”?</DialogTitle>
          <DialogDescription>
            The request has unsaved changes. Discarding restores the version in the project files.
          </DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            {canSave && (
              <Button
                variant="primary"
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
              >
                Save
              </Button>
            )}
            <Button
              variant="danger"
              data-testid="close-tab-discard"
              onClick={() => {
                if (!confirming) return;
                session.discardUnsaved(confirming);
                store.getState().closeTab(confirming);
                disposeTabEditor(session, confirming);
                setConfirming(null);
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
