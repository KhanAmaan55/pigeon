/**
 * `compareResponseInput` for the response viewer. Bodies over `WORKER_THRESHOLD` are parsed and
 * compared in a Web Worker (./compare.worker.ts) so typing stays responsive; without Worker
 * support (tests, a worker blocked by CSP) it runs inline after yielding a frame.
 */

import type { BodyComparisonInput, EffectiveComparison, Finding } from '@pigeon/core';
import { compareResponseInput } from '@pigeon/core';

export const WORKER_THRESHOLD = 256 * 1024;

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (findings: Finding[]) => void; fallback: () => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') return (worker = null);
  try {
    worker = new Worker(new URL('./compare.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return (worker = null);
  }
  worker.addEventListener('message', (event: MessageEvent<{ id: number; findings: Finding[] }>) => {
    pending.get(event.data.id)?.resolve(event.data.findings);
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

export function runBodyComparison(
  input: BodyComparisonInput,
  effective: Pick<EffectiveComparison, 'status' | 'headers' | 'body' | 'rules'>,
): Promise<Finding[]> {
  const inline = () =>
    new Promise<Finding[]>((resolve) =>
      setTimeout(() => resolve(compareResponseInput(input, effective)), 0),
    );
  const size = (input.baselineText?.length ?? 0) + (input.actualText?.length ?? 0);
  const target = size > WORKER_THRESHOLD ? getWorker() : null;
  if (!target) return inline();
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, { resolve, fallback: () => void inline().then(resolve) });
    target.postMessage({
      id,
      input,
      effective: {
        status: effective.status,
        headers: effective.headers,
        body: effective.body,
        rules: [...effective.rules],
      },
    });
  });
}
