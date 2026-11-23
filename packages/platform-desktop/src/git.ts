/**
 * Read-only Git status on desktop (PIGN-057): the Rust `git_status` command, which runs only
 * allow-listed read-only invocations of the installed `git` for a granted project folder.
 */

import type { GitStatus, GitStatusReader, ProjectLocation } from '@pigeon/platform';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import type { Invoke } from './native-transport';

const NO_GIT: GitStatus = { available: false, repository: null };

export class DesktopGitStatus implements GitStatusReader {
  readonly #invoke: Invoke;

  constructor(opts: { invoke?: Invoke } = {}) {
    this.#invoke = opts.invoke ?? tauriInvoke;
  }

  async status(root: ProjectLocation): Promise<GitStatus> {
    if (root.kind !== 'native') return NO_GIT;
    return this.#invoke<GitStatus>('git_status', { root: root.absolutePath });
  }
}
