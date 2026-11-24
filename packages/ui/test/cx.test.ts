import { describe, expect, it } from 'vitest';

import { cx } from '../src/components/ui/cx';

describe('cx (PIGN-058)', () => {
  it('joins classes and skips falsy values', () => {
    expect(cx('a', false, null, undefined, 0, 'b  c')).toBe('a b c');
  });

  it('lets a later class replace one that sets the same thing', () => {
    expect(cx('h-8 w-full px-2.5 text-base', 'w-32')).toBe('h-8 px-2.5 text-base w-32');
    expect(cx('text-sm text-fg', 'text-xs')).toBe('text-fg text-xs');
    expect(cx('text-sm text-fg', 'text-fail')).toBe('text-sm text-fail');
    expect(cx('rounded px-3', 'rounded-r-none')).toBe('rounded px-3 rounded-r-none');
    expect(cx('top-1/2 max-h-[85vh]', 'top-[12vh] max-h-[70vh]')).toBe('top-[12vh] max-h-[70vh]');
    expect(cx('mt-5 justify-end', 'mt-3')).toBe('justify-end mt-3');
  });

  it('keeps classes with different variants or unrelated groups', () => {
    expect(cx('bg-sunken hover:bg-hover focus:bg-bg', 'bg-bg')).toBe(
      'hover:bg-hover focus:bg-bg bg-bg',
    );
    expect(cx('min-w-0 w-full', 'max-w-48')).toBe('min-w-0 w-full max-w-48');
    expect(cx('px-2', 'p-0')).toBe('px-2 p-0');
    expect(cx('data-[state=active]:bg-hover', 'data-[state=active]:bg-selected')).toBe(
      'data-[state=active]:bg-selected',
    );
    expect(cx('inset-x-0 inset-y-2')).toBe('inset-x-0 inset-y-2');
    expect(cx('flex-1 flex-col', 'flex')).toBe('flex-1 flex-col flex');
  });
});
