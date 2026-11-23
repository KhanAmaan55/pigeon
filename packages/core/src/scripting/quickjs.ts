/**
 * Runs a script in QuickJS (D-10, PIGN-043): a fresh runtime per script with a memory limit, a
 * stack limit and a deadline (an infinite loop is interrupted). The sandbox has only the
 * JavaScript built-ins plus `pm` and `console` from the prelude: no `fetch`, timers, DOM, Node
 * or Tauri APIs. QuickJS is loaded on first use (a separate chunk on the web).
 */

import type { InterruptHandler, QuickJSWASMModule } from 'quickjs-emscripten-core';

import { PRELUDE } from './prelude';
import type { ScriptRunInput, ScriptRunner, ScriptRunOutput, ScriptState } from './types';
import { SCRIPT_MEMORY_BYTES, SCRIPT_TIMEOUT_MS } from './types';

type Deadline = (ms: number) => InterruptHandler;

let loading: Promise<{ quickjs: QuickJSWASMModule; deadline: Deadline }> | undefined;

/** QuickJS core plus the one release build Pigeon uses, loaded on first use. */
function load(): Promise<{ quickjs: QuickJSWASMModule; deadline: Deadline }> {
  if (loading) return loading;
  loading = Promise.all([
    import('quickjs-emscripten-core'),
    import('@jitl/quickjs-wasmfile-release-sync'),
  ]).then(async ([core, variant]) => ({
    quickjs: await core.newQuickJSWASMModuleFromVariant(variant.default),
    deadline: (ms: number) => core.shouldInterruptAfterDeadline(ms),
  }));
  return loading;
}

interface Dumped {
  name?: string;
  message?: string;
  stack?: string;
}

export function createQuickJsRunner(): ScriptRunner {
  return {
    async run(input: ScriptRunInput): Promise<ScriptRunOutput> {
      const { quickjs, deadline } = await load();
      const timeoutMs = input.timeoutMs ?? SCRIPT_TIMEOUT_MS;
      const runtime = quickjs.newRuntime();
      runtime.setMemoryLimit(SCRIPT_MEMORY_BYTES);
      runtime.setMaxStackSize(1024 * 1024);
      runtime.setInterruptHandler(deadline(Date.now() + timeoutMs));
      const vm = runtime.newContext();
      let logs: ScriptRunOutput['logs'] = [];
      const evaluate = (
        code: string,
        file: string,
      ): { ok: true; value: unknown } | { ok: false; error: Dumped } => {
        const result = vm.evalCode(code, file);
        if (result.error) {
          const error = vm.dump(result.error) as Dumped;
          result.error.dispose();
          return {
            ok: false,
            error: typeof error === 'object' && error ? error : { message: String(error) },
          };
        }
        const value: unknown = vm.dump(result.value);
        result.value.dispose();
        return { ok: true, value };
      };
      const readLogs = () => {
        const dumped = evaluate(
          'JSON.stringify(typeof __logs === "undefined" ? [] : __logs)',
          'logs.js',
        );
        if (dumped.ok && typeof dumped.value === 'string')
          logs = JSON.parse(dumped.value) as typeof logs;
      };
      try {
        const setup = evaluate(
          `var __state = ${JSON.stringify(input.state)};\n${PRELUDE}`,
          'prelude.js',
        );
        if (!setup.ok) return failure(setup.error, logs, timeoutMs);
        // A function body, as in Postman (a top-level `return` ends the script).
        const ran = evaluate(`(function () {\n${input.code}\n})();`, 'script.js');
        // The deadline has passed after a timeout: reading the results must not be interrupted.
        runtime.removeInterruptHandler();
        readLogs();
        if (!ran.ok) return failure(ran.error, logs, timeoutMs);
        const out = evaluate('JSON.stringify(__state)', 'state.js');
        if (!out.ok || typeof out.value !== 'string') {
          return failure(
            out.ok ? { message: 'The script state could not be read' } : out.error,
            logs,
            timeoutMs,
          );
        }
        return { ok: true, state: JSON.parse(out.value) as ScriptState, logs };
      } finally {
        vm.dispose();
        runtime.dispose();
      }
    },
  };
}

function failure(error: Dumped, logs: ScriptRunOutput['logs'], timeoutMs: number): ScriptRunOutput {
  const message = error.message ?? String(error);
  if (/interrupted/i.test(message)) {
    return {
      ok: false,
      reason: 'timeout',
      message: `The script did not finish within ${timeoutMs / 1000} s and was stopped.`,
      logs,
    };
  }
  if (/out of memory/i.test(message)) {
    return { ok: false, reason: 'memory', message: 'The script ran out of memory.', logs };
  }
  const name = error.name && error.name !== 'Error' ? `${error.name}: ` : '';
  return { ok: false, reason: 'error', message: `${name}${message}`, logs };
}
