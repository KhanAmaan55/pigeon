/**
 * `ProjectLocator` on desktop: native folder pickers in Rust (`project_pick_folder`,
 * `project_create`), which also grant the webview access to the chosen folder; the grant is
 * persisted, so recent projects reopen without picking again (`project_reopen`).
 */

import type { ProjectFileSystem, ProjectLocation, ProjectLocator } from '@pigeon/platform';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import type { Invoke } from './native-transport';
import { TauriFs } from './tauri-fs';

export class DesktopProjectLocator implements ProjectLocator {
  readonly #invoke: Invoke;

  constructor(opts: { invoke?: Invoke } = {}) {
    this.#invoke = opts.invoke ?? tauriInvoke;
  }

  async pickProjectFolder(): Promise<ProjectLocation | null> {
    const path = await this.#invoke<string | null>('project_pick_folder');
    return path === null ? null : { kind: 'native', absolutePath: path };
  }

  async createProject(name: string): Promise<ProjectLocation | null> {
    const path = await this.#invoke<string | null>('project_create', { name });
    return path === null ? null : { kind: 'native', absolutePath: path };
  }

  async reopen(loc: ProjectLocation): Promise<'ok' | 'needs-permission' | 'missing'> {
    if (loc.kind !== 'native') return 'missing';
    return await this.#invoke<'ok' | 'needs-permission' | 'missing'>('project_reopen', {
      root: loc.absolutePath,
    });
  }

  open(loc: ProjectLocation): ProjectFileSystem {
    if (loc.kind !== 'native') throw new Error(`Desktop cannot open a ${loc.kind} project.`);
    return new TauriFs(loc.absolutePath, { invoke: this.#invoke });
  }
}
