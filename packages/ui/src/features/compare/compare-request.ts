/**
 * Compares a project request's result with its baseline (PIGN-034–037): the same path for the
 * request editor and the runner (core `compareProjectResult`, also used by the CLI), with large
 * bodies compared in a worker. Records the result for the ★ marker and local state.
 */

import type { ComparisonOutcome, ExecutionResult, ProjectSession } from '@pigeon/core';
import { compareProjectResult } from '@pigeon/core';

import type { ProjectStore } from '../../stores/project-store';
import { runBodyComparison } from './run-compare';

export async function compareRequestResult(
  session: ProjectSession,
  projectStore: ProjectStore,
  requestId: string,
  result: ExecutionResult,
): Promise<ComparisonOutcome | undefined> {
  const outcome = await compareProjectResult(session, requestId, result, runBodyComparison);
  if (outcome?.kind === 'compared') projectStore.getState().setComparison(outcome.result);
  return outcome;
}
