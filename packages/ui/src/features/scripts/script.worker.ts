/** Runs scripts in QuickJS off the main thread (see ./run-script.ts, PIGN-043). */

import type { ScriptRunInput } from '@pigeon/core';
import { createQuickJsRunner } from '@pigeon/core';

const runner = createQuickJsRunner();

self.addEventListener('message', (event: MessageEvent<{ id: number; input: ScriptRunInput }>) => {
  const { id, input } = event.data;
  void runner.run(input).then(
    (output) => self.postMessage({ id, output }),
    (error: unknown) =>
      self.postMessage({
        id,
        output: {
          ok: false,
          reason: 'error',
          message: error instanceof Error ? error.message : String(error),
          logs: [],
        },
      }),
  );
});
