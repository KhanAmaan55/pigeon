import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from '../src/index';

describe('@pigeon/ui', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@pigeon/ui');
  });
});
