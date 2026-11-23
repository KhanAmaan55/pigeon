/**
 * The UI's `ScriptRunner` (PIGN-043): QuickJS in a Web Worker, so a busy script never blocks the
 * window. Only JSON crosses the boundary. QuickJS interrupts scripts at their deadline; if the
 * worker still doesn't answer (it hung), it is terminated and replaced. Without Worker support
 * (tests) scripts run inline in QuickJS.
 */

import type { ScriptRunInput, ScriptRunner, ScriptRunOutput } from '@pigeon/core';
import { createQuickJsRunner, SCRIPT_TIMEOUT_MS } from '@pigeon/core';

/** Extra time past a script's deadline before the worker is considered hung. */
const BACKSTOP_MS = 3000;

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, (output: ScriptRunOutput) => void>();
const inline = createQuickJsRunner();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') return (worker = null);
  try {
    worker = new Worker(new URL('./script.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return (worker = null);
  }
  worker.addEventListener(
    'message',
    (event: MessageEvent<{ id: number; output: ScriptRunOutput }>) => {
      pending.get(event.data.id)?.(event.data.output);
      pending.delete(event.data.id);
    },
  );
  worker.addEventListener('error', () => reset('The script sandbox failed to start.'));
  return worker;
}

function reset(message: string, reason: 'error' | 'timeout' = 'error') {
  for (const resolve of pending.values()) resolve({ ok: false, reason, message, logs: [] });
  pending.clear();
  worker?.terminate();
  worker = undefined;
}

export const workerScriptRunner: ScriptRunner = {
  run(input: ScriptRunInput): Promise<ScriptRunOutput> {
    const target = getWorker();
    if (!target) return inline.run(input);
    return new Promise((resolve) => {
      const id = ++nextId;
      const timeoutMs = input.timeoutMs ?? SCRIPT_TIMEOUT_MS;
      const backstop = setTimeout(
        () =>
          reset(
            `The script did not finish within ${timeoutMs / 1000} s and was stopped.`,
            'timeout',
          ),
        timeoutMs + BACKSTOP_MS,
      );
      pending.set(id, (output) => {
        clearTimeout(backstop);
        resolve(output);
      });
      target.postMessage({ id, input });
    });
  },
};
