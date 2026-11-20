import { afterEach, beforeEach, describe, it } from 'vitest';

import type { ProjectFileSystem } from '../fs';
import { fsConformanceCases } from './fs-cases';

export interface FsConformanceOptions {
  /** Releases whatever `createFs` allocated (temp folders, IndexedDB databases). */
  cleanup?: (fs: ProjectFileSystem) => void | Promise<void>;
}

/**
 * Registers `fsConformanceCases()` (docs/platform.md §2) with Vitest:
 * `fsConformance('MemoryFs', () => new MemoryFs())`. `createFs` must return an empty project.
 */
export function fsConformance(
  name: string,
  createFs: () => ProjectFileSystem | Promise<ProjectFileSystem>,
  opts: FsConformanceOptions = {},
): void {
  describe(`ProjectFileSystem conformance: ${name}`, () => {
    let fs: ProjectFileSystem;

    beforeEach(async () => {
      fs = await createFs();
    });
    afterEach(async () => {
      await opts.cleanup?.(fs);
    });

    for (const testCase of fsConformanceCases()) {
      it(testCase.name, () => testCase.run(fs));
    }
  });
}
