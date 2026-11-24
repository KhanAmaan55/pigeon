/**
 * The command palette (Cmd/Ctrl+K, Cmd/Ctrl+Shift+P) and Quick open (Cmd/Ctrl+P), PIGN-042: one
 * dialog with a fuzzy-filtered list. Commands come from the registry (only those with a handler
 * now); Quick open lists the active project's requests, examples and environments.
 */

import type { ProjectItem } from '@pigeon/core';
import { Bookmark, Search, Variable } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import { usePlatform } from '../../app/PlatformProvider';
import { Dialog, DialogContent, DialogTitle, Kbd } from '../../components/ui';
import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';
import { methodLabel } from '../explorer/tree';
import { methodColorClass } from '../request-editor/methods';
import type { CommandId } from './commands';
import { bindingLabel, COMMANDS, fuzzyScore } from './commands';
import { useCommand, useCommandRegistry } from './CommandsProvider';

/** Rows rendered at most (the filter runs over everything). */
export const MAX_RESULTS = 50;

export interface QuickOpenItem {
  id: string;
  kind: 'request' | 'example' | 'environment';
  name: string;
  /** Collection / folders (and the request, for examples). */
  path: string;
  method?: string;
  /** Lower-cased `path / name`, matched by the filter. */
  search: string;
}

/** Everything Quick open can open in a project model, in explorer order. */
export function quickOpenItems(model: {
  collections: ReadonlyArray<{ name: string; children: readonly ProjectItem[] }>;
  environments: ReadonlyArray<{ id: string; name: string; broken?: boolean }>;
}): QuickOpenItem[] {
  const items: QuickOpenItem[] = [];
  const add = (item: Omit<QuickOpenItem, 'search'>) =>
    items.push({ ...item, search: `${item.path} / ${item.name}` });
  const visit = (children: readonly ProjectItem[], path: string) => {
    for (const child of children) {
      if (child.kind === 'folder') {
        visit(child.children, `${path} / ${child.name}`);
        continue;
      }
      add({ id: child.id, kind: 'request', name: child.name, path, method: child.method });
      for (const example of child.examples) {
        add({
          id: example.id,
          kind: 'example',
          name: example.name,
          path: `${path} / ${child.name}`,
        });
      }
    }
  };
  for (const collection of model.collections) visit(collection.children, collection.name);
  for (const environment of model.environments) {
    if (!environment.broken) {
      add({
        id: environment.id,
        kind: 'environment',
        name: environment.name,
        path: 'Environments',
      });
    }
  }
  return items;
}

/** The best `limit` matches of `query` (all items in order for an empty query). */
export function filterItems<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => string,
  limit = MAX_RESULTS,
): T[] {
  if (query.trim() === '') return items.slice(0, limit);
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const score = fuzzyScore(query, text(item));
    if (score >= 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.item);
}

type Mode = 'commands' | 'files';

export function CommandPalette() {
  const [mode, setMode] = useState<Mode | null>(null);
  const hasProject = useAppStore((s) => s.project !== null);
  useCommand('palette.open', () => setMode('commands'));
  useCommand('quickOpen.open', hasProject ? () => setMode('files') : undefined);
  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && setMode(null)}>
      {/* Pinned near the top (not centred) so the list grows downwards as results change. */}
      <DialogContent
        width="lg"
        flush
        data-testid="command-palette"
        data-mode={mode ?? undefined}
        aria-describedby={undefined}
        className="top-[12vh]! max-h-[70vh]! translate-y-0! overflow-hidden"
      >
        <DialogTitle className="sr-only">
          {mode === 'files' ? 'Quick open' : 'Command palette'}
        </DialogTitle>
        {mode === 'commands' && <Commands onDone={() => setMode(null)} />}
        {mode === 'files' && <QuickOpen onDone={() => setMode(null)} />}
        <div
          aria-hidden
          className="flex shrink-0 items-center gap-4 border-t border-border bg-surface px-4 py-2 text-xs text-fg-muted"
        >
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span className="ml-0.5">Navigate</span>
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            <span className="ml-0.5">{mode === 'files' ? 'Open' : 'Run'}</span>
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd>
            <span className="ml-0.5">Close</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Commands({ onDone }: { onDone: () => void }) {
  const registry = useCommandRegistry();
  const mac = usePlatform().os === 'macos';
  const available = useMemo(
    () => COMMANDS.filter((c) => c.id !== 'palette.open' && registry?.has(c.id)),
    [registry],
  );
  return (
    <FilterList
      placeholder="Type a command"
      items={available}
      text={(c) => `${c.category}: ${c.title}`}
      itemKey={(c) => c.id}
      render={(c) => (
        <>
          <span className="text-fg-muted">{c.category}:</span>
          <span className="min-w-0 flex-1 truncate">{c.title}</span>
          {c.bindings[0] && <Kbd>{bindingLabel(c.bindings[0], mac)}</Kbd>}
        </>
      )}
      testId="palette-command"
      onSelect={(c) => {
        onDone();
        // After the dialog has closed and returned focus.
        setTimeout(() => registry?.run(c.id as CommandId), 0);
      }}
    />
  );
}

function QuickOpen({ onDone }: { onDone: () => void }) {
  const project = useAppStore((s) => s.project);
  const model = useProjectState((s) => s.model, null);
  const items = useMemo(() => (model ? quickOpenItems(model) : []), [model]);
  return (
    <FilterList
      placeholder="Go to a request, example or environment"
      items={items}
      text={(item) => item.search}
      itemKey={(item) => item.id}
      render={(item) => (
        <>
          <span className="flex w-10 shrink-0 justify-end">
            {item.kind === 'request' ? (
              <span
                className={`font-mono text-[10px] font-bold ${methodColorClass(item.method ?? '')}`}
              >
                {methodLabel(item.method ?? '')}
              </span>
            ) : item.kind === 'example' ? (
              <Bookmark size={12} className="text-fg-muted" aria-hidden />
            ) : (
              <Variable size={12} className="text-fg-muted" aria-hidden />
            )}
          </span>
          <span className="truncate">{item.name}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{item.path}</span>
        </>
      )}
      testId="quick-open-item"
      onSelect={(item) => {
        onDone();
        project?.store.getState().openTab(item.id, { pin: true });
      }}
    />
  );
}

function FilterList<T>({
  placeholder,
  items,
  text,
  itemKey,
  render,
  testId,
  onSelect,
}: {
  placeholder: string;
  items: readonly T[];
  text: (item: T) => string;
  itemKey: (item: T) => string;
  render: (item: T) => ReactNode;
  testId: string;
  onSelect: (item: T) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => filterItems(items, query, text), [items, query, text]);
  const current = Math.min(active, Math.max(0, results.length - 1));
  return (
    <>
      <div className="flex h-13 shrink-0 items-center gap-3 border-b border-border px-4">
        <Search aria-hidden className="size-4 shrink-0 text-fg-muted" />
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={
            results[current] ? `palette-${itemKey(results[current])}` : undefined
          }
          data-testid="palette-input"
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive(Math.min(current + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(Math.max(current - 1, 0));
            } else if (event.key === 'Enter' && results[current]) {
              event.preventDefault();
              onSelect(results[current]);
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-muted"
        />
      </div>
      <ul id="palette-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {results.length === 0 && (
          <li className="px-2.5 py-6 text-center text-fg-muted">No matches</li>
        )}
        {results.map((item, index) => (
          <li
            key={itemKey(item)}
            id={`palette-${itemKey(item)}`}
            role="option"
            aria-selected={index === current}
            data-testid={testId}
            onMouseMove={() => setActive(index)}
            onClick={() => onSelect(item)}
            className="group flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px] aria-selected:bg-hover [&[aria-selected=true]_.text-fg-muted]:text-fg"
          >
            {render(item)}
          </li>
        ))}
      </ul>
    </>
  );
}
