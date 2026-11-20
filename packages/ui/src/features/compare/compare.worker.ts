/** Compares big bodies off the main thread (see ./run-compare.ts). */

import type { BodyComparisonInput, BodyComparisonSettings, FieldRule } from '@pigeon/core';
import { compareBodyTexts } from '@pigeon/core';

self.addEventListener(
  'message',
  (
    event: MessageEvent<{
      id: number;
      input: BodyComparisonInput;
      settings: BodyComparisonSettings;
      rules: FieldRule[];
    }>,
  ) => {
    const { id, input, settings, rules } = event.data;
    self.postMessage({ id, findings: compareBodyTexts(input, settings, rules) });
  },
);
