/** Compares big bodies off the main thread (see ./run-compare.ts). */

import type { BodyComparisonInput, BodyComparisonSettings } from '@pigeon/core';
import { compareBodyTexts } from '@pigeon/core';

self.addEventListener(
  'message',
  (
    event: MessageEvent<{
      id: number;
      input: BodyComparisonInput;
      settings: BodyComparisonSettings;
    }>,
  ) => {
    const { id, input, settings } = event.data;
    self.postMessage({ id, findings: compareBodyTexts(input, settings) });
  },
);
