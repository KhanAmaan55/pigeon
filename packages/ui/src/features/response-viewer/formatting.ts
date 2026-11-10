/**
 * Runs `formatSync` (./formatters.ts) for the Pretty view. Bodies over `WORKER_THRESHOLD` are
 * formatted in a Web Worker (./format.worker.ts) so the UI stays responsive; without Worker
 * support (tests, a worker blocked by CSP) it runs inline.
 */

import type { FormatRequest } from './formatters';
import { formatSync } from './formatters';

export type { FormatRequest } from './formatters';
export { formatMarkup, formatSync } from './formatters';

export const WORKER_THRESHOLD = 256 * 1024;

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (text: string) => void; fallback: () => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') return (worker = null);
  try {
    worker = new Worker(new URL('./format.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return (worker = null);
  }
  worker.addEventListener('message', (event: MessageEvent<{ id: number; text: string }>) => {
    pending.get(event.data.id)?.resolve(event.data.text);
    pending.delete(event.data.id);
  });
  worker.addEventListener('error', () => {
    // The worker is unusable (e.g. blocked by CSP): finish everything inline from now on.
    for (const job of pending.values()) job.fallback();
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

/** Formats off the main thread when the body is big enough to matter. */
export function formatBody(request: FormatRequest): Promise<string> {
  const target = request.text.length > WORKER_THRESHOLD ? getWorker() : null;
  if (!target) return Promise.resolve().then(() => formatSync(request));
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, { resolve, fallback: () => resolve(formatSync(request)) });
    target.postMessage({ id, ...request });
  });
}
