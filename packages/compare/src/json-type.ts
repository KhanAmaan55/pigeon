import type { JsonType } from './types';

/** The JSON type of `value`; with `distinguishIntegers`, whole numbers are `integer`. */
export function jsonTypeOf(value: unknown, distinguishIntegers = false): JsonType {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'boolean':
      return 'boolean';
    case 'number':
    case 'bigint':
      return distinguishIntegers && Number.isInteger(value as number) ? 'integer' : 'number';
    case 'string':
      return 'string';
    default:
      return 'object';
  }
}

/** `string`, `string or null`, … for messages. */
export function describeTypes(types: readonly JsonType[]): string {
  return types.length <= 1
    ? (types[0] ?? 'nothing')
    : `${types.slice(0, -1).join(', ')} or ${types.at(-1)}`;
}
