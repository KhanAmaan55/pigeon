/** Compares big responses off the main thread (see ./run-compare.ts). */

import type { BodyComparisonInput, EffectiveComparison } from '@pigeon/core';
import { compareResponseInput } from '@pigeon/core';

type Effective = Pick<EffectiveComparison, 'status' | 'headers' | 'body' | 'rules'>;

self.addEventListener(
  'message',
  (event: MessageEvent<{ id: number; input: BodyComparisonInput; effective: Effective }>) => {
    const { id, input, effective } = event.data;
    self.postMessage({ id, findings: compareResponseInput(input, effective) });
  },
);
