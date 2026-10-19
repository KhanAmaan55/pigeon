import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from '../src/index';

describe('@pigeon/fixtures', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@pigeon/fixtures');
  });
});
