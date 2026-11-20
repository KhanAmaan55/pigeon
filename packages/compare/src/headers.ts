/** Header comparison (docs/response-comparison.md §3.2). */

import type { Finding } from './types';

export type HeaderMode = 'media-type' | 'value' | 'presence';

export interface HeaderCompareOptions {
  /** Lowercase names to check (default `content-type`). */
  compare?: readonly string[];
  mode?: HeaderMode;
  ignore?: readonly string[];
  /** Web: some response headers are hidden by CORS, so a missing one is only a warning. */
  restricted?: boolean;
}

type Headers = ReadonlyArray<readonly [string, string]>;

function valueOf(headers: Headers, name: string): string | undefined {
  const values = headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
  return values.length === 0 ? undefined : values.join(', ');
}

/** `type/subtype` of a media type (parameters such as charset dropped). */
export function mediaTypeOf(value: string): string {
  return (value.split(';')[0] ?? '').trim().toLowerCase();
}

export function compareHeaders(
  baseline: Headers,
  actual: Headers,
  options: HeaderCompareOptions = {},
): Finding[] {
  const mode = options.mode ?? 'media-type';
  const ignore = new Set((options.ignore ?? []).map((name) => name.toLowerCase()));
  const names = [
    ...new Set((options.compare ?? ['content-type']).map((name) => name.toLowerCase())),
  ].filter((name) => !ignore.has(name));
  const findings: Finding[] = [];
  for (const name of names) {
    const before = valueOf(baseline, name);
    const after = valueOf(actual, name);
    if (before !== undefined && after === undefined) {
      findings.push({
        kind: 'header.missing',
        path: name,
        severity: options.restricted ? 'warn' : 'fail',
        baseline: before,
        message: options.restricted
          ? `Header ${name} missing (it may be hidden by the browser: CORS exposes only some headers)`
          : `Header ${name} missing (was ${before})`,
      });
    } else if (before === undefined && after !== undefined) {
      findings.push({
        kind: 'header.added',
        path: name,
        severity: 'info',
        actual: after,
        message: `Header ${name} added (${after})`,
      });
    } else if (before !== undefined && after !== undefined) {
      const changed =
        mode === 'presence'
          ? false
          : mode === 'media-type'
            ? mediaTypeOf(before) !== mediaTypeOf(after)
            : before !== after;
      if (changed) {
        findings.push({
          kind: 'header.changed',
          path: name,
          severity: 'fail',
          baseline: before,
          actual: after,
          message: `Header ${name} changed: ${before} → ${after}`,
        });
      }
    }
  }
  return findings;
}
