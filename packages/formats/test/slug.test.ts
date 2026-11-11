import { describe, expect, it } from 'vitest';

import { allocateSlug, slugify } from '../src/slug';

describe('slugify', () => {
  const options = { kind: 'request', id: 'c9d2a1b0-0000-0000-0000-000000000000' };

  it('normalizes names to lowercase ASCII hyphenated keys', () => {
    expect(slugify('Get User!', options)).toBe('get-user');
    expect(slugify('Café au lait', options)).toBe('cafe-au-lait');
  });

  it('uses a portable fallback for names without Latin letters', () => {
    expect(slugify('ユーザー取得', options)).toBe('request-c9d2a1b0');
  });

  it('avoids Windows device names', () => {
    expect(slugify('CON', options)).toBe('con-1');
    expect(slugify('LPT9', options)).toBe('lpt9-1');
  });

  it('limits names to 48 characters at a word boundary when possible', () => {
    const slug = slugify('one-two-three-four-five-six-seven-eight-nine-ten-eleven-twelve', options);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug).toBe('one-two-three-four-five-six-seven-eight-nine');
  });
});

describe('allocateSlug', () => {
  it('reserves collision-free suffixes in the supplied namespace', () => {
    const taken = new Set(['get-user']);

    expect(allocateSlug('get-user', taken)).toBe('get-user-2');
    expect(allocateSlug('get-user', taken)).toBe('get-user-3');
  });

  it('keeps suffixes within the maximum slug length', () => {
    const base = 'a'.repeat(48);
    const slug = allocateSlug(base, new Set([base]));

    expect(slug).toBe(`${'a'.repeat(46)}-2`);
    expect(slug).toHaveLength(48);
  });
});
