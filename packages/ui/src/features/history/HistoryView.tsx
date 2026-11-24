/**
 * History view (PIGN-051): this project's sends, newest first, grouped by day; filter by URL /
 * name text, method and status class. Opening an entry shows it read-only with "Open as new
 * request" and "Restore into request". History stays on this machine (never in project files).
 */

import type { HistoryFilter, HistorySummary, ProjectHistory } from '@pigeon/core';
import { filterHistory, groupHistoryByDay } from '@pigeon/core';
import { useEffect, useId, useMemo, useState } from 'react';

import { usePreferences, usePreferencesStore } from '../../app/preferences';
import { Button, Checkbox, EmptyState, Input, Select } from '../../components/ui';
import { useAppStore } from '../../stores/AppStoreProvider';
import type { OpenProject } from '../../stores/app-store';
import { methodColorClass } from '../request-editor/methods';
import { HistoryEntryDialog } from './HistoryEntryDialog';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function HistoryView() {
  const project = useAppStore((s) => s.project);
  if (!project) {
    return <EmptyState title="No project open" />;
  }
  if (!project.session.history) {
    return (
      <p data-testid="history-unavailable" className="p-4 text-sm text-fg-muted">
        History is not kept for this project (it is read-only or has no local state).
      </p>
    );
  }
  return <ProjectHistoryView key={project.session.localKey} project={project} />;
}

function useSummaries(history: ProjectHistory): HistorySummary[] | null {
  const [summaries, setSummaries] = useState<HistorySummary[] | null>(null);
  useEffect(() => {
    let current = true;
    const load = () =>
      void history.list().then(
        (list) => current && setSummaries(list),
        () => current && setSummaries([]),
      );
    load();
    const unsubscribe = history.subscribe(load);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [history]);
  return summaries;
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function statusClass(summary: HistorySummary): string {
  if (summary.status === undefined) return 'text-fail';
  if (summary.status >= 400) return 'text-fail';
  if (summary.status >= 300) return 'text-warn';
  return 'text-pass';
}

function ProjectHistoryView({ project }: { project: OpenProject }) {
  const history = project.session.history!;
  const summaries = useSummaries(history);
  const recording = usePreferences((s) => s.recordHistory);
  const preferences = usePreferencesStore();
  const [filter, setFilter] = useState<HistoryFilter>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const id = useId();

  const groups = useMemo(
    () => groupHistoryByDay(filterHistory(summaries ?? [], filter)),
    [summaries, filter],
  );

  return (
    <div data-testid="history-view" className="flex min-h-0 flex-1 flex-col text-sm">
      <div className="flex flex-col gap-2 border-b border-border/60 px-3 pt-1 pb-3">
        <Input
          size="sm"
          type="search"
          aria-label="Filter history"
          data-testid="history-filter"
          placeholder="Filter by URL or name"
          value={filter.text ?? ''}
          onChange={(event) => setFilter({ ...filter, text: event.target.value })}
        />
        <div className="flex gap-2">
          <Select
            size="sm"
            aria-label="Method"
            data-testid="history-method"
            value={filter.method ?? ''}
            onChange={(event) => {
              const { method: _m, ...rest } = filter;
              setFilter(event.target.value ? { ...rest, method: event.target.value } : rest);
            }}
            className="flex-1"
          >
            <option value="">Any method</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Select
            size="sm"
            aria-label="Status"
            data-testid="history-status"
            value={filter.status ?? ''}
            onChange={(event) => {
              const { status: _s, ...rest } = filter;
              const value = event.target.value as HistoryFilter['status'] | '';
              setFilter(value ? { ...rest, status: value } : rest);
            }}
            className="flex-1"
          >
            <option value="">Any status</option>
            <option value="2xx">2xx</option>
            <option value="3xx">3xx</option>
            <option value="4xx">4xx</option>
            <option value="5xx">5xx</option>
            <option value="error">No response</option>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <label htmlFor={`${id}-record`} className="flex items-center gap-2 text-fg-muted">
            <Checkbox
              id={`${id}-record`}
              data-testid="history-record"
              checked={recording}
              onChange={(event) => preferences?.getState().setRecordHistory(event.target.checked)}
            />
            Record sends
          </label>
          {confirmClear ? (
            <span className="flex items-center gap-1.5">
              <span className="text-fg-muted">Clear all?</span>
              <Button
                variant="danger"
                size="xs"
                data-testid="history-clear-confirm"
                onClick={() => {
                  setConfirmClear(false);
                  void history.clear();
                }}
              >
                Clear
              </Button>
              <Button size="xs" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              size="xs"
              data-testid="history-clear"
              disabled={!summaries || summaries.length === 0}
              onClick={() => setConfirmClear(true)}
            >
              Clear history
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="history-list">
        {summaries === null ? null : summaries.length === 0 ? (
          <EmptyState
            data-testid="history-empty"
            title="No requests sent yet."
            description="Sends of this project's requests appear here; they stay on this machine and are never written to the project folder."
          />
        ) : groups.length === 0 ? (
          <p className="p-4 text-xs text-fg-muted">No entries match the filter.</p>
        ) : (
          groups.map((group) => (
            <section key={group.day} aria-label={dayLabel(group.day)}>
              <h3
                data-testid="history-day"
                className="sticky top-0 z-10 bg-surface px-3.5 pt-3 pb-1 text-xs font-medium text-fg-muted"
              >
                {dayLabel(group.day)}
              </h3>
              <ul className="flex flex-col gap-px px-1.5">
                {group.entries.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      data-testid="history-item"
                      onClick={() => setOpenId(entry.id)}
                      title={entry.url}
                      className="flex w-full min-w-0 flex-col gap-0.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-hover"
                    >
                      <span className="flex min-w-0 items-baseline gap-2 font-mono text-xs">
                        <span
                          className={`w-12 shrink-0 text-xs font-semibold ${methodColorClass(entry.method)}`}
                        >
                          {entry.method}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-fg">{entry.url}</span>
                      </span>
                      <span className="flex gap-2 pl-14 text-xs text-fg-muted">
                        <span data-testid="history-item-status" className={statusClass(entry)}>
                          {entry.status ?? 'Error'}
                        </span>
                        {entry.timeMs !== undefined && <span>{Math.round(entry.timeMs)} ms</span>}
                        <span>{new Date(entry.at).toLocaleTimeString()}</span>
                        {entry.requestName && (
                          <span className="min-w-0 truncate">{entry.requestName}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <HistoryEntryDialog project={project} entryId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
