import { describe, expect, it } from 'vitest';

import { formatPath, keySegment, matchPath, parsePath, toSchemaPath } from '../src/index';

describe('paths (response-comparison §4.6)', () => {
  it('formats keys as .name or ["…"]', () => {
    expect(keySegment('id')).toBe('.id');
    expect(keySegment('a.b')).toBe('["a.b"]');
    expect(keySegment('with "quote"')).toBe('["with \\"quote\\""]');
    expect(keySegment('9lives')).toBe('["9lives"]');
  });

  it('parses and formats every segment kind', () => {
    const pattern = '$.a["b.c"][3][*].*..id';
    expect(parsePath(pattern)).toEqual([
      { kind: 'key', key: 'a' },
      { kind: 'key', key: 'b.c' },
      { kind: 'index', index: 3 },
      { kind: 'anyIndex' },
      { kind: 'anyKey' },
      { kind: 'descendant', key: 'id' },
    ]);
    expect(formatPath(parsePath(pattern))).toBe(pattern);
    expect(toSchemaPath('$.items[3].tags[0]')).toBe('$.items[*].tags[*]');
    expect(() => parsePath('items')).toThrow();
    expect(() => parsePath('$.a[x]')).toThrow();
  });

  it.each([
    ['$', '$', true],
    ['$.items[*].id', '$.items[3].id', true],
    ['$.items[*].id', '$.items[*].id', true],
    ['$.items[2].id', '$.items[3].id', false],
    ['$.*.id', '$.user.id', true],
    ['$.*.id', '$.user.name', false],
    ['$..requestId', '$.data.meta.requestId', true],
    ['$..requestId', '$.requestId', true],
    ['$..requestId', '$.data.requestIds', false],
    ['$.a..id', '$.a.b[0].id', true],
    ['$["a.b"]', '$["a.b"]', true],
    ['$.meta', '$.meta.createdAt', false],
  ] as const)('%s matches %s: %s', (pattern, path, expected) => {
    expect(matchPath(pattern, path)).toBe(expected);
  });

  it('matches descendants with orBelow', () => {
    expect(matchPath('$.meta', '$.meta.createdAt', { orBelow: true })).toBe(true);
    expect(matchPath('$.meta', '$.metadata', { orBelow: true })).toBe(false);
  });
});
