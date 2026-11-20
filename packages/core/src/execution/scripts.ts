/**
 * Scripts are kept and edited but not run yet (PIGN-031; execution arrives with PIGN-043/044).
 * A send reports which scripts it skipped.
 */

import { hasScripts } from '@pigeon/formats';

import type { ProjectModel } from '../model/project';
import { itemAncestry } from '../variables/scopes';
import { findItem } from '../workspace/commands';

/** Where scripts would run for `requestId`: the collection, folders (outermost first), request. */
export function scriptsNotRun(model: ProjectModel, requestId: string): string[] {
  const found = itemAncestry(model, requestId);
  const request = findItem(model, requestId);
  if (!found || request?.kind !== 'request') return [];
  return [
    ...(hasScripts(found.collection.events) ? [`collection ${found.collection.name}`] : []),
    ...found.folders.filter((f) => hasScripts(f.events)).map((f) => `folder ${f.name}`),
    ...(hasScripts(request.events) ? ['this request'] : []),
  ];
}

/** The send warning for skipped scripts. */
export function scriptsNotRunWarning(places: readonly string[]): string | undefined {
  if (places.length === 0) return undefined;
  return `Scripts were not run (not supported yet): ${places.join(', ')}.`;
}
