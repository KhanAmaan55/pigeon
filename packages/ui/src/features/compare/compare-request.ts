/**
 * Compares a project request's result with its baseline (PIGN-034–037): the same path for the
 * request editor and the runner. Records the result for the ★ marker and local state.
 */

import type { ComparisonOutcome, ExecutionResult, ProjectSession } from '@pigeon/core';
import {
  bodyComparisonInput,
  comparisonResult,
  effectiveComparison,
  resolveBaseline,
} from '@pigeon/core';

import type { ProjectStore } from '../../stores/project-store';
import { runBodyComparison } from './run-compare';

export async function compareRequestResult(
  session: ProjectSession,
  projectStore: ProjectStore,
  requestId: string,
  result: ExecutionResult,
): Promise<ComparisonOutcome | undefined> {
  const request = session.findRequest(requestId);
  if (!request || !result.response) return undefined;
  const effective = effectiveComparison(session.getWorkingModel(), request);
  const resolved = resolveBaseline(request, effective.baseline, result.response.status);
  if (!('example' in resolved)) return resolved;
  const { example } = resolved;
  const findings = await runBodyComparison(bodyComparisonInput(example, result), effective);
  const comparison = comparisonResult(requestId, example, result, findings);
  projectStore.getState().setComparison(comparison);
  return { kind: 'compared', result: comparison };
}
