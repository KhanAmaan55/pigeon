import type { FormDataParam } from '@pigeon/core';
import { fileSources } from '@pigeon/core';

import type { KeyValueColumn } from '../../../components/KeyValueTable';
import { KeyValueTable } from '../../../components/KeyValueTable';
import { FileChip, FilePicker } from './FilePicker';

const newRow = (): FormDataParam => ({ key: '', value: '', kind: 'text' });

const cellInput =
  'h-7 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1.5 font-mono text-sm text-fg placeholder:text-fg-muted hover:border-border focus:border-accent focus:outline-none';

const contentTypeColumn: KeyValueColumn<FormDataParam> = {
  id: 'content-type',
  header: 'Content type',
  render: (row, update, isDraft) => (
    <input
      aria-label="Content type"
      value={row.contentType ?? ''}
      placeholder={isDraft ? '' : 'Auto'}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => {
        const next: FormDataParam = { ...row, contentType: event.target.value };
        if (event.target.value === '') delete next.contentType;
        update(next);
      }}
      className={cellInput}
    />
  ),
};

/** Text or file per row (picked this session); an optional part content type. */
export function FormDataTable({
  params,
  onChange,
}: {
  params: readonly FormDataParam[];
  onChange: (params: FormDataParam[]) => void;
}) {
  return (
    <KeyValueTable<FormDataParam>
      label="Form data"
      testId="formdata-table"
      rows={params}
      onChange={onChange}
      newRow={newRow}
      keyPlaceholder="Add field"
      keyAdornment={(row, update) => (
        <select
          aria-label="Field type"
          data-testid="formdata-kind-select"
          value={row.kind}
          onChange={(event) => update(withKind(row, event.target.value as FormDataParam['kind']))}
          className="h-6 shrink-0 rounded border border-border bg-surface px-1 text-xs text-fg-muted"
        >
          <option value="text">Text</option>
          <option value="file">File</option>
        </select>
      )}
      renderValue={(row, update) =>
        row.kind === 'file' ? <FileCell row={row} update={update} /> : undefined
      }
      extraColumns={[contentTypeColumn]}
    />
  );
}

function FileCell({ row, update }: { row: FormDataParam; update: (next: FormDataParam) => void }) {
  const sources = fileSources(row);
  const setSources = (next: string[]) => {
    const updated = { ...row };
    if (next.length === 0) delete updated.src;
    else updated.src = next.length === 1 ? next[0] : next;
    update(updated);
  };
  return (
    <div
      data-testid="formdata-file-cell"
      className="flex min-w-0 flex-wrap items-center gap-1 px-1"
    >
      {sources.map((src, index) => (
        <FileChip
          key={`${index}:${src}`}
          src={src}
          onRemove={() => setSources(sources.filter((_, i) => i !== index))}
        />
      ))}
      <FilePicker
        multiple
        label={sources.length === 0 ? 'Select files' : 'Add'}
        testId="formdata-file-input"
        onPicked={(picked) => setSources([...sources, ...picked])}
      />
    </div>
  );
}

/** Text rows carry no files; file rows no value. */
function withKind(row: FormDataParam, kind: FormDataParam['kind']): FormDataParam {
  if (kind === row.kind) return row;
  const next: FormDataParam = { ...row, kind };
  if (kind === 'text') delete next.src;
  else next.value = '';
  return next;
}
