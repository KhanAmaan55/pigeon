/**
 * `previewImportFile` for the import dialog. Files over `WORKER_THRESHOLD` are mapped in a Web
 * Worker (./import.worker.ts) so the window stays responsive; without Worker support (tests, a
 * worker blocked by CSP) it runs inline after yielding a frame for the progress indicator.
 */

import type { ImportContext, ImportItem } from '@pigeon/core';
import { previewImportFiles } from '@pigeon/core';

export const WORKER_THRESHOLD = 512 * 1024;

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (items: ImportItem[]) => void; fallback: () => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') return (worker = null);
  try {
    worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return (worker = null);
  }
  worker.addEventListener('message', (event: MessageEvent<{ id: number; items: ImportItem[] }>) => {
    pending.get(event.data.id)?.resolve(event.data.items);
    pending.delete(event.data.id);
  });
  worker.addEventListener('error', () => {
    for (const job of pending.values()) job.fallback();
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

export function runImportPreview(
  files: ReadonlyArray<{ name: string; bytes: Uint8Array }>,
  context: ImportContext,
): Promise<ImportItem[]> {
  const inline = () =>
    new Promise<ImportItem[]>((resolve) =>
      setTimeout(() => resolve(previewImportFiles(files, context)), 0),
    );
  const size = files.reduce((total, file) => total + file.bytes.byteLength, 0);
  const target = size > WORKER_THRESHOLD ? getWorker() : null;
  if (!target) return inline();
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, { resolve, fallback: () => void inline().then(resolve) });
    target.postMessage({
      id,
      files,
      context: { usedIds: [...context.usedIds], environments: context.environments },
    });
  });
}
