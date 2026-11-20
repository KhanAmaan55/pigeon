/** Paths Pigeon reads and writes in a project folder (docs/file-format.md §1.1). */

import type { ProjectPath } from '@pigeon/platform';

const MANAGED: readonly RegExp[] = [
  /^pigeon\.json$/,
  /^collections\/(?:[^/]+\/)+(?:collection|folder)\.json$/,
  /^collections\/(?:[^/]+\/)+[^/]+\.request\.json$/,
  /^environments\/[^/]+\.postman_environment\.json$/,
  /^environments\/globals\.postman_globals\.json$/,
  /^examples\/(?:[^/]+\/)+compare\.json$/,
  /^examples\/(?:[^/]+\/)+[^/]+\.example\.json$/,
  /^examples\/(?:[^/]+\/)+[^/]+\.body\.[^/]+$/,
];

/** True for files Pigeon manages; everything else in a project folder is the user's. */
export function isManagedPath(path: ProjectPath): boolean {
  return MANAGED.some((pattern) => pattern.test(path));
}

/** Files that travel with a project (zip export/import): managed files plus `.gitattributes`. */
export function isProjectFile(path: ProjectPath): boolean {
  return path === '.gitattributes' || isManagedPath(path);
}
