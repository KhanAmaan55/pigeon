/**
 * Value comparison (docs/response-comparison.md §4.4, `body.mode: 'values'`): on top of the
 * structural findings, scalars must be equal. Arrays: `index` compares element i with element i
 * (a length difference fails), `{ matchBy }` pairs elements by a key, `schema` skips values.
 * Type differences are left to the structural comparator. Iterative.
 */

import { dynamicHint } from './hints';
import { keySegment } from './path';
import type { Finding, ValueCompareOptions } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function kindOf(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

function show(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export function compareValues(
  baseline: unknown,
  actual: unknown,
  options: ValueCompareOptions = {},
): Finding[] {
  const arrays = options.arrays ?? 'index';
  const findings: Finding[] = [];
  const stack: Array<{ before: unknown; after: unknown; path: string; schemaPath: string }> = [
    { before: baseline, after: actual, path: '$', schemaPath: '$' },
  ];
  while (stack.length > 0) {
    const { before, after, path, schemaPath } = stack.pop()!;
    if (kindOf(before) !== kindOf(after)) continue; // a type change: structural finding
    if (Array.isArray(before) && Array.isArray(after)) {
      if (arrays === 'schema') continue;
      if (arrays === 'index') {
        if (before.length !== after.length) {
          findings.push({
            kind: 'body.array.length',
            path,
            schemaPath,
            severity: 'fail',
            baseline: before.length,
            actual: after.length,
            message: `Array length changed: ${before.length} → ${after.length}`,
          });
        }
        for (let i = Math.min(before.length, after.length) - 1; i >= 0; i--) {
          stack.push({
            before: before[i],
            after: after[i],
            path: `${path}[${i}]`,
            schemaPath: `${schemaPath}[*]`,
          });
        }
        continue;
      }
      const key = arrays.matchBy;
      const byKey = new Map<string, { value: unknown; index: number }>();
      before.forEach((value, index) => {
        if (isPlainObject(value) && value[key] !== undefined)
          byKey.set(JSON.stringify(value[key]), { value, index });
      });
      const matched = new Set<number>();
      for (let i = after.length - 1; i >= 0; i--) {
        const value = after[i];
        const id =
          isPlainObject(value) && value[key] !== undefined ? JSON.stringify(value[key]) : undefined;
        const match = id === undefined ? undefined : byKey.get(id);
        if (!match) {
          findings.push({
            kind: 'body.field.added',
            path: `${path}[${i}]`,
            schemaPath: `${schemaPath}[*]`,
            severity: 'fail',
            actual: id === undefined ? undefined : JSON.parse(id),
            message: `Element added (${key} = ${id ?? 'missing'})`,
          });
          continue;
        }
        matched.add(match.index);
        stack.push({
          before: match.value,
          after: value,
          path: `${path}[${i}]`,
          schemaPath: `${schemaPath}[*]`,
        });
      }
      for (const [id, entry] of byKey) {
        if (matched.has(entry.index)) continue;
        findings.push({
          kind: 'body.field.removed',
          path: `${path}[${entry.index}]`,
          schemaPath: `${schemaPath}[*]`,
          severity: 'fail',
          baseline: JSON.parse(id),
          message: `Element removed (${key} = ${id})`,
        });
      }
      continue;
    }
    if (isPlainObject(before) && isPlainObject(after)) {
      for (const key of Object.keys(before)) {
        if (!Object.hasOwn(after, key)) continue; // removed: structural finding
        stack.push({
          before: before[key],
          after: after[key],
          path: path + keySegment(key),
          schemaPath: schemaPath + keySegment(key),
        });
      }
      continue;
    }
    if (before !== after) {
      const hint = dynamicHint(after) ?? dynamicHint(before);
      findings.push({
        kind: 'body.value.changed',
        path,
        schemaPath,
        severity: 'fail',
        baseline: before,
        actual: after,
        message: `Value changed: ${show(before)} → ${show(after)}`,
        ...(hint ? { hint } : {}),
      });
    }
  }
  return findings;
}
