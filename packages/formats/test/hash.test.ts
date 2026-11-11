import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../src/hash';

describe('sha256Hex', () => {
  it('returns the standard lowercase SHA-256 digest', async () => {
    await expect(sha256Hex(new TextEncoder().encode('abc'))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
