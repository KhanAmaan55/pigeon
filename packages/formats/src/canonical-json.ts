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

interface Context {
  readonly keyOrder: KeyOrderSpec | undefined;
  readonly active: Set<object>;
}

/**
 * Serializes JSON with stable object key ordering and a single final LF.
 * Values `JSON.stringify` would drop (undefined, functions, symbols) are
 * omitted from objects and written as `null` inside arrays, matching it.
 */
export function stringifyCanonical(value: unknown, options: CanonicalJsonOptions = {}): string {
  const body = serialize(value, [], 0, { keyOrder: options.keyOrder, active: new Set() });
  if (body === undefined) {
    throw new TypeError('Cannot stringify undefined at the document root');
  }
  return `${body}\n`;
}

function serialize(
  value: unknown,
  path: KeyOrderPath,
  depth: number,
  context: Context,
): string | undefined {
  if (value === null || typeof value !== 'object') {
    // Returns undefined for undefined, functions and symbols.
    return JSON.stringify(value) as string | undefined;
  }

  if (context.active.has(value)) {
    throw new TypeError('Cannot stringify circular JSON value');
  }

  context.active.add(value);
  try {
    return Array.isArray(value)
      ? serializeArray(value, path, depth, context)
      : serializeObject(value as JsonObject, path, depth, context);
  } finally {
    context.active.delete(value);
  }
}

function serializeArray(
  values: readonly unknown[],
  path: KeyOrderPath,
  depth: number,
  context: Context,
): string {
  if (values.length === 0) return '[]';
  const childIndent = '  '.repeat(depth + 1);
  const entries = values.map(
    (entry) => `${childIndent}${serialize(entry, path, depth + 1, context) ?? 'null'}`,
  );
  return `[\n${entries.join(',\n')}\n${'  '.repeat(depth)}]`;
}

function serializeObject(
  object: JsonObject,
  path: KeyOrderPath,
  depth: number,
  context: Context,
): string {
  const childIndent = '  '.repeat(depth + 1);
  const entries: string[] = [];
  for (const key of orderKeys(Object.keys(object), path, context.keyOrder)) {
    const serialized = serialize(object[key], [...path, key], depth + 1, context);
    if (serialized !== undefined)
      entries.push(`${childIndent}${JSON.stringify(key)}: ${serialized}`);
  }
  if (entries.length === 0) return '{}';
  return `{\n${entries.join(',\n')}\n${'  '.repeat(depth)}}`;
}

function orderKeys(
  keys: readonly string[],
  path: KeyOrderPath,
  keyOrder: KeyOrderSpec | undefined,
): string[] {
  const kind = keyOrder?.kindForPath(path);
  const knownKeys = (kind === undefined ? undefined : keyOrder?.kinds[kind]) ?? [];
  const rank = new Map<string, number>();
  knownKeys.forEach((key, index) => rank.set(key, index));
  // `_pigeon` always sorts last, whatever the spec says.
  rank.delete('_pigeon');

  const rankOf = (key: string): number =>
    key === '_pigeon' ? Number.POSITIVE_INFINITY : (rank.get(key) ?? Number.MAX_SAFE_INTEGER);

  return [...keys].sort(
    (left, right) => rankOf(left) - rankOf(right) || compareCodePoints(left, right),
  );
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (char) => char.codePointAt(0)!);
  const rightPoints = Array.from(right, (char) => char.codePointAt(0)!);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const comparison = leftPoints[index]! - rightPoints[index]!;
    if (comparison !== 0) return comparison;
  }
  return leftPoints.length - rightPoints.length;
}
