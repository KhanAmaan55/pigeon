/**
 * Read-only Git status of a project folder (PIGN-057, docs/platform.md §5.1). Desktop only:
 * Pigeon never writes to a repository; this reads the branch and which project files differ
 * from `HEAD`, and whether Git ignores the project folder, through the user's installed `git`.
 */

import type { ProjectLocation } from './fs';

/**
 * `modified`: changes not staged (in the working tree); `staged`: only staged changes;
 * `untracked`: new, not in Git; `conflicted`: an unresolved merge.
 */
export type GitFileState = 'modified' | 'staged' | 'untracked' | 'conflicted';

export interface GitFileStatus {
  /** Project-relative, `/`-separated. */
  path: string;
  state: GitFileState;
  deleted: boolean;
  /** Renames: the project-relative path before. */
  from?: string;
}

export interface GitStatus {
  /** `git` is installed (false: the feature stays hidden). */
  available: boolean;
  /** `null` when the project folder is not inside a Git work tree. */
  repository: {
    /** `null` when HEAD is detached. */
    branch: string | null;
    files: GitFileStatus[];
    /** The project folder's path inside the repository, `/`-separated, ending in `/` (`''` at the root). */
    path: string;
    /**
     * The project folder (itself or a parent, e.g. a gitignored `dist/`) is ignored by Git
     * (`git check-ignore`): its files are never committed (PIGN-061).
     */
    ignored: boolean;
  } | null;
}

export interface GitStatusReader {
  status(root: ProjectLocation): Promise<GitStatus>;
}

/** For tests: answers `result` (settable) and counts calls. */
export class MemoryGitStatus implements GitStatusReader {
  result: GitStatus = { available: true, repository: null };
  calls = 0;

  async status(): Promise<GitStatus> {
    this.calls += 1;
    return structuredClone(this.result);
  }
}
