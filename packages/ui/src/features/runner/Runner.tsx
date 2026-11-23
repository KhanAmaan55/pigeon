/**
 * Runner UI (docs/ui-ux.md §3.10, PIGN-038): the run dialog, the Runner tab (live run and
 * report: per-request rows, totals, accept selected as baselines, export JSON) and the Runner
 * sidebar view (new run, recent reports).
 */

import type {
  Collection,
  Folder,
  ProjectItem,
  RunEntry,
  RunOutcome,
  RunReport,
} from '@pigeon/core';
import {
  CircleCheck,
  CircleMinus,
  CircleSlash,
  CircleX,
  Download,
  LoaderCircle,
  Play,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { memo, useCallback, useId, useState } from 'react';
import { useStore } from 'zustand';

import { usePlatform } from '../../app/PlatformProvider';
import { useVolatileHeaders } from '../../app/preferences';
import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';
import { methodLabel } from '../explorer/tree';
import { methodColorClass } from '../request-editor/methods';
import { useEditorEnvironment } from '../request-editor/ScratchRequestProvider';
import type { LiveRun, RunnerState, RunnerStore } from './runner-store';
import { getRunner, reportFileName, reportText } from './runner-store';

/** The open project's runner (`null` without a project). */
export function useRunner(): RunnerStore | null {
  const project = useAppStore((s) => s.project);
  const platform = usePlatform();
  const env = useEditorEnvironment();
  return project ? getRunner(project.session, project.store, platform, env) : null;
}

const noRunner = {
  getState: () => null,
  getInitialState: () => null,
  subscribe: () => () => {},
  setState: () => {},
} as unknown as RunnerStore;

function useRunnerState<T>(
  runner: RunnerStore | null,
  selector: (s: RunnerState) => T,
  fallback: T,
) {
  return useStore(runner ?? noRunner, (state: RunnerState | null) =>
    state === null ? fallback : selector(state),
  );
}

const OUTCOME_VIEW: Record<RunOutcome, { label: string; icon: ReactNode; className: string }> = {
  pass: { label: 'Pass', icon: <CircleCheck size={12} />, className: 'text-pass' },
  warn: { label: 'Warn', icon: <TriangleAlert size={12} />, className: 'text-warn' },
  fail: { label: 'Fail', icon: <CircleX size={12} />, className: 'text-fail' },
  'no-baseline': {
    label: 'No baseline',
    icon: <CircleMinus size={12} />,
    className: 'text-fg-muted',
  },
  error: { label: 'Error', icon: <CircleX size={12} />, className: 'text-fail' },
  skipped: { label: 'Skipped', icon: <CircleSlash size={12} />, className: 'text-fg-muted' },
};
const OUTCOME_ORDER: RunOutcome[] = ['pass', 'warn', 'fail', 'no-baseline', 'error', 'skipped'];

function OutcomeLabel({ outcome }: { outcome: RunOutcome }) {
  const view = OUTCOME_VIEW[outcome];
  return (
    <span
      data-testid="run-outcome"
      data-outcome={outcome}
      className={`inline-flex items-center gap-1 text-xs font-semibold ${view.className}`}
    >
      <span aria-hidden className="inline-flex">
        {view.icon}
      </span>
      {view.label}
    </span>
  );
}

/** Collections and their folders, indented, for the scope picker. */
function scopeOptions(collections: readonly Collection[]): Array<{ id: string; label: string }> {
  const options: Array<{ id: string; label: string }> = [];
  const visit = (container: Collection | Folder, depth: number) => {
    options.push({ id: container.id, label: `${'  '.repeat(depth)}${container.name}` });
    for (const child of container.children as readonly ProjectItem[]) {
      if (child.kind === 'folder') visit(child, depth + 1);
    }
  };
  for (const collection of collections) visit(collection, 0);
  return options;
}

/** Scope, environment, stop on first failure, only requests with baselines. */
export function RunDialog() {
  const runner = useRunner();
  const dialog = useRunnerState(runner, (s) => s.dialog, null);
  return (
    <Dialog.Root
      open={dialog !== null}
      onOpenChange={(open) => !open && runner?.getState().closeDialog()}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="run-dialog"
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 w-[min(28rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface-raised p-4 text-sm text-fg shadow-xl"
        >
          {dialog && runner && <RunForm runner={runner} initialScopeId={dialog.scopeId} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RunForm({
  runner,
  initialScopeId,
}: {
  runner: RunnerStore;
  initialScopeId: string | null;
}) {
  const model = useProjectState((s) => s.model, null);
  const selectedEnvironmentId = useProjectState((s) => s.selectedEnvironmentId, null);
  const options = scopeOptions(model?.collections ?? []);
  const environments = model?.environments ?? [];
  const id = useId();
  const [scopeId, setScopeId] = useState(initialScopeId ?? options[0]?.id ?? '');
  const [environmentId, setEnvironmentId] = useState(selectedEnvironmentId ?? '');
  const [stopOnFail, setStopOnFail] = useState(false);
  const [onlyWithBaseline, setOnlyWithBaseline] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!scopeId) return;
        void runner.getState().start({
          scopeId,
          environmentId: environmentId || null,
          stopOnFail,
          onlyWithBaseline,
        });
      }}
      className="flex flex-col gap-3"
    >
      <Dialog.Title className="text-base font-semibold">Run requests</Dialog.Title>
      <label htmlFor={`${id}-scope`} className="flex flex-col gap-1">
        <span className="text-xs text-fg-muted">Collection or folder</span>
        <select
          id={`${id}-scope`}
          data-testid="run-scope"
          value={scopeId}
          onChange={(event) => setScopeId(event.target.value)}
          className="h-8 rounded border border-border bg-bg px-2"
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-env`} className="flex flex-col gap-1">
        <span className="text-xs text-fg-muted">Environment</span>
        <select
          id={`${id}-env`}
          data-testid="run-environment"
          value={environmentId}
          onChange={(event) => setEnvironmentId(event.target.value)}
          className="h-8 rounded border border-border bg-bg px-2"
        >
          <option value="">No environment</option>
          {environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-stop`} className="flex items-center gap-2">
        <input
          id={`${id}-stop`}
          type="checkbox"
          data-testid="run-stop-on-fail"
          checked={stopOnFail}
          onChange={(event) => setStopOnFail(event.target.checked)}
        />
        Stop on first failure
      </label>
      <label htmlFor={`${id}-baseline`} className="flex items-center gap-2">
        <input
          id={`${id}-baseline`}
          type="checkbox"
          data-testid="run-only-baseline"
          checked={onlyWithBaseline}
          onChange={(event) => setOnlyWithBaseline(event.target.checked)}
        />
        Only requests with a baseline example
      </label>
      <div className="flex justify-end gap-2">
        <Dialog.Close asChild>
          <button type="button" className="h-8 rounded border border-border px-3 hover:bg-hover">
            Cancel
          </button>
        </Dialog.Close>
        <button
          type="submit"
          data-testid="run-start"
          disabled={!scopeId}
          className="h-8 rounded bg-accent px-3 font-semibold text-accent-fg disabled:opacity-50"
        >
          Run
        </button>
      </div>
    </form>
  );
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The Runner tab: the live run, or a stored report. */
export function RunnerView() {
  const runner = useRunner();
  const run = useRunnerState(runner, (s) => s.run, null);
  const viewingId = useRunnerState(runner, (s) => s.viewingId, null);
  const reports = useRunnerState(runner, (s) => s.reports, []);
  const stored = viewingId ? reports.find((r) => r.id === viewingId) : undefined;
  if (!runner) return null;
  if (stored) return <ReportView runner={runner} report={stored} live={null} />;
  if (run) return <ReportView runner={runner} report={run.report} live={run} />;
  return (
    <div
      data-testid="runner-empty"
      className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-fg-muted"
    >
      <Play size={28} aria-hidden />
      No run yet.
      <button
        type="button"
        onClick={() => runner.getState().openDialog()}
        className="h-8 rounded bg-accent px-3 font-semibold text-accent-fg"
      >
        New run…
      </button>
    </div>
  );
}

function ReportView({
  runner,
  report,
  live,
}: {
  runner: RunnerStore;
  report: RunReport | null;
  live: LiveRun | null;
}) {
  const platform = usePlatform();
  const notify = useAppStore((s) => s.notify);
  const volatileHeaders = useVolatileHeaders();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const entries: readonly RunEntry[] = live?.entries ?? report?.entries ?? [];
  const scope = live?.scope ?? report!.scope;
  const environment = live?.environment ?? report?.environment ?? null;
  const running = live?.status === 'running';
  const done = running ? entries.filter((e) => e.outcome !== 'skipped').length : entries.length;
  const accepted = live?.accepted ?? {};
  const state = runner.getState();
  const acceptable = (entry: RunEntry) =>
    live !== null &&
    !running &&
    !accepted[entry.requestId] &&
    (entry.outcome === 'warn' || entry.outcome === 'fail') &&
    state.canAccept(entry.requestId);
  // Stable callbacks: a long run re-renders only the rows that changed.
  const toggle = useCallback((requestId: string, on: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(requestId);
      else next.delete(requestId);
      return next;
    });
  }, []);
  const openEntry = useCallback(
    (requestId: string) => runner.getState().openEntry(requestId),
    [runner],
  );
  const exportReport = async () => {
    if (!report) return;
    try {
      const outcome = await platform.files.saveFile(
        reportFileName(report),
        reportText(report),
        'application/json',
      );
      if (outcome === 'saved') notify(`Exported ${reportFileName(report)}.`);
    } catch (cause) {
      notify(`Export failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  return (
    <div data-testid="runner-view" className="flex min-h-0 flex-1 flex-col text-sm">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2">
        <span className="font-semibold" data-testid="run-scope-name">
          {scope.name}
        </span>
        <span className="text-xs text-fg-muted">
          {environment ? environment.name : 'No environment'} ·{' '}
          {report?.transport ?? platform.capabilities.transport}
        </span>
        <span
          data-testid="run-status"
          data-status={running ? 'running' : report?.cancelled ? 'cancelled' : 'done'}
          className="text-xs text-fg-muted"
        >
          {running
            ? `Running ${done} / ${entries.length}`
            : report
              ? `${report.cancelled ? 'Cancelled' : report.stoppedOnFail ? 'Stopped on failure' : 'Finished'} in ${formatDuration(report.durationMs)}`
              : ''}
        </span>
        <span className="flex-1" />
        {running ? (
          <button
            type="button"
            data-testid="run-cancel"
            onClick={() => state.cancel()}
            className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 hover:bg-hover"
          >
            <Square size={12} aria-hidden /> Cancel
          </button>
        ) : (
          <>
            {live && (
              <button
                type="button"
                data-testid="run-accept"
                disabled={selected.size === 0}
                onClick={() => {
                  const count = state.acceptBaselines([...selected], volatileHeaders);
                  setSelected(new Set());
                  if (count > 0) {
                    notify(`Accepted ${count} new baseline${count === 1 ? '' : 's'} (unsaved).`);
                  }
                }}
                className="h-7 rounded border border-border px-2 hover:bg-hover disabled:opacity-50"
              >
                Accept selected as baselines
              </button>
            )}
            <button
              type="button"
              data-testid="run-export"
              disabled={!report}
              onClick={() => void exportReport()}
              className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 hover:bg-hover disabled:opacity-50"
            >
              <Download size={12} aria-hidden /> Export report (JSON)
            </button>
            {live && (
              <button
                type="button"
                data-testid="run-again"
                onClick={() => void state.start(live.settings)}
                className="inline-flex h-7 items-center gap-1 rounded bg-accent px-2 font-semibold text-accent-fg"
              >
                <Play size={12} aria-hidden /> Run again
              </button>
            )}
          </>
        )}
      </header>
      <div className="h-1 bg-surface" aria-hidden>
        <div
          data-testid="run-progress"
          className="h-full bg-accent transition-[width]"
          style={{ width: `${entries.length ? (done / entries.length) * 100 : 100}%` }}
        />
      </div>
      {report && (
        <div
          data-testid="run-totals"
          className="flex flex-wrap gap-3 border-b border-border px-3 py-1.5 text-xs"
        >
          {OUTCOME_ORDER.filter((outcome) => report.totals[outcome] > 0).map((outcome) => (
            <span
              key={outcome}
              data-testid={`run-total-${outcome}`}
              className={OUTCOME_VIEW[outcome].className}
            >
              {report.totals[outcome]} {OUTCOME_VIEW[outcome].label.toLowerCase()}
            </span>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label="Run results">
        {entries.length === 0 && !running && (
          <p className="p-4 text-center text-fg-muted">No requests to run.</p>
        )}
        {entries.map((entry, index) => (
          <RunRow
            key={`${entry.requestId}-${index}`}
            entry={entry}
            current={running && live?.current === index}
            waiting={running && entry.outcome === 'skipped'}
            selectable={acceptable(entry)}
            selected={selected.has(entry.requestId)}
            accepted={accepted[entry.requestId] === true}
            onOpen={openEntry}
            onToggle={toggle}
          />
        ))}
      </div>
    </div>
  );
}

const RunRow = memo(function RunRow({
  entry,
  current,
  waiting,
  selectable,
  selected,
  accepted,
  onOpen,
  onToggle,
}: {
  entry: RunEntry;
  current: boolean;
  waiting: boolean;
  selectable: boolean;
  selected: boolean;
  accepted: boolean;
  onOpen: (requestId: string) => void;
  onToggle: (requestId: string, on: boolean) => void;
}) {
  return (
    <div
      role="listitem"
      data-testid="run-row"
      data-request-id={entry.requestId}
      data-outcome={current ? 'running' : entry.outcome}
      onClick={() => onOpen(entry.requestId)}
      className="flex cursor-default items-center gap-2 border-b border-border/60 px-3 py-1 hover:bg-hover"
    >
      <span className="flex w-4 justify-center" onClick={(event) => event.stopPropagation()}>
        {selectable && (
          <input
            type="checkbox"
            aria-label={`Select ${entry.name}`}
            data-testid="run-row-select"
            checked={selected}
            onChange={(event) => onToggle(entry.requestId, event.target.checked)}
          />
        )}
      </span>
      <span
        className={`w-12 shrink-0 font-mono text-[10px] font-bold ${methodColorClass(entry.method)}`}
      >
        {methodLabel(entry.method)}
      </span>
      <span className="min-w-0 flex-1 truncate" data-testid="run-row-name">
        {entry.folders.length > 0 && (
          <span className="text-fg-muted">{entry.folders.join(' / ')} / </span>
        )}
        {entry.name}
      </span>
      <span className="w-10 text-right font-mono text-xs" data-testid="run-row-status">
        {entry.status ?? ''}
      </span>
      <span className="w-16 text-right text-xs text-fg-muted">
        {entry.timeMs === undefined ? '' : `${entry.timeMs} ms`}
      </span>
      <span className="flex w-32 justify-end" title={entry.message}>
        {current ? (
          <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
            <LoaderCircle size={12} className="animate-spin" aria-hidden /> Sending
          </span>
        ) : accepted ? (
          <span data-testid="run-accepted" className="text-xs text-fg-muted">
            Baseline accepted
          </span>
        ) : waiting ? (
          <span className="text-xs text-fg-muted">Waiting</span>
        ) : (
          <OutcomeLabel outcome={entry.outcome} />
        )}
      </span>
    </div>
  );
});

/** The Runner sidebar view: new run, recent reports. */
export function RunnerSidebar() {
  const runner = useRunner();
  const reports = useRunnerState(runner, (s) => s.reports, []);
  const viewingId = useRunnerState(runner, (s) => s.viewingId, null);
  if (!runner) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-fg-muted">
        No project open
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 text-sm">
      <button
        type="button"
        data-testid="runner-new-run"
        onClick={() => runner.getState().openDialog()}
        className="inline-flex h-8 items-center justify-center gap-1 rounded bg-accent px-3 font-semibold text-accent-fg"
      >
        <Play size={14} aria-hidden /> New run…
      </button>
      <h2 className="px-1 pt-2 text-xs font-semibold text-fg-muted uppercase">Recent runs</h2>
      {reports.length === 0 && <p className="px-1 text-fg-muted">No runs yet.</p>}
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Recent runs">
        {reports.map((report) => (
          <li key={report.id}>
            <button
              type="button"
              data-testid="runner-report"
              aria-current={viewingId === report.id || undefined}
              onClick={() => runner.getState().view(report.id)}
              className="flex w-full flex-col items-start rounded px-2 py-1 text-left hover:bg-hover aria-[current]:bg-hover"
            >
              <span className="truncate">{report.scope.name}</span>
              <span className="text-xs text-fg-muted">
                {new Date(report.startedAt).toLocaleString()} ·{' '}
                {OUTCOME_ORDER.filter((o) => report.totals[o] > 0)
                  .map((o) => `${report.totals[o]} ${OUTCOME_VIEW[o].label.toLowerCase()}`)
                  .join(', ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
