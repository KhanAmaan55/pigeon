import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual';
import {
  AlertTriangle,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Database,
  FileArchive,
  FileInput,
  Folder,
  Library,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { ContextMenu, Dialog } from 'radix-ui';
import type { DragEvent, KeyboardEvent, ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';

import { usePlatform } from '../../app/PlatformProvider';
import { IconButton } from '../../components/IconButton';
import { inheritedAuth, PROJECT_ENTITY_ID, snippetRequest, withBaseline } from '@pigeon/core';

import type { OpenProject } from '../../stores/app-store';
import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';
import { locationLabel } from '../../stores/locations';
import { methodColorClass } from '../request-editor/methods';
import { curlSnippet, isEmptyComparison } from '@pigeon/formats';
import { statusClass } from '../examples/ExamplesTab';
import { useRunner } from '../runner/Runner';
import { GitDot } from '../git/git-status';
import { ExportDialog } from '../import-export/ExportDialog';
import { disposeTabEditor } from '../tabs/editor-registry';
import type { DropPosition } from './actions';
import {
  duplicate,
  newCollection,
  newFolder,
  newRequest,
  requestIdsUnder,
  resolveDrop,
} from './actions';
import type { TreeRow } from './tree';
import { flattenTree, methodLabel } from './tree';

const ROW_HEIGHT = 26;
const NO_ROWS: TreeRow[] = [];
const FALLBACK_RECT = { width: 280, height: 800 };
const DRAG_TYPE = 'application/x-pigeon-item';

/** Collection explorer (docs/ui-ux.md §3.2): a virtualized, editable tree of the open project. */
export function Explorer() {
  const project = useAppStore((s) => s.project);
  if (!project) return null;
  return <ProjectExplorer project={project} />;
}

function ProjectExplorer({ project }: { project: OpenProject }) {
  const { session, store } = project;
  const exportZip = useAppStore((s) => s.exportProjectZip);
  const pickImportFile = useAppStore((s) => s.pickImportFile);
  const notify = useAppStore((s) => s.notify);
  const platform = usePlatform();
  /** The request as cURL, `{{variables}}` kept and literal credentials masked (PIGN-050). */
  const copyAsCurl = (id: string) => {
    const request = session.findRequest(id);
    if (!request) return;
    const inherited = request.auth ? undefined : inheritedAuth(session.getWorkingModel(), id).auth;
    const { request: snippet } = snippetRequest(
      request,
      inherited ? { inheritedAuth: inherited } : {},
      { resolve: false },
    );
    navigator.clipboard.writeText(curlSnippet.generate(snippet)).then(
      () => notify('Copied as cURL.'),
      () => notify('Copy failed: the clipboard is not available.'),
    );
  };
  const model = useProjectState((s) => s.model, null);
  const problems = useProjectState((s) => s.problems, null);
  const expanded = useProjectState((s) => s.expanded, null);
  const unsaved = useProjectState((s) => s.unsaved, null);
  const changes = useProjectState((s) => s.changes, null);
  const deleted = useProjectState((s) => s.deleted, null);
  const comparisons = useProjectState((s) => s.comparisons, null);
  const baselines = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(comparisons ?? {}).map(([requestId, result]) => [
          requestId,
          result.exampleId,
        ]),
      ),
    [comparisons],
  );
  const selectedId = useProjectState((s) => s.selectedId, null);
  const renamingId = useProjectState((s) => s.renamingId, null);
  const filter = useProjectState((s) => s.filter, '');
  const readOnly = useProjectState((s) => s.readOnly, false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TreeRow | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const runner = useRunner();
  const [drop, setDrop] = useState<{ id: string; position: DropPosition } | null>(null);
  const dragged = useRef<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const rows = useMemo(
    () =>
      model && expanded
        ? flattenTree(model, expanded, problems ?? [], {
            filter,
            ...(unsaved ? { unsaved } : {}),
            ...(changes ? { changes } : {}),
            ...(deleted ? { deleted } : {}),
            baselines,
          })
        : NO_ROWS,
    [model, expanded, problems, filter, unsaved, changes, deleted, baselines],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // The virtualizer re-renders through its own state; nothing here memoizes its functions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    // Before layout (and in jsdom) the list measures 0×0; render a screenful anyway.
    initialRect: FALLBACK_RECT,
    observeElementRect: (instance, callback) =>
      observeElementRect(instance, (rect) => callback(rect.height === 0 ? FALLBACK_RECT : rect)),
  });

  /** Runs an edit; command errors (e.g. a read-only project) show above the tree. */
  const edit = (action: () => void) => {
    try {
      setError(null);
      action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /** Single click: requests open in the preview tab; containers expand/collapse. */
  const activate = (row: TreeRow, pin = false) => {
    const state = store.getState();
    if (row.deleted) {
      state.select(row.id);
      return;
    }
    state.select(row.id);
    if (row.kind === 'request' || row.kind === 'example') state.openTab(row.id, { pin });
    else state.toggle(row.id);
  };

  const askDelete = (row: TreeRow) => setDeleting(row);
  const confirmDelete = () => {
    if (!deleting) return;
    if (deleting.kind === 'example') {
      const id = deleting.id;
      edit(() => session.apply({ type: 'deleteExample', id }));
      store.getState().closeTab(id);
      setDeleting(null);
      return;
    }
    const closing = requestIdsUnder(session, deleting.id);
    edit(() => session.apply({ type: 'deleteItem', id: deleting.id }));
    // Their edits go with them: the delete itself is the change to save.
    for (const id of closing) {
      store.getState().closeTab(id);
      disposeTabEditor(session, id);
    }
    setDeleting(null);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (renamingId) return;
    const index = rows.findIndex((row) => row.id === selectedId);
    const row = rows[index];
    const state = store.getState();
    const mod = event.metaKey || event.ctrlKey;
    const go = (next: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, next))];
      if (target) {
        state.select(target.id);
        virtualizer.scrollToIndex(rows.indexOf(target));
      }
    };
    if (mod && event.key.toLowerCase() === 'f') {
      filterRef.current?.focus();
    } else if (mod && event.key.toLowerCase() === 'd') {
      if (row) edit(() => duplicateRow(row));
    } else if (event.key === 'F2') {
      if (row) state.startRename(row.id);
    } else if (event.key === 'Delete' || (mod && event.key === 'Backspace')) {
      if (row) askDelete(row);
    } else if (event.key === 'ArrowDown') {
      go(index + 1);
    } else if (event.key === 'ArrowUp') {
      go(index - 1);
    } else if (event.key === 'ArrowRight') {
      if (row?.hasChildren && !row.expanded) state.setExpanded(row.id, true);
      else go(index + 1);
    } else if (event.key === 'ArrowLeft') {
      if (row?.expanded) state.setExpanded(row.id, false);
      else if (row?.parentId) go(rows.findIndex((r) => r.id === row.parentId));
    } else if (event.key === 'Enter') {
      if (row) activate(row, true);
    } else {
      return;
    }
    event.preventDefault();
  };

  const duplicateRow = (row: TreeRow) => {
    if (row.kind !== 'example') {
      duplicate(session, store, row.id);
      return;
    }
    const newId = crypto.randomUUID();
    session.apply({ type: 'duplicateExample', id: row.id, newId });
    store.getState().select(newId);
  };

  const positionFor = (event: DragEvent, row: TreeRow): DropPosition => {
    const box = event.currentTarget.getBoundingClientRect();
    const offset = box.height > 0 ? (event.clientY - box.top) / box.height : 0.5;
    if (row.kind === 'request') return offset < 0.5 ? 'before' : 'after';
    if (
      row.kind === 'collection' &&
      dragged.current &&
      session.getWorkingModel().collections.some((c) => c.id === dragged.current)
    ) {
      return offset < 0.5 ? 'before' : 'after';
    }
    return offset < 0.25 ? 'before' : offset > 0.75 ? 'after' : 'inside';
  };

  const dragHandlers = (row: TreeRow) => ({
    // Examples belong to their request: they are not dragged and take no drops.
    draggable: !readOnly && !row.deleted && renamingId !== row.id && row.kind !== 'example',
    onDragStart: (event: DragEvent) => {
      dragged.current = row.id;
      event.dataTransfer.setData(DRAG_TYPE, row.id);
      event.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (event: DragEvent) => {
      const draggedId = dragged.current;
      if (!draggedId || row.kind === 'example') return;
      const position = positionFor(event, row);
      if (!resolveDrop(session, draggedId, { kind: row.kind, id: row.id, position })) {
        setDrop(null);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (drop?.id !== row.id || drop.position !== position) setDrop({ id: row.id, position });
    },
    onDragLeave: () => setDrop((current) => (current?.id === row.id ? null : current)),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const draggedId = dragged.current ?? event.dataTransfer.getData(DRAG_TYPE);
      const command =
        draggedId && row.kind !== 'example'
          ? resolveDrop(session, draggedId, {
              kind: row.kind,
              id: row.id,
              position: positionFor(event, row),
            })
          : null;
      if (command) {
        edit(() => session.apply(command));
        if (command.type === 'moveItem') store.getState().setExpanded(command.parentId, true);
      }
      dragged.current = null;
      setDrop(null);
    },
    onDragEnd: () => {
      dragged.current = null;
      setDrop(null);
    },
  });

  return (
    <div data-testid="explorer" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <span
          data-testid="explorer-project-name"
          className="min-w-0 flex-1 truncate text-sm font-semibold"
        >
          {model?.name || 'Untitled project'}
        </span>
        {session.location.kind === 'browser-workspace' && (
          <WorkspaceBadge persisted={platform.projects.storagePersisted?.()} />
        )}
        <IconButton
          label="New collection"
          icon={<Plus size={14} />}
          data-testid="new-collection"
          disabled={readOnly}
          onClick={() => edit(() => newCollection(session, store))}
        />
        <IconButton
          label="Import Postman collection (Ctrl/⌘ O)"
          icon={<FileInput size={14} />}
          data-testid="explorer-import"
          disabled={readOnly}
          onClick={() => void pickImportFile()}
        />
        <IconButton
          label="Export project (.zip)"
          icon={<FileArchive size={14} />}
          data-testid="export-project-zip"
          onClick={() => void exportZip()}
        />
        <IconButton
          label="Refresh from disk"
          icon={<RefreshCw size={14} />}
          data-testid="explorer-refresh"
          onClick={() => void store.getState().refresh()}
        />
      </div>
      <label className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2 text-fg-muted">
        <Search size={12} aria-hidden />
        <input
          ref={filterRef}
          aria-label="Filter requests"
          data-testid="explorer-filter"
          value={filter}
          onChange={(event) => store.getState().setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') store.getState().setFilter('');
          }}
          placeholder="Filter by name or URL"
          className="h-6 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
        />
      </label>
      {readOnly && (
        <p
          data-testid="read-only-banner"
          className="border-b border-border bg-warn/10 px-3 py-1.5 text-xs text-fg"
        >
          This project was created by a newer Pigeon or its <code>pigeon.json</code> is unreadable.
          It is read-only.
        </p>
      )}
      {project.duplicateOf && (
        <div
          data-testid="duplicate-project-banner"
          className="flex flex-col gap-1 border-b border-border bg-warn/10 px-3 py-1.5 text-xs text-fg"
        >
          <span>
            Another folder ({locationLabel(project.duplicateOf)}) has the same project id, so this
            copy keeps its own local state. Give it a new id to tell them apart in Git too.
          </span>
          <button
            type="button"
            data-testid="regenerate-project-id"
            disabled={readOnly || session.changeState(PROJECT_ENTITY_ID) !== 'clean'}
            onClick={() =>
              edit(() => session.apply({ type: 'setProjectInfo', id: crypto.randomUUID() }))
            }
            className="self-start rounded border border-border bg-surface px-2 py-0.5 hover:bg-hover disabled:opacity-50"
          >
            Regenerate project id
          </button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          data-testid="explorer-error"
          className="border-b border-border bg-fail/10 px-3 py-1.5 text-xs text-fg"
        >
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-2 p-3 text-sm text-fg-muted">
          {filter ? 'Nothing matches the filter.' : 'This project has no collections yet.'}
          {!filter && !readOnly && (
            <button
              type="button"
              data-testid="explorer-empty-new-collection"
              onClick={() => edit(() => newCollection(session, store))}
              className="rounded border border-border px-2 py-1 text-fg hover:bg-hover"
            >
              New collection
            </button>
          )}
        </div>
      ) : (
        <div
          ref={scrollRef}
          role="tree"
          aria-label="Collections"
          // The focused row for screen readers (rows are virtualized: only when rendered).
          aria-activedescendant={
            selectedId && rows.some((row) => row.id === selectedId)
              ? treeItemId(selectedId)
              : undefined
          }
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-focus"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <RowMenu
                  key={row.id}
                  row={row}
                  readOnly={readOnly}
                  onNewRequest={() =>
                    edit(() =>
                      newRequest(session, store, row.kind === 'request' ? row.parentId : row.id),
                    )
                  }
                  onNewGraphql={() =>
                    edit(() =>
                      newRequest(
                        session,
                        store,
                        row.kind === 'request' ? row.parentId : row.id,
                        'graphql',
                      ),
                    )
                  }
                  onNewFolder={() =>
                    edit(() =>
                      newFolder(session, store, row.kind === 'request' ? row.parentId! : row.id),
                    )
                  }
                  onRename={() => store.getState().startRename(row.id)}
                  onDuplicate={() => edit(() => duplicateRow(row))}
                  onDelete={() => askDelete(row)}
                  onVariables={() => store.getState().openTab(row.id, { pin: true })}
                  onExport={() => setExporting(row.id)}
                  onCopyCurl={() => copyAsCurl(row.id)}
                  onRun={() => runner?.getState().openDialog(row.id)}
                  onBaseline={(pin) =>
                    edit(() => {
                      const requestId = row.parentId!;
                      const config = withBaseline(
                        session.findRequest(requestId)?.comparison,
                        pin ? { mode: 'example', exampleId: row.id } : { mode: 'auto' },
                      );
                      session.apply({
                        type: 'setComparisonConfig',
                        requestId,
                        config: isEmptyComparison(config) ? undefined : config,
                      });
                    })
                  }
                  onDiscard={() => {
                    const ids = requestIdsUnder(session, row.id);
                    void session.discard(row.id).then(() => {
                      // Tabs of requests that no longer exist close through the store.
                      for (const id of ids)
                        if (!session.findRequest(id)) disposeTabEditor(session, id);
                    });
                  }}
                >
                  <ExplorerRow
                    row={row}
                    selected={row.id === selectedId}
                    renaming={row.id === renamingId}
                    drop={drop?.id === row.id ? drop.position : null}
                    top={item.start}
                    onActivate={() => activate(row)}
                    onPin={() => activate(row, true)}
                    onRename={(name) => {
                      store.getState().cancelRename();
                      if (name.trim() !== '' && name !== row.name) {
                        edit(() =>
                          session.apply(
                            row.kind === 'example'
                              ? { type: 'renameExample', id: row.id, name }
                              : { type: 'renameItem', id: row.id, name },
                          ),
                        );
                      }
                    }}
                    onToggleExamples={() => store.getState().toggle(row.id)}
                    onCancelRename={() => store.getState().cancelRename()}
                    drag={dragHandlers(row)}
                  />
                </RowMenu>
              );
            })}
          </div>
        </div>
      )}
      <ExportDialog containerId={exporting} onClose={() => setExporting(null)} />
      <DeleteDialog
        row={deleting}
        unsavedTabs={
          deleting
            ? requestIdsUnder(session, deleting.id).filter((id) => session.isUnsaved(id)).length
            : 0
        }
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function RowMenu({
  row,
  readOnly,
  children,
  onNewRequest,
  onNewGraphql,
  onNewFolder,
  onRename,
  onDuplicate,
  onDelete,
  onDiscard,
  onVariables,
  onExport,
  onBaseline,
  onRun,
  onCopyCurl,
}: {
  row: TreeRow;
  readOnly: boolean;
  children: ReactNode;
  onNewRequest: () => void;
  onNewGraphql: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDiscard: () => void;
  onVariables: () => void;
  onExport: () => void;
  /** Examples: pin as the request's baseline, or back to auto (PIGN-037). */
  onBaseline: (pin: boolean) => void;
  /** Collections and folders: the run dialog for it (PIGN-038). */
  onRun: () => void;
  /** Requests: copy as a cURL command (PIGN-050). */
  onCopyCurl: () => void;
}) {
  const item = (label: string, onSelect: () => void, testId: string, shortcut?: string) => (
    <ContextMenu.Item
      data-testid={testId}
      disabled={readOnly}
      onSelect={onSelect}
      className="flex cursor-default items-center justify-between gap-6 rounded px-2 py-1 outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover"
    >
      {label}
      {shortcut && <span className="text-xs text-fg-muted">{shortcut}</span>}
    </ContextMenu.Item>
  );
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          // Actions move focus themselves (rename input, the new request's URL).
          onCloseAutoFocus={(event) => event.preventDefault()}
          data-testid="explorer-menu"
          className="z-50 min-w-44 rounded-md border border-border bg-surface-raised p-1 text-sm text-fg shadow-lg"
        >
          {row.kind === 'example' && (
            <>
              {item('Pin as baseline', () => onBaseline(true), 'menu-pin-baseline')}
              {item('Use auto baseline', () => onBaseline(false), 'menu-auto-baseline')}
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              {item('Rename', onRename, 'menu-rename', 'F2')}
              {item('Duplicate', onDuplicate, 'menu-duplicate', 'Ctrl/⌘ D')}
              {item('Delete', onDelete, 'menu-delete', 'Del')}
            </>
          )}
          {!row.deleted && row.kind !== 'example' && (
            <>
              {item('New request', onNewRequest, 'menu-new-request', 'Ctrl/⌘ N')}
              {item('New GraphQL request', onNewGraphql, 'menu-new-graphql')}
              {item('New folder', onNewFolder, 'menu-new-folder')}
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              {row.kind !== 'request' && !row.broken && (
                <ContextMenu.Item
                  data-testid="menu-run"
                  onSelect={onRun}
                  className="flex cursor-default items-center rounded px-2 py-1 outline-none select-none data-[highlighted]:bg-hover"
                >
                  Run {row.kind === 'folder' ? 'folder' : 'collection'}…
                </ContextMenu.Item>
              )}
              {row.kind === 'request' && !row.broken && (
                <ContextMenu.Item
                  data-testid="menu-copy-curl"
                  onSelect={onCopyCurl}
                  className="flex cursor-default items-center rounded px-2 py-1 outline-none select-none data-[highlighted]:bg-hover"
                >
                  Copy as cURL
                </ContextMenu.Item>
              )}
              {row.kind !== 'request' && item('Variables', onVariables, 'menu-variables')}
              {row.kind !== 'request' && !row.broken && (
                <ContextMenu.Item
                  data-testid="menu-export"
                  onSelect={onExport}
                  className="flex cursor-default items-center rounded px-2 py-1 outline-none select-none data-[highlighted]:bg-hover"
                >
                  Export as Postman collection…
                </ContextMenu.Item>
              )}
              {item('Rename', onRename, 'menu-rename', 'F2')}
              {!row.broken && item('Duplicate', onDuplicate, 'menu-duplicate', 'Ctrl/⌘ D')}
              {item('Delete', onDelete, 'menu-delete', 'Del')}
            </>
          )}
          {(row.change || row.unsaved) && (
            <>
              {!row.deleted && <ContextMenu.Separator className="my-1 h-px bg-border" />}
              {item(
                row.deleted ? 'Restore (discard delete)' : 'Discard changes',
                onDiscard,
                'menu-discard',
              )}
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function DeleteDialog({
  row,
  unsavedTabs,
  onCancel,
  onConfirm,
}: {
  row: TreeRow | null;
  unsavedTabs: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const what =
    row?.kind === 'example'
      ? 'example'
      : row?.kind === 'request'
        ? 'request and its examples'
        : row?.kind === 'folder'
          ? 'folder and everything in it'
          : 'collection and everything in it';
  return (
    <Dialog.Root open={row !== null} onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="delete-dialog"
          className="fixed top-1/2 left-1/2 w-[min(26rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface-raised p-4 text-sm text-fg shadow-xl"
        >
          <Dialog.Title className="text-base font-semibold">Delete “{row?.name}”?</Dialog.Title>
          <Dialog.Description className="mt-2 text-fg-muted">
            This deletes the {what}. Files change only when you save it for commit.
            {unsavedTabs > 0 &&
              ` ${unsavedTabs} open request${unsavedTabs === 1 ? ' has' : 's have'} unsaved changes that will be discarded.`}
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
              data-testid="delete-confirm"
              onClick={onConfirm}
              className="h-8 rounded bg-fail px-3 font-semibold text-white hover:opacity-90"
            >
              Delete
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface DragHandlers {
  draggable: boolean;
  onDragStart: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent) => void;
  onDragEnd: () => void;
}

function ExplorerRow({
  row,
  selected,
  renaming,
  drop,
  top,
  onActivate,
  onPin,
  onRename,
  onCancelRename,
  onToggleExamples,
  drag,
  ...triggerProps
}: {
  row: TreeRow;
  selected: boolean;
  renaming: boolean;
  drop: DropPosition | null;
  top: number;
  onActivate: () => void;
  /** Double click: a pinned tab. */
  onPin: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  /** Requests: shows or hides their examples. */
  onToggleExamples: () => void;
  drag: DragHandlers;
}) {
  const Chevron = row.expanded ? ChevronDown : ChevronRight;
  const dropClass =
    drop === 'before'
      ? 'shadow-[inset_0_2px_0_var(--color-accent)]'
      : drop === 'after'
        ? 'shadow-[inset_0_-2px_0_var(--color-accent)]'
        : drop === 'inside'
          ? 'bg-accent/15 ring-1 ring-accent ring-inset'
          : '';
  return (
    <div
      {...triggerProps}
      {...drag}
      role="treeitem"
      id={treeItemId(row.id)}
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={
        row.kind === 'example' || (row.kind === 'request' && !row.hasChildren)
          ? undefined
          : row.expanded
      }
      data-testid="explorer-item"
      data-id={row.id}
      data-kind={row.kind}
      data-broken={row.broken || undefined}
      data-unsaved={row.unsaved || undefined}
      data-change={row.change}
      data-drop={drop ?? undefined}
      title={row.problem ? `${row.path}: ${row.problem}` : row.name}
      onClick={onActivate}
      onDoubleClick={() => (row.kind === 'request' || row.kind === 'example') && onPin()}
      style={{
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        height: ROW_HEIGHT,
        paddingLeft: 8 + row.depth * 14,
      }}
      className={`flex cursor-default items-center gap-1.5 pr-2 text-sm select-none ${
        selected ? 'bg-hover text-fg' : 'text-fg hover:bg-hover/60'
      } ${dropClass}`}
    >
      {row.kind === 'example' ? (
        <>
          <Bookmark size={12} className="ml-4 shrink-0 text-fg-muted" aria-hidden />
          {row.baseline && (
            <span
              data-testid="explorer-baseline"
              title="Baseline"
              aria-label="(baseline)"
              className="shrink-0 text-warn"
            >
              ★
            </span>
          )}
          <span
            data-testid="explorer-example-code"
            className={`shrink-0 font-mono text-[10px] font-bold ${statusClass(row.code ?? 0)}`}
          >
            {row.code}
          </span>
        </>
      ) : row.kind === 'request' ? (
        <span
          data-testid="explorer-method"
          className={`w-9 shrink-0 text-right font-mono text-[10px] font-bold ${methodColorClass(row.method ?? '')}`}
        >
          {methodLabel(row.method ?? '')}
        </span>
      ) : (
        <>
          <Chevron
            size={14}
            className={`shrink-0 text-fg-muted ${row.hasChildren ? '' : 'invisible'}`}
            aria-hidden
          />
          {row.kind === 'collection' ? (
            <Library size={14} className="shrink-0 text-fg-muted" aria-hidden />
          ) : (
            <Folder size={14} className="shrink-0 text-fg-muted" aria-hidden />
          )}
        </>
      )}
      {renaming ? (
        <RenameInput name={row.name} onDone={onRename} onCancel={onCancelRename} />
      ) : (
        <span
          data-testid="explorer-item-name"
          className={`min-w-0 flex-1 truncate ${row.kind === 'collection' ? 'font-semibold' : ''} ${row.unsaved ? 'italic' : ''} ${row.deleted ? 'text-fg-muted line-through' : ''}`}
        >
          {row.name}
        </span>
      )}
      {row.scripts && !renaming && (
        <span
          data-testid="explorer-scripts"
          title="Has scripts (kept, not run yet)"
          aria-label="(has scripts)"
          className="shrink-0 rounded bg-hover px-1 font-mono text-[9px] leading-4 font-bold text-fg-muted"
        >
          JS
        </span>
      )}
      {row.exampleCount !== undefined && !renaming && (
        <button
          type="button"
          data-testid="explorer-examples-toggle"
          aria-label={`${row.expanded ? 'Hide' : 'Show'} ${row.exampleCount} example${row.exampleCount === 1 ? '' : 's'}`}
          title={`${row.exampleCount} example${row.exampleCount === 1 ? '' : 's'}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExamples();
          }}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-hover px-1.5 text-[10px] leading-4 text-fg-muted hover:text-fg"
        >
          <Bookmark size={9} aria-hidden />
          {row.exampleCount}
        </button>
      )}
      {row.change && !row.unsaved && !row.conflict && !renaming && (
        <span
          data-testid="explorer-badge"
          title={
            row.change === 'created'
              ? 'Added (saved locally, not in the files yet)'
              : row.change === 'deleted'
                ? 'Deleted (saved locally; the file still exists)'
                : 'Modified (saved locally, not in the files yet)'
          }
          className={`shrink-0 font-mono text-[10px] font-bold ${
            row.change === 'created'
              ? 'text-pass'
              : row.change === 'deleted'
                ? 'text-fail'
                : 'text-warn'
          }`}
        >
          {row.change === 'created' ? 'A' : row.change === 'deleted' ? 'D' : 'M'}
        </span>
      )}
      {row.conflict && (
        <span
          data-testid="explorer-conflict"
          title="Conflict: the file changed on disk since you saved your changes"
          aria-label="(conflict)"
          className="shrink-0 font-mono text-[10px] font-bold text-fail"
        >
          !
        </span>
      )}
      {!renaming && <GitDot row={row} />}
      {row.unsaved && !renaming && (
        <span
          data-testid="explorer-unsaved"
          aria-label="(unsaved)"
          className="size-1.5 shrink-0 rounded-full bg-fg-muted"
        />
      )}
      {row.broken && (
        <span
          data-testid="explorer-broken"
          className="shrink-0 text-warn"
          aria-label={`Broken file: ${row.problem ?? ''}`}
        >
          <AlertTriangle size={14} aria-hidden />
        </span>
      )}
    </div>
  );
}

function RenameInput({
  name,
  onDone,
  onCancel,
}: {
  name: string;
  onDone: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onDone(value);
    else onCancel();
  };
  return (
    <input
      aria-label="Name"
      data-testid="explorer-rename-input"
      autoFocus
      value={value}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(true);
        if (event.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
      className="h-5 min-w-0 flex-1 rounded-sm border border-accent bg-bg px-1 text-sm text-fg outline-none"
    />
  );
}

function WorkspaceBadge({ persisted }: { persisted: boolean | undefined }) {
  const note =
    persisted === true
      ? 'Stored in this browser (persistent storage granted).'
      : persisted === false
        ? 'Stored in this browser; it may clear it under storage pressure. Export a zip to keep a copy.'
        : 'Stored in this browser. Export a zip to keep a copy.';
  const openHelp = useAppStore((s) => s.openHelp);
  return (
    <button
      type="button"
      data-testid="workspace-badge"
      data-section="storage"
      data-persisted={persisted === undefined ? 'unknown' : String(persisted)}
      title={`${note} Click to learn more.`}
      aria-label={note}
      onClick={() => openHelp('storage')}
      className="inline-flex shrink-0 cursor-pointer items-center rounded p-0.5 text-fg-muted hover:bg-hover"
    >
      <Database size={14} aria-hidden />
    </button>
  );
}

/** DOM id of a tree row (ids may contain characters an id selector would need escaped). */
function treeItemId(id: string): string {
  return `explorer-row-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}
