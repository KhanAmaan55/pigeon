import { describe, expect, it } from 'vitest';

import { fromNativePath, isWindowsPath, nativeBaseName, toNativePath } from '../src/paths';

describe('desktop path conversion', () => {
  it('joins project paths with the native separator', () => {
    expect(toNativePath('/Users/ada/my api', 'collections/users-api/a.request.json')).toBe(
      '/Users/ada/my api/collections/users-api/a.request.json',
    );
    expect(toNativePath('C:\\Users\\Ada\\My API', 'collections/users-api')).toBe(
      'C:\\Users\\Ada\\My API\\collections\\users-api',
    );
    expect(toNativePath('C:\\', 'pigeon.json')).toBe('C:\\pigeon.json');
    expect(toNativePath('\\\\server\\share\\repo', 'pigeon.json')).toBe(
      '\\\\server\\share\\repo\\pigeon.json',
    );
    expect(toNativePath('/root/', 'a')).toBe('/root/a');
    expect(toNativePath('/root', '')).toBe('/root');
    expect(() => toNativePath('/root', '../etc/passwd')).toThrow(/Invalid project path/);
    expect(() => toNativePath('C:\\root', 'a\\b')).toThrow(/Invalid project path/);
  });

  it('converts native paths inside the root back to project paths', () => {
    expect(fromNativePath('/Users/ada/api', '/Users/ada/api/collections/a.json')).toBe(
      'collections/a.json',
    );
    expect(fromNativePath('/Users/ada/api', '/Users/ada/api')).toBe('');
    expect(fromNativePath('/Users/ada/api', '/Users/ada/api2/x')).toBeUndefined();
    expect(fromNativePath('/Users/ada/api', '/Users/ada/API/x')).toBeUndefined();
    expect(fromNativePath('C:\\Repo\\api', 'c:\\repo\\API\\collections\\x.json')).toBe(
      'collections\\x.json'.replace('\\', '/'),
    );
    expect(fromNativePath('C:\\Repo\\api\\', 'C:/Repo/api/pigeon.json')).toBe('pigeon.json');
    expect(fromNativePath('\\\\srv\\share\\api', '\\\\srv\\share\\api\\a\\b')).toBe('a/b');
    expect(fromNativePath('/r', '/r/a/../b')).toBeUndefined();
  });

  it('recognizes Windows paths and names folders', () => {
    expect(isWindowsPath('C:\\x')).toBe(true);
    expect(isWindowsPath('d:/x')).toBe(true);
    expect(isWindowsPath('\\\\server\\share')).toBe(true);
    expect(isWindowsPath('/home/ada')).toBe(false);
    expect(nativeBaseName('/home/ada/my api/')).toBe('my api');
    expect(nativeBaseName('C:\\Users\\Ada\\Pigeon Project')).toBe('Pigeon Project');
    expect(nativeBaseName('\\\\server\\share')).toBe('server\\share');
    expect(nativeBaseName('/')).toBe('');
  });
});
