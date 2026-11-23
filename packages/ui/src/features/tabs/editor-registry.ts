/**
 * One request-editor store per open tab, bound to the project session (PIGN-016), so each tab
 * keeps its own last response, body-mode drafts and in-flight send while others are shown.
 */

import type {
  CurrentValueWrite,
  ProjectRequest,
  ProjectSession,
  Request,
  VariableScopes,
} from '@pigeon/core';
import {
  buildScopes,
  inheritedAuth,
  projectRules,
  scriptChain,
  scriptsNotRun,
  uniqueExampleName,
  upsertRule,
  withBaseline,
} from '@pigeon/core';
import { isEmptyComparison } from '@pigeon/formats';
import { compareRequestResult } from '../compare/compare-request';
import type { Platform } from '@pigeon/platform';

import type { ScratchRequestEnvironment } from '../request-editor/scratch-store';
import { createScratchRequestStore } from '../request-editor/scratch-store';
import type { ProjectStore } from '../../stores/project-store';

export type TabEditorStore = ReturnType<typeof createScratchRequestStore>;

const registries = new WeakMap<ProjectSession, Map<string, TabEditorStore>>();
/** The editor view of each project request object (so unchanged requests keep their identity). */
const editorViews = new WeakMap<ProjectRequest, Request>();

/** A project request as the editor model sees it: scripts stay in the file (PIGN-031). */
export function toEditorRequest(request: ProjectRequest): Request {
  let view = editorViews.get(request);
  if (!view) {
    // Examples are edited through their own commands, never through the request editor.
    const { events: _events, broken: _broken, examples: _examples, ...rest } = request;
    view = rest;
    editorViews.set(request, view);
  }
  return view;
}

export function getTabEditor(
  session: ProjectSession,
  projectStore: ProjectStore,
  requestId: string,
  platform: Pick<Platform, 'transport' | 'capabilities' | 'pickedFiles'>,
  env: ScratchRequestEnvironment,
): TabEditorStore {
  let registry = registries.get(session);
  if (!registry) registries.set(session, (registry = new Map()));
  let editor = registry.get(requestId);
  if (!editor) {
    const read = () => {
      const request = session.findRequest(requestId);
      if (!request) throw new Error(`Request "${requestId}" is not in the project`);
      return toEditorRequest(request);
    };
    editor = createScratchRequestStore(platform, env, {
      read,
      commit: (request) => {
        const { kind: _kind, id: _id, fileKey: _fileKey, ...patch } = request;
        // `auth: undefined` (Inherit) must clear the request's auth, not leave it as it was.
        session.apply({
          type: 'updateRequest',
          id: requestId,
          patch: { ...patch, auth: request.auth },
        });
        // Editing a preview tab keeps it (docs/ui-ux.md §3.2).
        projectStore.getState().pinTab(requestId);
      },
      subscribe: (listener) =>
        session.onChange(() => {
          if (session.findRequest(requestId)) listener();
        }),
      // Separate connection pools per open project, also for copies sharing an id (PIGN-021).
      projectId: session.localKey || session.id,
      projectFs: session.fs,
      scopes: () => projectScopes(session, requestId),
      moveToSecret: (suggestedName, value) => moveToSecret(session, suggestedName, value),
      inheritedAuth: () => inheritedAuth(session.getWorkingModel(), requestId),
      events: () => session.findRequest(requestId)?.events ?? [],
      setEvents: (events) => {
        session.apply({ type: 'updateRequest', id: requestId, patch: { events } });
        projectStore.getState().pinTab(requestId);
      },
      // Scripts run (PIGN-043/044) unless script execution is off for the project.
      skippedScripts: () =>
        projectStore.getState().scriptsEnabled
          ? []
          : scriptsNotRun(session.getWorkingModel(), requestId),
      skippedScriptsReason: () => 'disabled',
      tests: () => {
        if (!projectStore.getState().scriptsEnabled) return null;
        const scripts = scriptChain(session.getWorkingModel(), requestId, 'test');
        const name = session.findRequest(requestId)?.name ?? '';
        return scripts.length > 0 ? { scripts, requestName: name } : null;
      },
      preRequest: () => {
        if (!projectStore.getState().scriptsEnabled) return null;
        const scripts = scriptChain(session.getWorkingModel(), requestId, 'prerequest');
        const name = session.findRequest(requestId)?.name ?? '';
        return scripts.length > 0 ? { scripts, requestName: name } : null;
      },
      onScriptWrites: (writes) => applyScriptWrites(session, writes),
      onScriptLogs: (entries) => projectStore.getState().appendConsole(entries),
      compare: (result) => compareRequestResult(session, projectStore, requestId, result),
      rules: () => ({
        request: session.findRequest(requestId)?.comparison?.rules ?? [],
        project: projectRules(session.getWorkingModel()),
      }),
      overrides: () => {
        const config = session.findRequest(requestId)?.comparison;
        return {
          ...(config?.status === undefined ? {} : { status: config.status }),
          ...(config?.headers === undefined ? {} : { headers: config.headers }),
          ...(config?.body === undefined ? {} : { body: config.body }),
        };
      },
      setOverrides: (patch) => {
        const current = session.findRequest(requestId)?.comparison ?? { rules: [], extra: {} };
        const config: Record<string, unknown> = { ...current, ...patch };
        for (const key of ['status', 'headers', 'body']) {
          const value = config[key];
          if (
            value === undefined ||
            (typeof value === 'object' && value !== null && Object.keys(value).length === 0)
          ) {
            delete config[key];
          }
        }
        const next = config as unknown as typeof current;
        session.apply({
          type: 'setComparisonConfig',
          requestId,
          config: isEmptyComparison(next) ? undefined : next,
        });
        projectStore.getState().pinTab(requestId);
      },
      setRules: (rules) => {
        const current = session.findRequest(requestId)?.comparison ?? { rules: [], extra: {} };
        const config = { ...current, rules };
        session.apply({
          type: 'setComparisonConfig',
          requestId,
          config: isEmptyComparison(config) ? undefined : config,
        });
        projectStore.getState().pinTab(requestId);
      },
      addRule: (rule) => {
        const request = session.findRequest(requestId);
        session.apply({
          type: 'setComparisonConfig',
          requestId,
          config: upsertRule(request?.comparison, rule),
        });
        projectStore.getState().pinTab(requestId);
      },
      createExample: (example) => {
        const examples = session.findRequest(requestId)?.examples ?? [];
        session.apply({
          type: 'createExample',
          requestId,
          example: { ...example, name: uniqueExampleName(example.name, examples) },
        });
        projectStore.getState().pinTab(requestId);
      },
      acceptBaseline: (exampleId, patch) => {
        session.apply({ type: 'updateExample', id: exampleId, patch });
        projectStore.getState().pinTab(requestId);
      },
      baseline: () => session.findRequest(requestId)?.comparison?.baseline ?? { mode: 'auto' },
      setBaseline: (baseline) => {
        const config = withBaseline(session.findRequest(requestId)?.comparison, baseline);
        session.apply({
          type: 'setComparisonConfig',
          requestId,
          config: isEmptyComparison(config) ? undefined : config,
        });
        projectStore.getState().pinTab(requestId);
      },
    });
    registry.set(requestId, editor);
  }
  return editor;
}

/**
 * Creates a secret variable in the selected environment (globals without one) whose current value
 * is `value`, and returns its (unique) name. The shared value stays empty, so nothing secret
 * reaches the project files.
 */
export function moveToSecret(
  session: ProjectSession,
  suggestedName: string,
  value: string,
): string | null {
  if (session.readOnly) return null;
  const environment = session.selectedEnvironmentId
    ? session.findEnvironment(session.selectedEnvironmentId)
    : undefined;
  const existing = environment?.values ?? session.getWorkingModel().globals?.values ?? [];
  const base = suggestedName.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'secret';
  let name = base;
  for (let i = 2; existing.some((v) => v.key === name); i++) name = `${base}${i}`;
  const variable = { key: name, value: '', type: 'secret', enabled: true };
  if (environment) {
    session.apply({
      type: 'setEnvironmentValues',
      id: environment.id,
      values: [...environment.values, variable],
    });
    session.setCurrentValue(`env:${environment.id}`, name, value);
  } else {
    session.apply({ type: 'setGlobals', values: [...existing, variable] });
    session.setCurrentValue('globals', name, value);
  }
  return name;
}

/** The variables a request (or container) in this project resolves against right now. */
export function projectScopes(session: ProjectSession, itemId?: string): VariableScopes {
  return buildScopes(session.getWorkingModel(), {
    environmentId: session.selectedEnvironmentId,
    currentValues: (key) => session.currentValues(key),
    ...(itemId ? { itemId } : {}),
  });
}

/** Drops a closed tab's editor (and cancels its send). */
export function disposeTabEditor(session: ProjectSession, requestId: string): void {
  const registry = registries.get(session);
  registry?.get(requestId)?.dispose();
  registry?.delete(requestId);
}

/** Saves script variable writes as current values (never shared values, PIGN-043). */
export function applyScriptWrites(session: ProjectSession, writes: readonly CurrentValueWrite[]) {
  for (const write of writes) {
    session.setCurrentValue(write.scopeKey, write.key, write.value ?? undefined);
  }
}
