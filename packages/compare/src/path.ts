/**
 * Paths (docs/response-comparison.md §4.6): concrete finding paths (`$.items[3]["a.b"]`),
 * schema paths with `[*]` for indices, and patterns (`$`, `.name`, `["na.me"]`, `[n]`, `[*]`,
 * `.*`, `..name`) that field rules (PIGN-035) match against concrete paths.
 */

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `.name`, or `["na.me"]` for keys that aren't plain identifiers. */
export function keySegment(key: string): string {
  return IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

export type PathSegment =
  | { kind: 'key'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'anyIndex' }
  | { kind: 'anyKey' }
  | { kind: 'descendant'; key: string };

/** Parses a path or pattern (`$` first); throws on malformed input. */
export function parsePath(path: string): PathSegment[] {
  if (!path.startsWith('$')) throw new Error(`A path starts with "$": ${path}`);
  const segments: PathSegment[] = [];
  let i = 1;
  const fail = (): never => {
    throw new Error(`Invalid path at ${i}: ${path}`);
  };
  while (i < path.length) {
    if (path.startsWith('..', i)) {
      i += 2;
      const name = /^[^.[\]]+/.exec(path.slice(i))?.[0] ?? fail();
      segments.push({ kind: 'descendant', key: name });
      i += name.length;
    } else if (path[i] === '.') {
      i += 1;
      if (path[i] === '*') {
        segments.push({ kind: 'anyKey' });
        i += 1;
      } else {
        const name = /^[^.[\]]+/.exec(path.slice(i))?.[0] ?? fail();
        segments.push({ kind: 'key', key: name });
        i += name.length;
      }
    } else if (path[i] === '[') {
      if (path.startsWith('[*]', i)) {
        segments.push({ kind: 'anyIndex' });
        i += 3;
      } else if (path[i + 1] === '"') {
        // A JSON string up to the closing quote (escapes allowed).
        let end = i + 2;
        while (end < path.length && path[end] !== '"') end += path[end] === '\\' ? 2 : 1;
        if (path[end + 1] !== ']') fail();
        segments.push({ kind: 'key', key: JSON.parse(path.slice(i + 1, end + 1)) as string });
        i = end + 2;
      } else {
        const digits = /^\[(\d+)\]/.exec(path.slice(i)) ?? fail();
        segments.push({ kind: 'index', index: Number(digits![1]) });
        i += digits![0].length;
      }
    } else {
      fail();
    }
  }
  return segments;
}

/** `$` + segments, in the canonical form findings use. */
export function formatPath(segments: readonly PathSegment[]): string {
  return segments.reduce((path, segment) => {
    switch (segment.kind) {
      case 'key':
        return path + keySegment(segment.key);
      case 'index':
        return `${path}[${segment.index}]`;
      case 'anyIndex':
        return `${path}[*]`;
      case 'anyKey':
        return `${path}.*`;
      case 'descendant':
        return `${path}..${segment.key}`;
    }
  }, '$');
}

/** The schema path of a concrete path: every index becomes `[*]`. */
export function toSchemaPath(path: string): string {
  return formatPath(
    parsePath(path).map((segment) => (segment.kind === 'index' ? { kind: 'anyIndex' } : segment)),
  );
}

/**
 * Whether `pattern` matches the concrete `path`. With `orBelow`, a match of a prefix of `path`
 * counts too (rules such as `ignore` cover a field and everything inside it).
 */
export function matchPath(
  pattern: string,
  path: string,
  options: { orBelow?: boolean } = {},
): boolean {
  const want = parsePath(pattern);
  const have = parsePath(path);
  // Memoized (pattern index, path index) search; `..name` may skip any number of segments.
  const memo = new Map<number, boolean>();
  const match = (p: number, h: number): boolean => {
    const id = p * (have.length + 1) + h;
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (p === want.length) result = h === have.length || options.orBelow === true;
    else if (h === have.length) result = false;
    else {
      const segment = want[p]!;
      const actual = have[h]!;
      switch (segment.kind) {
        case 'key':
          result = actual.kind === 'key' && actual.key === segment.key && match(p + 1, h + 1);
          break;
        case 'index':
          result = actual.kind === 'index' && actual.index === segment.index && match(p + 1, h + 1);
          break;
        case 'anyIndex':
          result = (actual.kind === 'index' || actual.kind === 'anyIndex') && match(p + 1, h + 1);
          break;
        case 'anyKey':
          result = actual.kind === 'key' && match(p + 1, h + 1);
          break;
        case 'descendant':
          result =
            (actual.kind === 'key' && actual.key === segment.key && match(p + 1, h + 1)) ||
            match(p, h + 1);
          break;
      }
    }
    memo.set(id, result);
    return result;
  };
  return match(0, 0);
}
