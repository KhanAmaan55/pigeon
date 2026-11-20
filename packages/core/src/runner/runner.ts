/**
 * Regression runs (docs/response-comparison.md §7, architecture.md §3.6, PIGN-038): every
 * request of a collection or folder, in explorer order, sent one after the other with one
 * environment and compared with its baseline. Framework-agnostic (the CLI reuses it): sending
 * and comparing are injected; the run is an async generator of events ending in a `RunReport`.
 */

import type { ProjectItem, ProjectModel, ProjectRequest } from '../model/project';
import type { ComparisonOutcome, ComparisonResult } from '../comparison/comparison-service';
import type { ExecutionResult } from '../execution/types';
import { findContainer } from '../workspace/commands';

export interface RunTarget {
  requestId: string;
  name: string;
  method: string;
  /** Folder names from the scope down to the request. */
  folders: string[];
}

export type RunOutcome = 'pass' | 'warn' | 'fail' | 'no-baseline' | 'error' | 'skipped';

/** One request of a run (stored in local state: no findings, secrets already masked). */
export interface RunEntry {
  requestId: string;
  name: string;
  method: string;
  folders: string[];
  outcome: RunOutcome;
  /** Masked URL as sent. */
  url?: string;
  status?: number;
  timeMs?: number;
  exampleId?: string;
  exampleName?: string;
  counts?: ComparisonResult['counts'];
  /** Error message (outcome `error`) or why there was no comparison. */
  message?: string;
}

export interface RunReport {
  /** `pigeonRunReport` format version (data-model.md §7.3). */
  pigeonRunReport: 1;
  id: string;
  scope: { kind: 'collection' | 'folder'; id: string; name: string };
  environment: { id: string; name: string } | null;
  transport: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  options: { stopOnFail: boolean; onlyWithBaseline: boolean };
  /** Stopped by Cancel (the rest is `skipped`). */
  cancelled: boolean;
  /** Stopped after the first failure (stop on first failure). */
  stoppedOnFail: boolean;
  totals: Record<RunOutcome, number>;
  entries: RunEntry[];
}

export type RunEvent =
  | { type: 'started'; total: number; entries: RunEntry[] }
  | { type: 'request-started'; index: number }
  | {
      type: 'request-finished';
      index: number;
      entry: RunEntry;
      /** In memory only (never stored): the full result and comparison. */
      result?: ExecutionResult;
      comparison?: ComparisonOutcome;
    };

export interface RunDeps {
  /** Sends one request (never rejects: failures are `result.error`). */
  execute: (target: RunTarget, signal: AbortSignal) => Promise<ExecutionResult>;
  /** Compares a result with the request's baseline (`undefined`: nothing to compare). */
  compare: (target: RunTarget, result: ExecutionResult) => Promise<ComparisonOutcome | undefined>;
  now?: () => number;
  newId?: () => string;
}

export interface RunOptions {
  scope: RunReport['scope'];
  environment: RunReport['environment'];
  transport: string;
  stopOnFail?: boolean;
  onlyWithBaseline?: boolean;
  signal?: AbortSignal;
}

/**
 * The requests a run sends for `scopeId` (a collection or folder), in explorer order. With
 * `onlyWithBaseline`, requests without examples (or with comparison off) are left out.
 */
export function runTargets(
  model: ProjectModel,
  scopeId: string,
  options: { onlyWithBaseline?: boolean } = {},
): RunTarget[] {
  const scope = findContainer(model, scopeId);
  if (!scope) return [];
  const targets: RunTarget[] = [];
  const visit = (items: readonly ProjectItem[], folders: string[]) => {
    for (const item of items) {
      if (item.kind === 'folder') {
        visit(item.children, [...folders, item.name]);
        continue;
      }
      if (item.broken) continue;
      if (options.onlyWithBaseline && !hasBaseline(item)) continue;
      targets.push({ requestId: item.id, name: item.name, method: item.method, folders });
    }
  };
  visit(scope.children, []);
  return targets;
}

function hasBaseline(request: ProjectRequest): boolean {
  return request.examples.length > 0 && request.comparison?.baseline?.mode !== 'none';
}

const EMPTY_TOTALS = (): Record<RunOutcome, number> => ({
  pass: 0,
  warn: 0,
  fail: 0,
  'no-baseline': 0,
  error: 0,
  skipped: 0,
});

function entryFor(
  target: RunTarget,
  result: ExecutionResult,
  comparison: ComparisonOutcome | undefined,
): RunEntry {
  const base: RunEntry = {
    requestId: target.requestId,
    name: target.name,
    method: target.method,
    folders: target.folders,
    outcome: 'no-baseline',
    // A short secret can't be masked in free text: such a URL is never stored.
    ...(result.containsUnmaskedSecrets ? {} : { url: result.request.url }),
    ...(result.response
      ? { status: result.response.status, timeMs: Math.round(result.response.timings.totalMs) }
      : {}),
  };
  if (result.error && !result.response) {
    return { ...base, outcome: 'error', message: result.error.message };
  }
  if (!comparison) return { ...base, outcome: 'no-baseline', message: 'Not compared' };
  switch (comparison.kind) {
    case 'compared':
      return {
        ...base,
        outcome: comparison.result.outcome,
        exampleId: comparison.result.exampleId,
        exampleName: comparison.result.exampleName,
        counts: comparison.result.counts,
      };
    case 'no-baseline':
      return { ...base, message: 'No baseline example' };
    case 'disabled':
      return { ...base, message: 'Comparison turned off' };
    case 'baseline-not-found':
      return { ...base, message: 'Pinned baseline example not found' };
  }
}

/** Runs `targets` one after the other; yields events and returns the report. */
export async function* runRegression(
  targets: readonly RunTarget[],
  deps: RunDeps,
  options: RunOptions,
): AsyncGenerator<RunEvent, RunReport> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const entries: RunEntry[] = targets.map((target) => ({
    requestId: target.requestId,
    name: target.name,
    method: target.method,
    folders: target.folders,
    outcome: 'skipped',
  }));
  yield { type: 'started', total: targets.length, entries: entries.map((e) => ({ ...e })) };
  const signal = options.signal ?? new AbortController().signal;
  let stoppedOnFail = false;
  for (const [index, target] of targets.entries()) {
    if (signal.aborted || stoppedOnFail) break;
    yield { type: 'request-started', index };
    const result = await deps.execute(target, signal);
    if (signal.aborted && result.error?.kind === 'aborted') break;
    const comparison = result.response ? await deps.compare(target, result) : undefined;
    const entry = entryFor(target, result, comparison);
    entries[index] = entry;
    yield {
      type: 'request-finished',
      index,
      entry,
      result,
      ...(comparison ? { comparison } : {}),
    };
    if (options.stopOnFail && (entry.outcome === 'fail' || entry.outcome === 'error')) {
      stoppedOnFail = true;
    }
  }
  const totals = EMPTY_TOTALS();
  for (const entry of entries) totals[entry.outcome] += 1;
  const finished = now();
  return {
    pigeonRunReport: 1,
    id: deps.newId?.() ?? crypto.randomUUID(),
    scope: options.scope,
    environment: options.environment,
    transport: options.transport,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: Math.max(0, finished - started),
    options: {
      stopOnFail: options.stopOnFail ?? false,
      onlyWithBaseline: options.onlyWithBaseline ?? false,
    },
    cancelled: signal.aborted,
    stoppedOnFail,
    totals,
    entries,
  };
}

/** How many run reports local state keeps. */
export const RUN_REPORTS_LIMIT = 20;

/** `reports` with `report` first, bounded. */
export function rememberRunReport(
  reports: readonly RunReport[] | undefined,
  report: RunReport,
): RunReport[] {
  return [report, ...(reports ?? []).filter((r) => r.id !== report.id)].slice(0, RUN_REPORTS_LIMIT);
}
