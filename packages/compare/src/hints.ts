/**
 * Dynamic value hints (docs/response-comparison.md §5): values that usually change on every
 * call. Only a suggestion ("Mark as dynamic?"); never changes a severity.
 */

import type { DynamicHint } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const JWT = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const HEX = /^[0-9a-f]{24,}$/i;
/** 2001-09-09 … 2286-11-20 in seconds, or the same range in milliseconds. */
const SECONDS = [1_000_000_000, 9_999_999_999] as const;

export function dynamicHint(value: unknown): DynamicHint | undefined {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) return undefined;
    if (value >= SECONDS[0] && value <= SECONDS[1]) return 'unix-timestamp';
    if (value >= SECONDS[0] * 1000 && value <= SECONDS[1] * 1000) return 'unix-timestamp';
    return undefined;
  }
  if (typeof value !== 'string') return undefined;
  if (UUID.test(value)) return 'uuid';
  if (ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))) return 'iso-date';
  if (JWT.test(value)) return 'jwt';
  if (HEX.test(value)) return 'hex-token';
  return undefined;
}
