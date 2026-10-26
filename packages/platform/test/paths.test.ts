import { describe, expect, it } from 'vitest';

import {
  assertProjectPath,
  baseName,
  FsError,
  isProjectPath,
  isSameOrInside,
  joinProjectPath,
  parentPath,
} from '../src/index';

describe('assertProjectPath', () => {
  it.each([
    '',
    'a',
    'a/b.json',
    'collections/users/get user.request.json',
    '.pigeon',
    'a..b',
    '日本語/é',
  ])('accepts %j', (path) => {
    expect(() => assertProjectPath(path)).not.toThrow();
    expect(isProjectPath(path)).toBe(true);
  });

  it.each([
    ['/etc/passwd', 'must be relative'],
    ['C:/Users', 'must be relative'],
    ['c:x', 'must be relative'],
    ['..', '".." segment'],
    ['a/../../b', '".." segment'],
    ['./a', '"." segment'],
    ['a/./b', '"." segment'],
    ['a//b', 'empty segment'],
    ['a/', 'empty segment'],
    ['a\\b', 'backslash'],
    ['..\\windows', 'backslash'],
    ['a\u0000b', 'NUL'],
  ])('rejects %j (%s)', (path, reason) => {
    expect(isProjectPath(path)).toBe(false);
    let error: unknown;
    try {
      assertProjectPath(path);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(FsError);
    expect(error).toMatchObject({ code: 'invalid-path', path });
    expect((error as Error).message).toContain(reason);
  });
});

describe('path helpers', () => {
  it('joins segments and skips the root', () => {
    expect(joinProjectPath('', 'a', 'b/c.json')).toBe('a/b/c.json');
    expect(joinProjectPath('')).toBe('');
    expect(() => joinProjectPath('a', '../b')).toThrow(FsError);
  });

  it('finds parents and base names', () => {
    expect(parentPath('a/b/c.json')).toBe('a/b');
    expect(parentPath('a')).toBe('');
    expect(baseName('a/b/c.json')).toBe('c.json');
    expect(baseName('a')).toBe('a');
  });

  it('checks containment by segment, not by prefix', () => {
    expect(isSameOrInside('a/b', 'a')).toBe(true);
    expect(isSameOrInside('a', 'a')).toBe(true);
    expect(isSameOrInside('ab', 'a')).toBe(false);
    expect(isSameOrInside('anything', '')).toBe(true);
  });
});
