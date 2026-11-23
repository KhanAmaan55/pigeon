/**
 * Sending and comparing one project request the way the apps do (PIGN-038, PIGN-054): variables
 * from the selected environment and the request's folders and collection, inherited auth,
 * pre-request and test scripts, the project's cookie jar and OAuth tokens, then the comparison
 * with the request's baseline. The UI runner and the CLI both use these, so a run gives the same
 * outcomes everywhere; only the surroundings (transport, script runner, preferences) differ.
 */

import type { Capabilities, PreparedRequest } from '@pigeon/platform';
import type { Finding } from '@pigeon/compare';

import type {
  BodyComparisonInput,
  ComparisonOutcome,
  EffectiveComparison,
} from '../comparison/comparison-service';
import {
  bodyComparisonInput,
  comparisonResult,
  compareResponseInput,
  effectiveComparison,
  resolveBaseline,
} from '../comparison/comparison-service';
import { inheritedAuth } from '../execution/auth/inherit';
import type { RequestExecutor } from '../execution/executor';
import { scriptsNotRun } from '../execution/scripts';
import type { ExecutionPreferences, ExecutionResult } from '../execution/types';
import { createExecutionContext, DEFAULT_PREFERENCES } from '../execution/types';
import type { Request } from '../model/request';
import type { ProjectRequest } from '../model/project';
import type { ConsoleEntry, ScriptRunner } from '../scripting/types';
import type { CurrentValueWrite } from '../scripting/prerequest';
import { scriptChain } from '../scripting/prerequest';
import { buildScopes } from '../variables/scopes';
import type { ProjectSession } from '../workspace/project-session';

export interface ProjectExecutionOptions {
  executor: RequestExecutor;
  capabilities: Readonly<Capabilities>;
  preferences?: ExecutionPreferences;
  pageOrigin?: string;
  environmentId: string | null;
  /** Scripts run with this runner when `enabled`; otherwise the result warns they were skipped. */
  scripts?: {
    runner: ScriptRunner;
    enabled: boolean;
    onLogs?: (entries: ConsoleEntry[]) => void;
  };
  signal: AbortSignal;
  onPrepared?: (prepared: PreparedRequest) => void;
}

/** The request definition the executor sends (examples and events are not part of it). */
export function sendableRequest(request: ProjectRequest): Request {
  const { events: _events, broken: _broken, examples: _examples, ...rest } = request;
  return rest;
}

/** Script variable writes become current values (`pm.environment.set`, …). */
export function applyScriptWrites(
  session: ProjectSession,
  writes: readonly CurrentValueWrite[],
): void {
  for (const write of writes) {
    session.setCurrentValue(write.scopeKey, write.key, write.value ?? undefined);
  }
}

/** Sends a project request with everything it inherits (never rejects: see `RequestExecutor`). */
export function executeProjectRequest(
  session: ProjectSession,
  requestId: string,
  options: ProjectExecutionOptions,
  request: Request = sendableRequest(session.findRequest(requestId)!),
): Promise<ExecutionResult> {
  const working = session.getWorkingModel();
  const inherited = request.auth ? undefined : inheritedAuth(working, requestId).auth;
  const scripts = options.scripts;
  const enabled = scripts?.enabled ?? false;
  const scriptCallbacks = (sources: ReturnType<typeof scriptChain>) =>
    scripts && sources.length > 0
      ? {
          runner: scripts.runner,
          scripts: sources,
          requestName: request.name,
          onWrites: (writes: CurrentValueWrite[]) => applyScriptWrites(session, writes),
          ...(scripts.onLogs ? { onLogs: scripts.onLogs } : {}),
        }
      : undefined;
  const preRequest = enabled
    ? scriptCallbacks(scriptChain(working, requestId, 'prerequest'))
    : undefined;
  const tests = enabled ? scriptCallbacks(scriptChain(working, requestId, 'test')) : undefined;
  const ctx = createExecutionContext({
    capabilities: options.capabilities,
    preferences: { ...(options.preferences ?? DEFAULT_PREFERENCES) },
    ...(options.pageOrigin === undefined ? {} : { pageOrigin: options.pageOrigin }),
    projectFs: session.fs,
    projectId: session.localKey || session.id,
    environmentId: options.environmentId,
    scopes: buildScopes(working, {
      environmentId: options.environmentId,
      currentValues: (key) => session.currentValues(key),
      itemId: requestId,
    }),
    ...(inherited === undefined ? {} : { inheritedAuth: inherited }),
    skippedScripts: enabled ? [] : scriptsNotRun(working, requestId),
    skippedScriptsReason: 'disabled',
    ...(tests ? { tests } : {}),
    ...(preRequest ? { preRequest } : {}),
    cookies: { jar: session.cookieJar, onChange: () => session.saveCookies() },
    oauth2: session.oauthTokens,
  });
  return options.executor.execute(request, ctx, {
    signal: options.signal,
    ...(options.onPrepared ? { onPrepared: options.onPrepared } : {}),
  });
}

export type CompareBody = (
  input: BodyComparisonInput,
  effective: Pick<EffectiveComparison, 'status' | 'headers' | 'body' | 'rules'>,
) => Promise<Finding[]>;

const compareInline: CompareBody = async (input, effective) =>
  compareResponseInput(input, effective);

/**
 * Compares a project request's result with its baseline (the project's and the request's
 * comparison settings and rules). `compareBody` lets the UI compare large bodies in a worker.
 */
export async function compareProjectResult(
  session: ProjectSession,
  requestId: string,
  result: ExecutionResult,
  compareBody: CompareBody = compareInline,
): Promise<ComparisonOutcome | undefined> {
  const request = session.findRequest(requestId);
  if (!request || !result.response) return undefined;
  const effective = effectiveComparison(session.getWorkingModel(), request);
  const resolved = resolveBaseline(request, effective.baseline, result.response.status);
  if (!('example' in resolved)) return resolved;
  const { example } = resolved;
  const findings = await compareBody(bodyComparisonInput(example, result), effective);
  return { kind: 'compared', result: comparisonResult(requestId, example, result, findings) };
}
