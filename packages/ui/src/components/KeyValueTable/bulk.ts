import type { Description, KeyValue } from '@pigeon/core';

/** Separator written by bulk edit; parsing accepts both. Query tables use `=`, headers `:`. */
export type BulkSeparator = ':' | '=';

const DISABLED_PREFIX = '//';

/** One `key: value` (or `key=value`) line per row; disabled rows start with `//` (as Postman). */
export function rowsToBulkText(rows: readonly KeyValue[], separator: BulkSeparator): string {
  return rows
    .map((row) => {
      const prefix = row.disabled ? DISABLED_PREFIX : '';
      if (row.value === '' && row.extra?.['valueNull'] === true) return `${prefix}${row.key}`;
      return `${prefix}${row.key}${separator === ':' ? ': ' : '='}${row.value}`;
    })
    .join('\n');
}

/**
 * Lines → rows. Each line splits on the preferred separator if it has one, else on the other, so
 * `Authorization: Bearer a=b` and `time=12:00` both read as intended. Blank lines are skipped.
 * Descriptions and other metadata carry over from `previous` rows with the same key, in order.
 */
export function parseBulkText(
  text: string,
  separator: BulkSeparator,
  previous: readonly KeyValue[] = [],
): KeyValue[] {
  const unused = [...previous];
  const rows: KeyValue[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line === '') continue;
    const disabled = line.startsWith(DISABLED_PREFIX);
    if (disabled) line = line.slice(DISABLED_PREFIX.length).trimStart();

    const other: BulkSeparator = separator === ':' ? '=' : ':';
    const at = line.includes(separator) ? line.indexOf(separator) : line.indexOf(other);
    const parsed: KeyValue =
      at === -1
        ? {
            key: line,
            value: '',
            ...(separator === '=' ? { extra: { valueNull: true } } : {}),
          }
        : { key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() };

    const matchIndex = unused.findIndex((row) => row.key === parsed.key);
    const match = matchIndex === -1 ? undefined : unused.splice(matchIndex, 1)[0];
    const row: KeyValue = match ? { ...match, key: parsed.key, value: parsed.value } : parsed;
    if (match) {
      const extra: Record<string, unknown> = { ...match.extra, ...parsed.extra };
      if (parsed.extra?.['valueNull'] === undefined) delete extra['valueNull'];
      if (Object.keys(extra).length === 0) delete row.extra;
      else row.extra = extra;
    }
    if (disabled) row.disabled = true;
    else delete row.disabled;
    rows.push(row);
  }
  return rows;
}

export function descriptionText(description: Description | undefined): string {
  if (description === undefined) return '';
  return typeof description === 'string' ? description : description.content;
}

/** Keeps a structured description's other fields (e.g. `type`) when its text changes. */
export function withDescription(row: KeyValue, text: string): KeyValue {
  const next = { ...row };
  if (typeof row.description === 'object') next.description = { ...row.description, content: text };
  else if (text === '') delete next.description;
  else next.description = text;
  return next;
}

/** Sets a row's value; a typed value ends a `?flag` param's "no value" state. */
export function withValue(row: KeyValue, value: string): KeyValue {
  const next: KeyValue = { ...row, value };
  if (value !== '' && next.extra?.['valueNull'] !== undefined) {
    const { valueNull: _ignored, ...extra } = next.extra;
    if (Object.keys(extra).length === 0) delete next.extra;
    else next.extra = extra;
  }
  return next;
}

export function moveRow<T>(rows: readonly T[], from: number, to: number): T[] {
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}
