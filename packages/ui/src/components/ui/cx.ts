/** Joins class names, skipping falsy ones: `cx('a', on && 'b')`. */
export function cx(...classes: Array<string | false | null | undefined | 0>): string {
  return classes.filter(Boolean).join(' ');
}
