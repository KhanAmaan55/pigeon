import type { KeyValue } from '@pigeon/core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { KeyValueTableProps } from '../src/components/KeyValueTable';
import { KeyValueTable, parseBulkText, rowsToBulkText } from '../src/components/KeyValueTable';

afterEach(cleanup);

/** Renders a controlled table; `latest()` returns the rows after the last change. */
function renderTable(initial: KeyValue[], props: Partial<KeyValueTableProps> = {}) {
  let current = initial;
  function Harness() {
    const [rows, setRows] = useState(initial);
    return (
      <KeyValueTable
        label="Things"
        rows={rows}
        onChange={(next) => {
          current = next;
          setRows(next);
        }}
        {...props}
      />
    );
  }
  render(<Harness />);
  return { user: userEvent.setup(), latest: () => current };
}

const rowsInTable = () => screen.getAllByTestId('kv-row');
const draftRow = () => screen.getByTestId('kv-draft-row');
const keyOf = (row: HTMLElement) => within(row).getByLabelText<HTMLInputElement>('Key');
const valueOf = (row: HTMLElement) => within(row).getByLabelText<HTMLInputElement>('Value');

describe('KeyValueTable', () => {
  it('turns the empty row into a real row when typed in, keeping focus', async () => {
    const { user, latest } = renderTable([]);
    expect(screen.queryAllByTestId('kv-row')).toHaveLength(0);

    await user.type(keyOf(draftRow()), 'X-Api');
    await user.tab();
    await user.keyboard('secret');

    expect(latest()).toEqual([{ key: 'X-Api', value: 'secret' }]);
    expect(rowsInTable()).toHaveLength(1);
    expect(document.activeElement).toBe(valueOf(rowsInTable()[0]!));
    expect(keyOf(draftRow()).value).toBe('');
  });

  it('edits, disables and deletes rows', async () => {
    const { user, latest } = renderTable([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
    const [first, second] = rowsInTable();

    await user.clear(valueOf(first!));
    await user.type(valueOf(first!), 'one');
    await user.click(within(second!).getByLabelText('Enable row 2'));
    expect(latest()).toEqual([
      { key: 'a', value: 'one' },
      { key: 'b', value: '2', disabled: true },
    ]);
    expect(second!.hasAttribute('data-disabled')).toBe(true);

    await user.click(within(second!).getByLabelText('Enable row 2'));
    expect(latest()[1]).toEqual({ key: 'b', value: '2' });

    await user.click(within(first!).getByLabelText('Delete row 1'));
    expect(latest()).toEqual([{ key: 'b', value: '2' }]);
  });

  it('ends a ?flag row\'s "no value" state once a value is typed', async () => {
    const { user, latest } = renderTable([{ key: 'flag', value: '', extra: { valueNull: true } }]);
    await user.type(valueOf(rowsInTable()[0]!), '1');
    expect(latest()).toEqual([{ key: 'flag', value: '1' }]);
  });

  it('shows the description column on demand and edits descriptions', async () => {
    const { user, latest } = renderTable([
      { key: 'a', value: '1', description: { content: 'old', type: 'text/plain' } },
      { key: 'b', value: '2' },
    ]);
    // Shown from the start because a row has a description.
    const toggle = screen.getByRole('button', { name: 'Description' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    const description = within(rowsInTable()[0]!).getByLabelText('Description');
    await user.clear(description);
    await user.type(description, 'new');
    await user.type(within(rowsInTable()[1]!).getByLabelText('Description'), 'B');
    expect(latest()).toEqual([
      { key: 'a', value: '1', description: { content: 'new', type: 'text/plain' } },
      { key: 'b', value: '2', description: 'B' },
    ]);

    await user.click(toggle);
    expect(screen.queryAllByLabelText('Description')).toHaveLength(0);
  });

  it('bulk edits as key: value lines, with // for disabled rows', async () => {
    const { user, latest } = renderTable([
      { key: 'Accept', value: 'text/html', description: 'kept' },
      { key: 'X-Off', value: 'no', disabled: true },
    ]);
    await user.click(screen.getByRole('button', { name: 'Bulk edit' }));
    const text = screen.getByTestId<HTMLTextAreaElement>('kv-bulk-input');
    expect(text.value).toBe('Accept: text/html\n//X-Off: no');

    await user.clear(text);
    await user.type(
      text,
      'Accept: application/json\nAuthorization: Bearer a=b\n\nX-Eq=1\n// X-Off',
    );
    expect(latest()).toEqual([
      { key: 'Accept', value: 'application/json', description: 'kept' },
      { key: 'Authorization', value: 'Bearer a=b' },
      { key: 'X-Eq', value: '1' },
      { key: 'X-Off', value: '', disabled: true },
    ]);

    await user.click(screen.getByRole('button', { name: 'Key-value edit' }));
    expect(rowsInTable().map((row) => keyOf(row).value)).toEqual([
      'Accept',
      'Authorization',
      'X-Eq',
      'X-Off',
    ]);
  });

  it('pastes several lines as rows', async () => {
    const { user, latest } = renderTable([{ key: 'a', value: '1' }], { bulkSeparator: '=' });
    await user.click(keyOf(draftRow()));
    await user.paste('b=2\nc: x:y\nflag\n');
    expect(latest()).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'c', value: 'x:y' },
      { key: 'flag', value: '', extra: { valueNull: true } },
    ]);

    // Into a filled row: inserted after it. A single line pastes as plain text.
    await user.click(valueOf(rowsInTable()[0]!));
    await user.paste('z=26\ny=25');
    expect(latest().map((row) => row.key)).toEqual(['a', 'z', 'y', 'b', 'c', 'flag']);
    await user.paste('0');
    expect(latest()[0]).toEqual({ key: 'a', value: '10' });
  });

  it('reorders rows by dragging the handle', () => {
    const { latest } = renderTable([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'c', value: '3' },
    ]);
    const dataTransfer = {
      setData: () => undefined,
      setDragImage: () => undefined,
      effectAllowed: '',
      dropEffect: '',
    };
    const handle = screen.getByLabelText(/^Reorder row 1/);
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(rowsInTable()[2]!, { dataTransfer });
    fireEvent.drop(rowsInTable()[2]!, { dataTransfer });
    expect(latest().map((row) => row.key)).toEqual(['b', 'c', 'a']);
  });

  it('reorders rows with Alt+Up/Down on the handle, keeping focus on it', async () => {
    const { user, latest } = renderTable([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
    screen.getByLabelText(/^Reorder row 1/).focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(latest().map((row) => row.key)).toEqual(['b', 'a']);
    expect(document.activeElement).toBe(screen.getByLabelText(/^Reorder row 2/));
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}'); // already last
    expect(latest().map((row) => row.key)).toEqual(['b', 'a']);
  });

  it('with fixed keys, only values (and descriptions) are editable', async () => {
    const { user, latest } = renderTable([{ key: 'id', value: '' }], { fixedKeys: true });
    expect(screen.queryByTestId('kv-draft-row')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bulk edit' })).toBeNull();
    expect(screen.queryByLabelText(/^Delete row/)).toBeNull();
    expect(screen.queryByLabelText(/^Enable row/)).toBeNull();
    expect(keyOf(rowsInTable()[0]!).readOnly).toBe(true);

    await user.type(valueOf(rowsInTable()[0]!), '42');
    expect(latest()).toEqual([{ key: 'id', value: '42' }]);
  });
});

describe('bulk text', () => {
  it('round-trips rows for both separators', () => {
    const rows: KeyValue[] = [
      { key: 'a', value: '1' },
      { key: 'b', value: 'x:y=z', disabled: true },
      { key: 'flag', value: '', extra: { valueNull: true } },
      { key: 'e', value: '' },
    ];
    expect(rowsToBulkText(rows, '=')).toBe('a=1\n//b=x:y=z\nflag\ne=');
    expect(parseBulkText(rowsToBulkText(rows, '='), '=')).toEqual(rows);
    expect(rowsToBulkText(rows.slice(0, 2), ':')).toBe('a: 1\n//b: x:y=z');
    expect(parseBulkText(rowsToBulkText(rows.slice(0, 2), ':'), ':')).toEqual(rows.slice(0, 2));
  });

  it('carries metadata over from previous rows with the same key, in order', () => {
    const previous: KeyValue[] = [
      { key: 'a', value: '1', description: 'first' },
      { key: 'a', value: '2', description: 'second', disabled: true },
    ];
    expect(parseBulkText('a: x\na: y\nb: z', ':', previous)).toEqual([
      { key: 'a', value: 'x', description: 'first' },
      { key: 'a', value: 'y', description: 'second' },
      { key: 'b', value: 'z' },
    ]);
  });
});
