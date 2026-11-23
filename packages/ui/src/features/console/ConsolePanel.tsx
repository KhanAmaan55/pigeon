/**
 * The script Console (PIGN-043): `console.*` output and script errors of the open project, oldest
 * first (kept in memory, at most `CONSOLE_LIMIT`). Secret values are already masked by core.
 */

import type { ConsoleEntry } from '@pigeon/core';
import { CircleX, Info, Terminal, TriangleAlert } from 'lucide-react';

import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';

const NO_ENTRIES: readonly ConsoleEntry[] = [];

const LEVEL_ICON = {
  log: null,
  info: <Info size={12} className="text-info" aria-hidden />,
  warn: <TriangleAlert size={12} className="text-warn" aria-hidden />,
  error: <CircleX size={12} className="text-fail" aria-hidden />,
} as const;

/** The project's console entries (none without a project). */
export function useConsoleEntries(): readonly ConsoleEntry[] {
  return useProjectState((s) => s.console, NO_ENTRIES);
}

export function ConsolePanel({ limit }: { limit?: number }) {
  const project = useAppStore((s) => s.project);
  const all = useConsoleEntries();
  const entries = limit ? all.slice(-limit) : all;
  return (
    <div data-testid="console-panel" className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1 text-fg-muted">
        <Terminal size={12} aria-hidden />
        <span>Script console</span>
        <span className="flex-1" />
        {all.length > 0 && (
          <button
            type="button"
            data-testid="console-clear"
            onClick={() => project?.store.getState().clearConsole()}
            className="rounded px-1.5 hover:bg-hover hover:text-fg"
          >
            Clear
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="p-3 text-fg-muted">
          No output yet. Pre-request scripts write here with console.log().
        </p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto font-mono" aria-label="Console output">
          {entries.map((entry, index) => (
            <li
              key={`${entry.at}-${index}`}
              data-testid="console-entry"
              data-level={entry.level}
              className={`flex items-start gap-2 border-b border-border/60 px-3 py-0.5 ${
                entry.level === 'error' ? 'bg-fail/5' : entry.level === 'warn' ? 'bg-warn/5' : ''
              }`}
            >
              <span className="mt-0.5 w-3 shrink-0">{LEVEL_ICON[entry.level]}</span>
              <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{entry.message}</span>
              <span className="shrink-0 font-sans text-fg-muted">{entry.source}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
