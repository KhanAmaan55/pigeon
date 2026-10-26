import type { ProjectPath } from './fs';
import { FsError } from './fs';

const WINDOWS_DRIVE = /^[a-zA-Z]:/;
// eslint-disable-next-line no-control-regex -- NUL is exactly what we reject
const FORBIDDEN_CHARS = /[\\\u0000]/;

/**
 * Throws `FsError('invalid-path')` unless `path` is a project path: POSIX separators, relative,
 * no empty, `.` or `..` segments, no backslashes or NUL. `''` (the project root) is valid.
 */
export function assertProjectPath(path: string): asserts path is ProjectPath {
  if (path === '') return;
  const reason = invalidReason(path);
  if (reason) throw new FsError('invalid-path', path, `Invalid project path "${path}": ${reason}`);
}

function invalidReason(path: string): string | undefined {
  if (path.startsWith('/') || WINDOWS_DRIVE.test(path)) return 'must be relative';
  if (FORBIDDEN_CHARS.test(path)) return 'contains a backslash or NUL';
  for (const segment of path.split('/')) {
    if (segment === '') return 'contains an empty segment';
    if (segment === '.' || segment === '..') return `contains a "${segment}" segment`;
  }
  return undefined;
}

export function isProjectPath(path: string): path is ProjectPath {
  return path === '' || invalidReason(path) === undefined;
}

/** Joins validated segments: `joinProjectPath('a', 'b/c')` → `'a/b/c'`; `''` segments are skipped. */
export function joinProjectPath(...segments: ProjectPath[]): ProjectPath {
  const joined = segments.filter((segment) => segment !== '').join('/');
  assertProjectPath(joined);
  return joined;
}

/** Parent directory; the parent of a top-level entry is the root `''`. */
export function parentPath(path: ProjectPath): ProjectPath {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** Last segment (`''` for the root). */
export function baseName(path: ProjectPath): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** True when `path` is `ancestor` or lies below it. Every path is inside the root `''`. */
export function isSameOrInside(path: ProjectPath, ancestor: ProjectPath): boolean {
  return ancestor === '' || path === ancestor || path.startsWith(`${ancestor}/`);
}
