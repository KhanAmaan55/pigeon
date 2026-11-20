/** Maps imported files off the main thread (see ./run-import.ts). */

import { previewImportFile } from '@pigeon/core';

self.addEventListener(
  'message',
  (event: MessageEvent<{ id: number; bytes: Uint8Array; usedIds: string[] }>) => {
    const { id, bytes, usedIds } = event.data;
    self.postMessage({ id, preview: previewImportFile(bytes, new Set(usedIds)) });
  },
);
