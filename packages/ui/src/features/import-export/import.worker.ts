/** Maps imported files off the main thread (see ./run-import.ts). */

import type { ImportContext } from '@pigeon/core';
import { previewImportFiles } from '@pigeon/core';

self.addEventListener(
  'message',
  (
    event: MessageEvent<{
      id: number;
      files: Array<{ name: string; bytes: Uint8Array }>;
      context: { usedIds: string[]; environments: ImportContext['environments'] };
    }>,
  ) => {
    const { id, files, context } = event.data;
    self.postMessage({
      id,
      items: previewImportFiles(files, { ...context, usedIds: new Set(context.usedIds) }),
    });
  },
);
