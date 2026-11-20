/**
 * Regression runs in the UI (PIGN-038): one runner per open project. It sends the requests of a
 * collection or folder with `runRegression` (core), compares each like the request editor does,
 * keeps the live run's results in memory (to open a row with its result, or accept baselines)
 * and stores each report in the project's local state (last 20, no findings, secrets masked).
 */

import type {
  ComparisonOutcome,
  ExecutionResult,
  ProjectSession,
  RunEntry,
  RunReport,
  RunTarget,
} from '@pigeon/core';
import {
  acceptedExamplePatch,
  buildScopes,
  createExecutionContext,
  DEFAULT_PREFERENCES,
  findContainer,
  inheritedAuth,
  rememberRunReport,
  RequestExecutor,
  runRegression,
  runTargets,
  scriptsNotRun,
} from '@pigeon/core';
import type { Platform } from '@pigeon/platform';
import { createStore } from 'zustand';

import type { ProjectStore } from '../../stores/project-store';
import { compareRequestResult } from '../compare/compare-request';
import type { ScratchRequestEnvironment } from '../request-editor/scratch-store';
import { getTabEditor, toEditorRequest } from '../tabs/editor-registry';
import { RUNNER_TAB_ID } from './tab';

export { RUNNER_TAB_ID } from './tab';

export interface RunSettings {
  scopeId: string;
  environmentId: string | null;
  stopOnFail: boolean;
  onlyWithBaseline: boolean;
}

export interface LiveRun {
  scope: RunReport['scope'];
  environment: RunReport['environment'];
  settings: RunSettings;
  status: 'running' | 'done';
  entries: RunEntry[];
  /** Index of the request being sent. */
  current: number | null;
  report: RunReport | null;
  /** Requests whose baseline was replaced by their actual response here. */
  accepted: Readonly<Record<string, true>>;
}

export interface RunnerState {
  /** The run dialog, opened for a scope (or the first collection). */
  dialog: { scopeId: string | null } | null;
  openDialog: (scopeId?: string) => void;
  closeDialog: () => void;
  run: LiveRun | null;
  /** A stored report shown instead of the live run. */
  viewingId: string | null;
  view: (reportId: string | null) => void;
  reports: readonly RunReport[];
  /** Starts a run (cancelling one in progress) and shows the Runner tab. */
  start: (settings: RunSettings) => Promise<RunReport | null>;
  cancel: () => void;
  /** Whether the live run has the result of `requestId` (to open it, or to accept it). */
  canAccept: (requestId: string) => boolean;
  /** Opens the request's tab with the run's result and comparison. */
  openEntry: (requestId: string) => void;
  /** Accepts the actual responses of `requestIds` as their baselines; returns how many. */
  acceptBaselines: (requestIds: readonly string[], volatileHeaders: readonly string[]) => number;
}

export type RunnerStore = ReturnType<typeof createRunnerStore>;

interface Kept {
  result: ExecutionResult;
  comparison: ComparisonOutcome | undefined;
  secrets: readonly string[];
}

type RunnerPlatform = Pick<Platform, 'transport' | 'capabilities' | 'pickedFiles'>;

const runners = new WeakMap<ProjectSession, RunnerStore>();

export function getRunner(
  session: ProjectSession,
  projectStore: ProjectStore,
  platform: RunnerPlatform,
  env: ScratchRequestEnvironment,
): RunnerStore {
  let runner = runners.get(session);
  if (!runner)
    runners.set(session, (runner = createRunnerStore(session, projectStore, platform, env)));
  return runner;
}

export function createRunnerStore(
  session: ProjectSession,
  projectStore: ProjectStore,
  platform: RunnerPlatform,
  env: ScratchRequestEnvironment,
) {
  const executor = new RequestExecutor(platform.transport, { pickedFiles: platform.pickedFiles });
  let controller: AbortController | null = null;
  /** Results of the live run, in memory only. */
  let kept = new Map<string, Kept>();

  return createStore<RunnerState>()((set, get) => {
    const updateRun = (patch: Partial<LiveRun>) => {
      const run = get().run;
      if (run) set({ run: { ...run, ...patch } });
    };

    return {
      dialog: null,
      openDialog: (scopeId) => set({ dialog: { scopeId: scopeId ?? null } }),
      closeDialog: () => set({ dialog: null }),
      run: null,
      viewingId: null,
      view: (reportId) => {
        // The live run's own report shows as the live run (rows open their results).
        set({ viewingId: reportId === get().run?.report?.id ? null : reportId });
        projectStore.getState().openTab(RUNNER_TAB_ID, { pin: true });
      },
      reports: session.localState?.runReports ?? [],
      start: async (settings) => {
        controller?.abort();
        const own = new AbortController();
        controller = own;
        kept = new Map();
        const model = session.getWorkingModel();
        const container = findContainer(model, settings.scopeId);
        if (!container) return null;
        const scope: RunReport['scope'] = {
          kind: model.collections.some((c) => c.id === container.id) ? 'collection' : 'folder',
          id: container.id,
          name: container.name,
        };
        const envEntity = settings.environmentId
          ? session.findEnvironment(settings.environmentId)
          : undefined;
        const environment = envEntity ? { id: envEntity.id, name: envEntity.name } : null;
        const targets = runTargets(model, settings.scopeId, {
          onlyWithBaseline: settings.onlyWithBaseline,
        });
        set({
          dialog: null,
          viewingId: null,
          run: {
            scope,
            environment,
            settings,
            status: 'running',
            entries: [],
            current: null,
            report: null,
            accepted: {},
          },
        });
        projectStore.getState().openTab(RUNNER_TAB_ID, { pin: true });

        const secrets = new Map<string, readonly string[]>();
        const pageOrigin =
          platform.capabilities.transport === 'fetch' ? env.pageOrigin?.() : undefined;
        const execute = (target: RunTarget, signal: AbortSignal) => {
          const working = session.getWorkingModel();
          const request = session.findRequest(target.requestId)!;
          const editorRequest = toEditorRequest(request);
          const inherited = editorRequest.auth
            ? undefined
            : inheritedAuth(working, target.requestId).auth;
          const ctx = createExecutionContext({
            capabilities: platform.capabilities,
            preferences: { ...(env.preferences?.() ?? DEFAULT_PREFERENCES) },
            ...(pageOrigin === undefined ? {} : { pageOrigin }),
            projectFs: session.fs,
            projectId: session.localKey || session.id,
            scopes: buildScopes(working, {
              environmentId: environment?.id ?? null,
              currentValues: (key) => session.currentValues(key),
              itemId: target.requestId,
            }),
            ...(inherited === undefined ? {} : { inheritedAuth: inherited }),
            skippedScripts: scriptsNotRun(working, target.requestId),
          });
          return executor.execute(editorRequest, ctx, {
            signal,
            onPrepared: (prepared) => secrets.set(target.requestId, prepared.meta.secretValues),
          });
        };
        const generator = runRegression(
          targets,
          {
            execute,
            compare: (target, result) =>
              compareRequestResult(session, projectStore, target.requestId, result),
          },
          {
            scope,
            environment,
            transport: platform.capabilities.transport,
            stopOnFail: settings.stopOnFail,
            onlyWithBaseline: settings.onlyWithBaseline,
            signal: own.signal,
          },
        );
        let step = await generator.next();
        while (!step.done) {
          if (controller !== own) return null; // superseded by a newer run
          const event = step.value;
          if (event.type === 'started') {
            updateRun({ entries: event.entries });
          } else if (event.type === 'request-started') {
            updateRun({ current: event.index });
          } else {
            const { entry, result } = event;
            if (result) {
              kept.set(entry.requestId, {
                result,
                comparison: event.comparison,
                secrets: secrets.get(entry.requestId) ?? [],
              });
            }
            const entries = [...(get().run?.entries ?? [])];
            entries[event.index] = entry;
            updateRun({ entries });
            // Let the window paint and handle input between requests, even when the transport
            // answers without a macrotask (cached or mocked responses).
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          step = await generator.next();
        }
        if (controller !== own) return null;
        controller = null;
        const report = step.value;
        const reports = rememberRunReport(get().reports, report);
        session.updateLocalState({ runReports: reports });
        set({ reports });
        updateRun({ status: 'done', current: null, entries: report.entries, report });
        return report;
      },
      cancel: () => controller?.abort(new DOMException('The run was cancelled.', 'AbortError')),
      canAccept: (requestId) => {
        const entry = kept.get(requestId);
        return (
          entry?.comparison?.kind === 'compared' &&
          !!entry.result.response &&
          !!session.findRequest(requestId) &&
          !session.readOnly
        );
      },
      openEntry: (requestId) => {
        if (!session.findRequest(requestId)) return;
        projectStore.getState().openTab(requestId, { pin: true });
        const entry = kept.get(requestId);
        if (entry && get().viewingId === null) {
          getTabEditor(session, projectStore, requestId, platform, env)
            .getState()
            .showResult(entry.result, entry.comparison, entry.secrets);
        }
      },
      acceptBaselines: (requestIds, volatileHeaders) => {
        const accepted: Record<string, true> = { ...get().run?.accepted };
        let count = 0;
        for (const requestId of requestIds) {
          if (!get().canAccept(requestId)) continue;
          const { result, comparison, secrets } = kept.get(requestId)!;
          if (comparison?.kind !== 'compared' || !result.response) continue;
          const request = session.findRequest(requestId)!;
          session.apply({
            type: 'updateExample',
            id: comparison.result.exampleId,
            patch: acceptedExamplePatch(toEditorRequest(request), result.response, {
              volatileHeaders,
              secretValues: secrets,
            }),
          });
          accepted[requestId] = true;
          count += 1;
        }
        updateRun({ accepted });
        return count;
      },
    };
  });
}

/** `run-<scope>-<timestamp>.json` for an exported report. */
export function reportFileName(report: RunReport): string {
  const scope =
    report.scope.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
  const stamp = report.startedAt.replace(/[:.]/g, '-').replace(/Z$/, '');
  return `run-${scope}-${stamp}.json`;
}

/** The exported report (docs/data-model.md, `RunReport`). */
export function reportText(report: RunReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
