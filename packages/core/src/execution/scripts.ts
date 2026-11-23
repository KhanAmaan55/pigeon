/**
 * Which scripts a send skips (PIGN-031/043): test scripts until PIGN-044, or every script when
 * script execution is off for the project. A send reports them as a warning.
 */

import { hasScripts, readScript } from '@pigeon/formats';

import type { ProjectModel } from '../model/project';
import { itemAncestry } from '../variables/scopes';
import { findItem } from '../workspace/commands';

/**
 * Where scripts would run for `requestId`: the collection, folders (outermost first), request.
 * `listen` limits it to one kind of script.
 */
export function scriptsNotRun(
  model: ProjectModel,
  requestId: string,
  listen?: 'prerequest' | 'test',
): string[] {
  const found = itemAncestry(model, requestId);
  const request = findItem(model, requestId);
  if (!found || request?.kind !== 'request') return [];
  const has = (events: readonly unknown[] | undefined) => {
    if (!listen) return hasScripts(events ?? []);
    const script = readScript(events ?? [], listen);
    return script.index !== -1 && !script.disabled && script.text.trim() !== '';
  };
  return [
    ...(has(found.collection.events) ? [`collection ${found.collection.name}`] : []),
    ...found.folders.filter((f) => has(f.events)).map((f) => `folder ${f.name}`),
    ...(has(request.events) ? ['this request'] : []),
  ];
}

/**
 * Why scripts were skipped: test scripts aren't supported yet (`tests`), script execution is off
 * for the project (`disabled`), or no script runs at all (`unsupported`, e.g. the CLI).
 */
export type SkippedScriptsReason = 'tests' | 'disabled' | 'unsupported';

/** The send warning for skipped scripts. */
export function scriptsNotRunWarning(
  places: readonly string[],
  reason: SkippedScriptsReason = 'unsupported',
): string | undefined {
  if (places.length === 0) return undefined;
  const list = places.join(', ');
  if (reason === 'tests') return `Test scripts were not run (not supported yet): ${list}.`;
  if (reason === 'disabled') {
    return `Scripts were not run (script execution is off for this project): ${list}.`;
  }
  return `Scripts were not run (not supported yet): ${list}.`;
}
