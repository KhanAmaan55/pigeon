/**
 * Native path helpers for desktop project locations (docs/platform.md §5.3). Core code only sees
 * POSIX project paths; conversion to the OS form happens here (and in Rust, which re-checks).
 */

import type { ProjectPath } from '@pigeon/platform';
import { assertProjectPath } from '@pigeon/platform';

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]?/;
const UNC = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/;

/** True for `C:\…`, `C:/…` and UNC (`\\server\share\…`) paths. */
export function isWindowsPath(path: string): boolean {
  return WINDOWS_DRIVE.test(path) || /^\\\\/.test(path);
}

/** The separator a native path uses. */
export function nativeSeparator(path: string): '\\' | '/' {
  return isWindowsPath(path) ? '\\' : '/';
}

/** Native absolute path of `projectPath` inside `root` (`''` = the root itself). */
export function toNativePath(root: string, projectPath: ProjectPath): string {
  assertProjectPath(projectPath);
  if (projectPath === '') return root;
  const separator = nativeSeparator(root);
  const trimmed = root.endsWith('/') || root.endsWith('\\') ? root.slice(0, -1) : root;
  return `${trimmed}${separator}${projectPath.split('/').join(separator)}`;
}

/**
 * Project path of `nativePath` when it lies inside `root`, else `undefined`. Windows paths are
 * compared case-insensitively, with either separator.
 */
export function fromNativePath(root: string, nativePath: string): ProjectPath | undefined {
  const windows = isWindowsPath(root);
  const normalize = (path: string) => {
    const unified = windows ? path.replace(/\\/g, '/') : path;
    const trimmed = unified.length > 1 && unified.endsWith('/') ? unified.slice(0, -1) : unified;
    return trimmed;
  };
  const base = normalize(root);
  const target = normalize(nativePath);
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (same(base, target)) return '';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  if (!same(target.slice(0, prefix.length), prefix)) return undefined;
  const relative = target.slice(prefix.length);
  return relative.split('/').some((s) => s === '' || s === '.' || s === '..')
    ? undefined
    : relative;
}

/** Last segment of a native path (the folder name shown for a project location). */
export function nativeBaseName(path: string): string {
  const unified = isWindowsPath(path) ? path.replace(/\\/g, '/') : path;
  const trimmed = unified.replace(/\/+$/, '');
  if (UNC.test(path) && trimmed.split('/').filter(Boolean).length <= 2) {
    return trimmed.split('/').filter(Boolean).join('\\');
  }
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed;
}
