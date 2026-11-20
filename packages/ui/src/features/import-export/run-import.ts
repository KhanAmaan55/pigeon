/**
 * `previewImportFile` for the import dialog. Files over `WORKER_THRESHOLD` are mapped in a Web
 * Worker (./import.worker.ts) so the window stays responsive; without Worker support (tests, a
 * worker blocked by CSP) it runs inline after yielding a frame for the progress indicator.
 */

import type { ImportPreview } from '@pigeon/core';
import { previewImportFile } from '@pigeon/core';

export const WORKER_THRESHOLD = 512 * 1024;

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (preview: ImportPreview) => void; fallback: () => void }
>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') return (worker = null);
  try {
    worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return (worker = null);
  }
  worker.addEventListener(
    'message',
    (event: MessageEvent<{ id: number; preview: ImportPreview }>) => {
      pending.get(event.data.id)?.resolve(event.data.preview);
      pending.delete(event.data.id);
    },
  );
  worker.addEventListener('error', () => {
    for (const job of pending.values()) job.fallback();
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

export function runImportPreview(
  bytes: Uint8Array,
  usedIds: ReadonlySet<string>,
): Promise<ImportPreview> {
  const inline = () =>
    new Promise<ImportPreview>((resolve) =>
      setTimeout(() => resolve(previewImportFile(bytes, usedIds)), 0),
    );
  const target = bytes.byteLength > WORKER_THRESHOLD ? getWorker() : null;
  if (!target) return inline();
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, { resolve, fallback: () => void inline().then(resolve) });
    target.postMessage({ id, bytes, usedIds: [...usedIds] });
  });
}
