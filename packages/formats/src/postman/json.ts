/** Small helpers for tolerant reading of untyped JSON. */

import type { Description } from '../project/types';

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function nonEmpty(value: JsonObject): boolean {
  return Object.keys(value).length > 0;
}

export function isDescription(value: unknown): value is Description {
  return (
    typeof value === 'string' ||
    (isObject(value) &&
      typeof value['content'] === 'string' &&
      (value['type'] === undefined || typeof value['type'] === 'string'))
  );
}

/** A copy of `value` without `keys`. */
export function without(value: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

/** UTF-16 code-unit order, independent of the runtime locale (file keys are ASCII). */
export function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
