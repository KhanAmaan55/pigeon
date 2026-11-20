/**
 * E2E-only hooks (docs/testing.md §3.9), compiled in only by `vite build --mode e2e`
 * (`VITE_PIGEON_TEST_HOOKS`). Never part of the production bundle.
 */

import type { Platform } from '@pigeon/platform';
import { MemoryFs, MemoryProjectLocator } from '@pigeon/platform';

export interface PigeonTestHooks {
  /** Puts `files` into an in-memory project that the next "Open folder" picks. */
  preloadProject(files: Record<string, string>): Promise<void>;
}

declare global {
  interface Window {
    __pigeonTest?: PigeonTestHooks;
  }
}

export function installTestHooks(platform: Platform): void {
  window.__pigeonTest = {
    async preloadProject(files) {
      if (!(platform.projects instanceof MemoryProjectLocator)) {
        throw new Error('preloadProject needs the memory project locator');
      }
      const fs = new MemoryFs();
      for (const [path, text] of Object.entries(files)) await fs.writeFileAtomic(path, text);
      platform.projects.pickResult = platform.projects.add(fs);
    },
  };
}
