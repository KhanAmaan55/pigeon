/** Status comparison (docs/response-comparison.md §3.1). */

import type { Finding } from './types';

export type StatusMode = 'exact' | 'class' | 'ignore';

export function compareStatus(
  baseline: number,
  actual: number,
  mode: StatusMode = 'exact',
): Finding[] {
  if (mode === 'ignore') return [];
  const same =
    mode === 'class'
      ? Math.floor(baseline / 100) === Math.floor(actual / 100)
      : baseline === actual;
  if (same) return [];
  return [
    {
      kind: 'status.changed',
      severity: 'fail',
      baseline,
      actual,
      message:
        mode === 'class'
          ? `Status class changed: ${Math.floor(baseline / 100)}xx → ${Math.floor(actual / 100)}xx (${baseline} → ${actual})`
          : `Status changed: ${baseline} → ${actual}`,
    },
  ];
}
