import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from '../src/index';

describe('@pigeon/compare', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@pigeon/compare');
  });
});
