import type { ExampleBody, ProjectExample, ProjectSession, ResponseExample } from '@pigeon/core';
import { buildRequestUrl } from '@pigeon/core';
import { decodeBase64, exampleBodyFileName, exampleDirectory } from '@pigeon/formats';
import { Bookmark, Copy, Pencil, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';

import { CodeEditor } from '../../components/CodeEditor';
import { JsonSchemaActions } from '../compare/JsonSchemaActions';
import { KeyValueTable } from '../../components/KeyValueTable';
import { formatBytes } from '../../lib/format';
import { useProjectState } from '../../stores/AppStoreProvider';
import type { ProjectStore } from '../../stores/project-store';
import { statusClass } from './ExamplesTab';

/** Where an example's files live (for display): `examples/…/<request>/<fileKey>.example.json`. */
export function exampleFilePath(
  session: ProjectSession,
  requestId: string,
  example: Pick<ProjectExample, 'fileKey'>,
): string {
  const requestPath = session.itemFilePath(requestId) ?? '';
  const directory = requestPath.slice(0, requestPath.lastIndexOf('/'));
  const request = session.findRequest(requestId);
  return `${exampleDirectory(directory, request?.fileKey ?? '')}/${example.fileKey}.example.json`;
}

/**
 * A saved example (docs/ui-ux.md §3.6): read-only by default; **Edit** makes the name, status,
 * headers and body editable. Edits are in-memory changes of the request, like any other edit;
 * Save for Commit writes the example files.
 */
export function ExampleView({
  session,
  store,
  exampleId,
}: {
  session: ProjectSession;
  store: ProjectStore;
  exampleId: string;
}) {
  useProjectState((s) => s.model, null);
  const readOnly = useProjectState((s) => s.readOnly, false);
  const [editing, setEditing] = useState(false);
  const found = session.findExample(exampleId);
  if (!found) return null;
  const { request, example } = found;
  const { response } = example;
  const canEdit = editing && !readOnly;
  const update = (patch: Partial<ResponseExample>) =>
    session.apply({
      type: 'updateExample',
      id: example.id,
      patch: { response: { ...response, ...patch } },
    });
  const bodyFile = exampleBodyFileName(example);

  return (
    <div data-testid="example-view" className="flex min-h-0 flex-1 flex-col overflow-auto bg-bg">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Bookmark size={14} className="shrink-0 text-fg-muted" aria-hidden />
        {canEdit ? (
          <NameInput
            name={example.name}
            onRename={(name) => session.apply({ type: 'renameExample', id: example.id, name })}
          />
        ) : (
          <h2 data-testid="example-name" className="min-w-0 truncate text-sm font-semibold">
            {example.name}
          </h2>
        )}
        <span className="text-xs text-fg-muted">of {request.name}</span>
        <div className="ml-auto flex items-center gap-1">
          <JsonSchemaActions session={session} exampleId={example.id} testIdPrefix="example" />
          <ToolbarButton
            testId="example-edit-toggle"
            pressed={editing}
            disabled={readOnly}
            onClick={() => setEditing(!editing)}
            icon={<Pencil size={12} aria-hidden />}
          >
            {editing ? 'Done' : 'Edit'}
          </ToolbarButton>
          <ToolbarButton
            testId="example-duplicate"
            disabled={readOnly}
            onClick={() => {
              const newId = crypto.randomUUID();
              session.apply({ type: 'duplicateExample', id: example.id, newId });
              store.getState().openTab(newId, { pin: true });
            }}
            icon={<Copy size={12} aria-hidden />}
          >
            Duplicate
          </ToolbarButton>
          <ToolbarButton
            testId="example-delete"
            disabled={readOnly}
            onClick={() => {
              store.getState().closeTab(example.id);
              session.apply({ type: 'deleteExample', id: example.id });
            }}
            icon={<Trash2 size={12} aria-hidden />}
          >
            Delete
          </ToolbarButton>
        </div>
      </header>

      <p
        data-testid="example-file"
        className="shrink-0 border-b border-border px-3 py-1 font-mono text-xs text-fg-muted"
      >
        {exampleFilePath(session, request.id, example)}
        {bodyFile ? ` · ${bodyFile}` : ' · no body'}
      </p>

      <section aria-label="Status" className="flex shrink-0 items-center gap-2 px-3 py-2 text-sm">
        {canEdit ? (
          <>
            <input
              aria-label="Status code"
              data-testid="example-code"
              type="number"
              min={100}
              max={999}
              value={response.code}
              onChange={(event) => {
                const code = Number(event.target.value);
                if (Number.isInteger(code) && code >= 0) update({ code });
              }}
              className="h-7 w-20 rounded border border-border bg-bg px-2 font-mono text-sm"
            />
            <input
              aria-label="Status text"
              data-testid="example-status"
              value={response.status}
              onChange={(event) => update({ status: event.target.value })}
              className="h-7 w-48 rounded border border-border bg-bg px-2 text-sm"
            />
          </>
        ) : (
          <span
            data-testid="example-status-line"
            className={`font-mono font-bold ${statusClass(response.code)}`}
          >
            {response.code} {response.status}
          </span>
        )}
      </section>

      <Section title="Headers" testId="example-headers">
        {canEdit ? (
          <KeyValueTable
            label="Example headers"
            testId="example-headers-table"
            rows={response.headers}
            onChange={(headers) => update({ headers })}
          />
        ) : response.headers.length === 0 ? (
          <p className="text-xs text-fg-muted">No headers.</p>
        ) : (
          <table className="w-full table-fixed text-sm">
            <tbody>
              {response.headers.map((header, index) => (
                <tr key={index} className="border-b border-border/60">
                  <td className="w-1/3 truncate py-0.5 pr-2 font-mono text-fg-muted">
                    {header.key}
                  </td>
                  <td className="truncate py-0.5 font-mono">{header.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Body" testId="example-body">
        <BodyEditor body={response.body} editable={canEdit} onChange={(body) => update({ body })} />
      </Section>

      {example.request && (
        <details
          data-testid="example-original-request"
          className="border-t border-border px-3 py-2"
        >
          <summary className="cursor-default text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Original request
          </summary>
          <div className="mt-2 flex flex-col gap-1 font-mono text-xs">
            <span>
              {example.request.method}{' '}
              {buildRequestUrl(example.request.url) || example.request.url.raw}
            </span>
            {example.request.headers.map((header, index) => (
              <span key={index} className={header.disabled ? 'text-fg-muted line-through' : ''}>
                {header.key}: {header.value}
              </span>
            ))}
            {example.request.body.mode === 'raw' && example.request.body.raw !== '' && (
              <pre className="mt-1 whitespace-pre-wrap">{example.request.body.raw}</pre>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function BodyEditor({
  body,
  editable,
  onChange,
}: {
  body: ExampleBody;
  editable: boolean;
  onChange: (body: ExampleBody) => void;
}) {
  if (body.kind === 'binary') {
    return (
      <p data-testid="example-body-binary" className="text-xs text-fg-muted">
        Binary body, {formatBytes(decodeBase64(body.base64).byteLength)} (kept byte for byte).
      </p>
    );
  }
  if (body.kind === 'none' && !editable) {
    return <p className="text-xs text-fg-muted">No body.</p>;
  }
  const text = body.kind === 'text' ? body.text : '';
  const format = body.kind === 'text' ? body.format : 'text';
  return (
    <CodeEditor
      value={text}
      onChange={
        editable
          ? (value) =>
              onChange(value === '' ? { kind: 'none' } : { kind: 'text', text: value, format })
          : undefined
      }
      readOnly={!editable}
      language={format}
      lint={format === 'json'}
      folding
      search
      ariaLabel="Example body"
      testId="example-body-editor"
      className="h-72"
    />
  );
}

function Section({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-testid={testId} className="border-t border-border px-3 py-2">
      <h2 id={id} className="pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ToolbarButton({
  testId,
  onClick,
  icon,
  children,
  disabled = false,
  pressed,
}: {
  testId: string;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50 aria-pressed:bg-hover aria-pressed:text-fg"
    >
      {icon}
      {children}
    </button>
  );
}

/** Renames on Enter or blur (the example's files are renamed with it on commit). */
function NameInput({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [value, setValue] = useState(name);
  const commit = () => {
    if (value.trim() !== '' && value !== name) onRename(value.trim());
    else setValue(name);
  };
  return (
    <input
      aria-label="Example name"
      data-testid="example-name-input"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setValue(name);
      }}
      className="h-7 min-w-0 flex-1 rounded border border-border bg-bg px-2 text-sm font-semibold"
    />
  );
}
