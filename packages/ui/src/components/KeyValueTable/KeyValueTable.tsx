import type { KeyValue } from '@pigeon/core';
import { GripVertical, ListTree, Text, Trash2 } from 'lucide-react';
import type { ClipboardEvent, DragEvent, KeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { BulkSeparator } from './bulk';
import {
  descriptionText,
  moveRow,
  parseBulkText,
  rowsToBulkText,
  withDescription,
  withValue,
} from './bulk';

/** A column after Value, e.g. form-data's part content type. */
export interface KeyValueColumn<T extends KeyValue> {
  id: string;
  header: string;
  render: (row: T, update: (next: T) => void, isDraft: boolean) => ReactNode;
}

export interface KeyValueTableProps<T extends KeyValue = KeyValue> {
  /** Accessible name of the table, e.g. "Query parameters". */
  label: string;
  rows: readonly T[];
  onChange: (rows: T[]) => void;
  /**
   * Keys come from elsewhere (path variables from the URL): keys are read-only and rows can't be
   * added, removed, disabled, reordered or bulk edited.
   */
  fixedKeys?: boolean;
  /** Bulk edit writes `key: value` (headers) or `key=value` (query) lines. */
  bulkSeparator?: BulkSeparator;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Shown after a row's key, e.g. a warning icon or a text/file toggle. */
  keyAdornment?: (row: T, update: (next: T) => void) => ReactNode;
  /** Replaces the value input of a row when it returns something (e.g. a file picker). */
  renderValue?: (row: T, update: (next: T) => void) => ReactNode;
  extraColumns?: ReadonlyArray<KeyValueColumn<T>>;
  /** The row the empty row turns into, and bulk/pasted rows are completed with. */
  newRow?: () => T;
  testId?: string;
}

const cellInput =
  'h-7 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1.5 font-mono text-sm text-fg placeholder:text-fg-muted hover:border-border focus:border-accent focus:outline-none disabled:opacity-60';
const toolbarButton =
  'inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs text-fg-muted hover:bg-hover hover:text-fg aria-pressed:bg-hover aria-pressed:text-fg';

/**
 * Editable key/value rows (docs/ui-ux.md §3.3): enable checkbox, key, value, optional description,
 * delete, an always-present empty row that turns into a real row when typed in, drag (or
 * Alt+↑/↓) to reorder, bulk edit as text, and pasting several `key: value` lines at once.
 */
export function KeyValueTable<T extends KeyValue = KeyValue>({
  label,
  rows,
  onChange,
  fixedKeys = false,
  bulkSeparator = ':',
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  keyAdornment,
  renderValue,
  extraColumns = [],
  newRow = () => ({ key: '', value: '' }) as T,
  testId,
}: KeyValueTableProps<T>) {
  const [showDescription, setShowDescription] = useState(() =>
    rows.some((row) => descriptionText(row.description) !== ''),
  );
  // Bulk mode: the text, the rows it produced and the rows it started from (whose descriptions
  // carry over to re-typed keys). Rows changed elsewhere (e.g. the URL) restart it from them.
  const [bulk, setBulk] = useState<{
    text: string;
    rows: readonly T[];
    base: readonly T[];
  } | null>(null);
  const bulkCurrent = bulk !== null && bulk.rows === rows;
  const bulkText =
    bulk === null ? null : bulkCurrent ? bulk.text : rowsToBulkText(rows, bulkSeparator);
  const bulkBase = bulk !== null && bulkCurrent ? bulk.base : rows;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const focusHandle = useRef<number | null>(null);

  useEffect(() => {
    if (focusHandle.current === null) return;
    tableRef.current?.querySelector<HTMLElement>(`[data-handle="${focusHandle.current}"]`)?.focus();
    focusHandle.current = null;
  }, [rows]);

  // Index `rows.length` is the trailing empty row; editing it appends a real row.
  const setRow = (index: number, update: (row: T) => T) => {
    const next = [...rows];
    next[index] = update(rows[index] ?? newRow());
    onChange(next);
  };
  // Bulk-parsed rows keep the fields of the row they matched; new ones get `newRow()`'s.
  const parseRows = (text: string, previous: readonly T[] = []): T[] =>
    parseBulkText(text, bulkSeparator, previous).map((row) => ({ ...newRow(), ...row }) as T);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return;
    onChange(moveRow(rows, from, to));
  };

  const onPaste = (index: number) => (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text/plain');
    if (fixedKeys || !/\r?\n/.test(text.trim())) return;
    event.preventDefault();
    const pasted = parseRows(text);
    const current = rows[index];
    const replace = current === undefined || (current.key === '' && current.value === '');
    const next = [...rows];
    next.splice(replace ? index : index + 1, replace && current ? 1 : 0, ...pasted);
    onChange(next);
  };

  const onHandleKeyDown = (index: number) => (event: KeyboardEvent) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const to = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= rows.length) return;
    focusHandle.current = to;
    move(index, to);
  };

  const dropHandlers = (index: number) => ({
    onDragOver: (event: DragEvent) => {
      if (dragFrom === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropAt(index);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      if (dragFrom !== null) move(dragFrom, Math.min(index, rows.length - 1));
      setDragFrom(null);
      setDropAt(null);
    },
  });

  const toolbar = (
    <div className="flex items-center justify-end gap-1 pb-1">
      {bulkText === null && (
        <button
          type="button"
          aria-pressed={showDescription}
          className={toolbarButton}
          onClick={() => setShowDescription((shown) => !shown)}
        >
          <Text size={12} aria-hidden />
          Description
        </button>
      )}
      {!fixedKeys && (
        <button
          type="button"
          aria-pressed={bulkText !== null}
          className={toolbarButton}
          onClick={() =>
            setBulk(
              bulk === null
                ? { text: rowsToBulkText(rows, bulkSeparator), rows, base: rows }
                : null,
            )
          }
        >
          <ListTree size={12} aria-hidden />
          {bulkText === null ? 'Bulk edit' : 'Key-value edit'}
        </button>
      )}
    </div>
  );

  if (bulkText !== null) {
    return (
      <div data-testid={testId} className="flex min-h-0 flex-col">
        {toolbar}
        <textarea
          aria-label={`${label} (bulk edit)`}
          data-testid="kv-bulk-input"
          value={bulkText}
          onChange={(event) => {
            const parsed = parseRows(event.target.value, bulkBase);
            setBulk({ text: event.target.value, rows: parsed, base: bulkBase });
            onChange(parsed);
          }}
          spellCheck={false}
          rows={8}
          placeholder={
            bulkSeparator === ':'
              ? 'One per line: Key: Value\n// prefix disables a row'
              : 'One per line: key=value\n// prefix disables a row'
          }
          className="min-h-32 resize-y rounded border border-border bg-bg p-2 font-mono text-sm text-fg placeholder:text-fg-muted"
        />
      </div>
    );
  }

  const count = fixedKeys ? rows.length : rows.length + 1;
  return (
    <div data-testid={testId} className="flex min-h-0 flex-col">
      {toolbar}
      <table ref={tableRef} aria-label={label} className="w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold text-fg-muted">
            {!fixedKeys && (
              <th className="w-12 py-1">
                <span className="sr-only">Enabled</span>
              </th>
            )}
            <th className="py-1 pl-1.5">Key</th>
            <th className="py-1 pl-1.5">Value</th>
            {extraColumns.map((column) => (
              <th key={column.id} className="w-40 py-1 pl-1.5">
                {column.header}
              </th>
            ))}
            {showDescription && <th className="py-1 pl-1.5">Description</th>}
            {!fixedKeys && (
              <th className="w-8 py-1">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: count }, (_, index) => {
            const row = rows[index];
            const isDraft = row === undefined;
            const current = row ?? newRow();
            const update = (next: T) => setRow(index, () => next);
            const customValue = renderValue?.(current, update);
            return (
              // Keyed by position so the empty row keeps focus when it becomes a real row.
              <tr
                key={index}
                data-testid={isDraft ? 'kv-draft-row' : 'kv-row'}
                data-disabled={current.disabled ? '' : undefined}
                {...(isDraft || fixedKeys ? {} : dropHandlers(index))}
                className={`border-b border-border/60 ${current.disabled ? 'text-fg-muted' : ''} ${
                  dropAt === index && dragFrom !== null && dragFrom !== index
                    ? dragFrom < index
                      ? 'shadow-[inset_0_-2px_0_var(--color-accent)]'
                      : 'shadow-[inset_0_2px_0_var(--color-accent)]'
                    : ''
                } ${dragFrom === index ? 'opacity-50' : ''}`}
              >
                {!fixedKeys && (
                  <td className="py-0.5">
                    <div className="flex items-center">
                      {isDraft ? (
                        <span className="w-5" />
                      ) : (
                        <span
                          role="button"
                          tabIndex={0}
                          draggable
                          data-handle={index}
                          aria-label={`Reorder row ${index + 1} (drag, or Alt+Up/Down)`}
                          title="Drag to reorder (Alt+↑/↓)"
                          onKeyDown={onHandleKeyDown(index)}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', String(index));
                            const tr = event.currentTarget.closest('tr');
                            if (tr) event.dataTransfer.setDragImage(tr, 0, 0);
                            setDragFrom(index);
                          }}
                          onDragEnd={() => {
                            setDragFrom(null);
                            setDropAt(null);
                          }}
                          className="flex w-5 cursor-grab justify-center text-fg-muted hover:text-fg"
                        >
                          <GripVertical size={14} aria-hidden />
                        </span>
                      )}
                      <input
                        type="checkbox"
                        aria-label={`Enable row ${index + 1}`}
                        checked={!isDraft && !current.disabled}
                        disabled={isDraft}
                        onChange={(event) =>
                          setRow(index, (r) => {
                            const next = { ...r };
                            if (event.target.checked) delete next.disabled;
                            else next.disabled = true;
                            return next;
                          })
                        }
                        className="size-3.5 accent-accent disabled:invisible"
                      />
                    </div>
                  </td>
                )}
                <td className="py-0.5">
                  <div className="flex items-center gap-1">
                    <input
                      aria-label="Key"
                      value={current.key}
                      readOnly={fixedKeys}
                      tabIndex={fixedKeys ? -1 : undefined}
                      placeholder={isDraft ? keyPlaceholder : ''}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(event) =>
                        setRow(index, (r) => ({ ...r, key: event.target.value }))
                      }
                      onPaste={onPaste(index)}
                      className={`${cellInput} ${fixedKeys ? 'hover:border-transparent focus:border-transparent' : ''}`}
                    />
                    {!isDraft && keyAdornment?.(current, update)}
                  </div>
                </td>
                <td className="py-0.5">
                  {customValue ?? (
                    <input
                      aria-label="Value"
                      value={current.value}
                      placeholder={isDraft || fixedKeys ? valuePlaceholder : ''}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(event) => setRow(index, (r) => withValue(r, event.target.value))}
                      onPaste={onPaste(index)}
                      className={cellInput}
                    />
                  )}
                </td>
                {extraColumns.map((column) => (
                  <td key={column.id} className="py-0.5">
                    {column.render(current, update, isDraft)}
                  </td>
                ))}
                {showDescription && (
                  <td className="py-0.5">
                    <input
                      aria-label="Description"
                      value={descriptionText(current.description)}
                      placeholder={isDraft ? 'Description' : ''}
                      onChange={(event) =>
                        setRow(index, (r) => withDescription(r, event.target.value))
                      }
                      className={`${cellInput} font-sans`}
                    />
                  </td>
                )}
                {!fixedKeys && (
                  <td className="py-0.5">
                    {!isDraft && (
                      <button
                        type="button"
                        aria-label={`Delete row ${index + 1}`}
                        title="Delete"
                        onClick={() => onChange(rows.filter((_, i) => i !== index))}
                        className="inline-flex size-7 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fail"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
