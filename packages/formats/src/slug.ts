export interface SlugOptions {
  readonly kind: string;
  readonly id: string;
}

const MAX_SLUG_LENGTH = 48;
const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

/** Converts an entity name into a portable, deterministic file key. */
export function slugify(name: string, { kind, id }: SlugOptions): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const base = normalized === '' ? fallbackSlug(kind, id) : truncateSlug(normalized, MAX_SLUG_LENGTH);
  return WINDOWS_RESERVED_NAMES.has(base) ? `${base}-1` : base;
}

/**
 * Reserves and returns the first available spelling of `base` in `taken`.
 * Calling it again with the same set consequently returns the next suffix.
 */
export function allocateSlug(base: string, taken: Set<string>): string {
  let candidate = truncateSlug(base, MAX_SLUG_LENGTH);
  let suffixNumber = 2;

  while (taken.has(candidate)) {
    const suffix = `-${suffixNumber}`;
    candidate = `${truncateSlug(base, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
    suffixNumber += 1;
  }

  taken.add(candidate);
  return candidate;
}

function fallbackSlug(kind: string, id: string): string {
  return truncateSlug(`${kind}-${id.slice(0, 8)}`, MAX_SLUG_LENGTH);
}

function truncateSlug(value: string, limit: number): string {
  if (value.length <= limit) return value;

  const prefix = value.slice(0, limit);
  const boundary = prefix.lastIndexOf('-');
  return boundary > 0 ? prefix.slice(0, boundary) : prefix;
}
