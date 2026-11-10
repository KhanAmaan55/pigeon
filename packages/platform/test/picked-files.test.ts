import { describe, expect, it } from 'vitest';

import { createMemoryPlatform, PickedFileStore } from '../src/index';

describe('PickedFileStore', () => {
  it('stores a copy under a fresh id and forgets it on delete', () => {
    const store = new PickedFileStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const a = store.add({ name: 'a.bin', bytes, mime: 'application/x-test' });
    const b = store.add({ name: 'a.bin', bytes });
    bytes[0] = 9;

    expect(a.kind).toBe('picked');
    expect(a.id).not.toBe(b.id);
    expect(store.get(a.id)).toEqual({
      name: 'a.bin',
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'application/x-test',
    });
    expect(store.size).toBe(2);
    expect(store.delete(a.id)).toBe(true);
    expect(store.get(a.id)).toBeUndefined();
    expect(store.delete(a.id)).toBe(false);
  });

  it('is part of every memory platform, or the one passed in', () => {
    expect(createMemoryPlatform().pickedFiles).toBeInstanceOf(PickedFileStore);
    const pickedFiles = new PickedFileStore();
    expect(createMemoryPlatform({ pickedFiles }).pickedFiles).toBe(pickedFiles);
  });
});
