import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Database,
  FileArchive,
  Folder,
  Library,
  RefreshCw,
} from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useMemo, useRef } from 'react';

import { usePlatform } from '../../app/PlatformProvider';
import { IconButton } from '../../components/IconButton';
import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';
import { methodColorClass } from '../request-editor/methods';
import type { TreeRow } from './tree';
import { flattenTree, methodLabel } from './tree';

const ROW_HEIGHT = 26;
const NO_ROWS: TreeRow[] = [];
const FALLBACK_RECT = { width: 280, height: 800 };

/** Collection explorer (docs/ui-ux.md §3.2): a virtualized tree of the open project. */
export function Explorer() {
  const project = useAppStore((s) => s.project);
  const exportZip = useAppStore((s) => s.exportProjectZip);
  const platform = usePlatform();
  const model = useProjectState((s) => s.model, null);
  const problems = useProjectState((s) => s.problems, null);
  const expanded = useProjectState((s) => s.expanded, null);
  const selectedId = useProjectState((s) => s.selectedId, null);
  const readOnly = useProjectState((s) => s.readOnly, false);
  const rows = useMemo(
    () => (model && expanded ? flattenTree(model, expanded, problems ?? []) : NO_ROWS),
    [model, expanded, problems],
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

  if (!project) return null;
  const { store } = project;
  /** Single click: requests open in the preview tab; containers expand/collapse. */
  const activate = (row: TreeRow, pin = false) => {
    const state = store.getState();
    state.select(row.id);
    if (row.kind === 'request') state.openTab(row.id, { pin });
    else state.toggle(row.id);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const index = rows.findIndex((row) => row.id === selectedId);
    const row = rows[index];
    const state = store.getState();
    const go = (next: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, next))];
      if (target) {
        state.select(target.id);
        virtualizer.scrollToIndex(rows.indexOf(target));
      }
    };
    switch (event.key) {
      case 'ArrowDown':
        go(index + 1);
        break;
      case 'ArrowUp':
        go(index - 1);
        break;
      case 'ArrowRight':
        if (row?.hasChildren && !row.expanded) state.setExpanded(row.id, true);
        else go(index + 1);
        break;
      case 'ArrowLeft':
        if (row?.expanded) state.setExpanded(row.id, false);
        else if (row?.parentId) go(rows.findIndex((r) => r.id === row.parentId));
        break;
      case 'Enter':
        if (row) activate(row);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div data-testid="explorer" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <span
          data-testid="explorer-project-name"
          className="min-w-0 flex-1 truncate text-sm font-semibold"
        >
          {model?.name || 'Untitled project'}
        </span>
        {project.session.location.kind === 'browser-workspace' && (
          <WorkspaceBadge persisted={platform.projects.storagePersisted?.()} />
        )}
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
      {readOnly && (
        <p
          data-testid="read-only-banner"
          className="border-b border-border bg-warn/10 px-3 py-1.5 text-xs text-fg"
        >
          This project was created by a newer Pigeon or its <code>pigeon.json</code> is unreadable.
          It is read-only.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="p-3 text-sm text-fg-muted">This project has no collections yet.</p>
      ) : (
        <div
          ref={scrollRef}
          role="tree"
          aria-label="Collections"
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-focus"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <ExplorerRow
                  key={row.id}
                  row={row}
                  selected={row.id === selectedId}
                  top={item.start}
                  onActivate={() => activate(row)}
                  onPin={() => activate(row, true)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ExplorerRow({
  row,
  selected,
  top,
  onActivate,
  onPin,
}: {
  row: TreeRow;
  selected: boolean;
  top: number;
  onActivate: () => void;
  /** Double click: a pinned tab. */
  onPin: () => void;
}) {
  const Chevron = row.expanded ? ChevronDown : ChevronRight;
  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={row.kind === 'request' ? undefined : row.expanded}
      data-testid="explorer-item"
      data-kind={row.kind}
      data-broken={row.broken || undefined}
      title={row.problem ? `${row.path}: ${row.problem}` : row.name}
      onClick={onActivate}
      onDoubleClick={() => row.kind === 'request' && onPin()}
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
      }`}
    >
      {row.kind === 'request' ? (
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
      <span
        data-testid="explorer-item-name"
        className={`min-w-0 flex-1 truncate ${row.kind === 'collection' ? 'font-semibold' : ''}`}
      >
        {row.name}
      </span>
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

function WorkspaceBadge({ persisted }: { persisted: boolean | undefined }) {
  const note =
    persisted === true
      ? 'Stored in this browser (persistent storage granted).'
      : persisted === false
        ? 'Stored in this browser; it may clear it under storage pressure. Export a zip to keep a copy.'
        : 'Stored in this browser. Export a zip to keep a copy.';
  return (
    <span
      data-testid="workspace-badge"
      data-persisted={persisted === undefined ? 'unknown' : String(persisted)}
      title={note}
      aria-label={note}
      className="inline-flex shrink-0 items-center text-fg-muted"
    >
      <Database size={14} aria-hidden />
    </span>
  );
}
