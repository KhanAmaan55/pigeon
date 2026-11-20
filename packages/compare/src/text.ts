/** Non-JSON bodies (docs/response-comparison.md §3.3 item 3). */

import type { Finding } from './types';

/** Text: exact equality in values mode; schema mode doesn't compare text (info). */
export function compareText(
  baseline: string,
  actual: string,
  mode: 'schema' | 'values',
): Finding[] {
  if (mode === 'schema') {
    return [
      {
        kind: 'body.value.changed',
        severity: 'info',
        message: 'Text body not compared structurally',
      },
    ];
  }
  if (baseline === actual) return [];
  const line = firstDifferentLine(baseline, actual);
  return [
    {
      kind: 'body.value.changed',
      severity: 'fail',
      message: `Text body changed (first difference on line ${line})`,
    },
  ];
}

/** Binary: equal hash and size in values mode; schema mode doesn't compare bytes (info). */
export function compareBinary(
  baseline: { hash: string; size: number },
  actual: { hash: string; size: number },
  mode: 'schema' | 'values',
): Finding[] {
  if (mode === 'schema') {
    return [
      {
        kind: 'body.value.changed',
        severity: 'info',
        message: 'Binary body not compared structurally',
      },
    ];
  }
  if (baseline.hash === actual.hash && baseline.size === actual.size) return [];
  return [
    {
      kind: 'body.value.changed',
      severity: 'fail',
      baseline: baseline.size,
      actual: actual.size,
      message: `Binary body changed (${baseline.size} → ${actual.size} bytes)`,
    },
  ];
}

function firstDifferentLine(a: string, b: string): number {
  const left = a.split('\n');
  const right = b.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) return i + 1;
  }
  return 1;
}
