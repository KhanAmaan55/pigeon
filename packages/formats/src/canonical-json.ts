/** A property path; array positions are intentionally omitted. */
export type KeyOrderPath = readonly string[];

/**
 * Describes canonical key ordering for a family of JSON objects.
 *
 * `kindForPath` receives the path from the document root to the object being
 * written. It lets a file format give, for example, `request.url` a different
 * order from `request` without putting type markers into serialized JSON.
 */
export interface KeyOrderSpec {
  readonly kinds: Readonly<Record<string, readonly string[]>>;
  readonly kindForPath: (path: KeyOrderPath) => string | undefined;
}

export interface CanonicalJsonOptions {
  readonly keyOrder?: KeyOrderSpec;
}

type JsonObject = Record<string, unknown>;

/**
 * Serializes JSON with stable object key ordering and a single final LF.
 * Undefined object properties are omitted, matching `JSON.stringify`; array
 * elements that are undefined are written as `null`, also matching it.
 */
export function stringifyCanonical(value: unknown, options: CanonicalJsonOptions = {}): string {
  const activeObjects = new Set<object>();
  const body = serialize(value, [], 0, options.keyOrder, activeObjects, false);

  if (body === undefined) {
    throw new TypeError('Cannot stringify undefined at the document root');
  }

  return `${body}\n`;
}

function serialize(
  value: unknown,
  path: readonly string[],
  depth: number,
  keyOrder: KeyOrderSpec | undefined,
  activeObjects: Set<object>,
  inArray: boolean,
): string | undefined {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return inArray ? 'null' : undefined;
  }

  if (value === null || typeof value !== 'object') {
    const primitive = JSON.stringify(value);
    if (primitive === undefined) {
      return inArray ? 'null' : undefined;
    }
    return primitive;
  }

  if (activeObjects.has(value)) {
    throw new TypeError('Cannot stringify circular JSON value');
  }

  activeObjects.add(value);
  try {
    if (Array.isArray(value)) {
      return serializeArray(value, path, depth, keyOrder, activeObjects);
    }

    return serializeObject(value, path, depth, keyOrder, activeObjects);
  } finally {
    activeObjects.delete(value);
  }
}

function serializeArray(
  values: readonly unknown[],
  path: readonly string[],
  depth: number,
  keyOrder: KeyOrderSpec | undefined,
  activeObjects: Set<object>,
): string {
  if (values.length === 0) return '[]';

  const indent = '  '.repeat(depth);
  const childIndent = '  '.repeat(depth + 1);
  const entries = values.map((entry) => {
    const serialized = serialize(entry, path, depth + 1, keyOrder, activeObjects, true);
    // An array serialization always has a value, but keep this defensive for future changes.
    return `${childIndent}${serialized ?? 'null'}`;
  });
  return `[\n${entries.join(',\n')}\n${indent}]`;
}

function serializeObject(
  value: object,
  path: readonly string[],
  depth: number,
  keyOrder: KeyOrderSpec | undefined,
  activeObjects: Set<object>,
): string {
  const object = value as JsonObject;
  const keys = Object.keys(object).filter((key) => object[key] !== undefined);
  if (keys.length === 0) return '{}';

  const indent = '  '.repeat(depth);
  const childIndent = '  '.repeat(depth + 1);
  const orderedKeys = orderKeys(keys, path, keyOrder);
  const entries = orderedKeys.map((key) => {
    const serialized = serialize(object[key], [...path, key], depth + 1, keyOrder, activeObjects, false);
    // `undefined` keys were filtered before sorting.
    return `${childIndent}${JSON.stringify(key)}: ${serialized ?? 'null'}`;
  });
  return `{\n${entries.join(',\n')}\n${indent}}`;
}

function orderKeys(keys: readonly string[], path: KeyOrderPath, keyOrder: KeyOrderSpec | undefined): string[] {
  const kind = keyOrder?.kindForPath(path);
  const knownKeys = kind === undefined ? undefined : keyOrder?.kinds[kind];
  const rank = new Map<string, number>();
  knownKeys?.forEach((key, index) => {
    if (key !== '_pigeon') rank.set(key, index);
  });

  return [...keys].sort((left, right) => {
    if (left === '_pigeon') return right === '_pigeon' ? 0 : 1;
    if (right === '_pigeon') return -1;

    const leftRank = rank.get(left);
    const rightRank = rank.get(right);
    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) return 1;
      if (rightRank === undefined) return -1;
      return leftRank - rightRank;
    }

    return compareCodePoints(left, right);
  });
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const comparison = (leftPoints[index] ?? '').codePointAt(0)! - (rightPoints[index] ?? '').codePointAt(0)!;
    if (comparison !== 0) return comparison;
  }

  return leftPoints.length - rightPoints.length;
}
