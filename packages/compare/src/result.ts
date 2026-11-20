import type { ComparisonSummary, Finding } from './types';

/** Outcome and counts (fail > warn > pass; `info` and `ignored` don't change the outcome). */
export function summarize(findings: readonly Finding[]): ComparisonSummary {
  const counts = { fail: 0, warn: 0, info: 0, ignored: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return {
    outcome: counts.fail > 0 ? 'fail' : counts.warn > 0 ? 'warn' : 'pass',
    counts,
  };
}
