import type { BodyOf } from '@pigeon/core';
import { graphqlOperations, graphqlVariablesError } from '@pigeon/core';
import { BookOpen, Download, LoaderCircle, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { usePlatform } from '../../../app/PlatformProvider';
import { CodeEditor } from '../../../components/CodeEditor';
import { useVariableScopes } from '../../../components/VariableInput';
import { useAppStore } from '../../../stores/AppStoreProvider';
import { GraphqlDocs } from '../../graphql/GraphqlDocs';
import type { SchemaState } from '../../graphql/use-graphql-schema';
import { schemaCache, useGraphqlSchema } from '../../graphql/use-graphql-schema';
import { useScratchRequest } from '../ScratchRequestProvider';

/**
 * GraphQL body (PIGN-032): the query and the variables (JSON) side by side, and the operation
 * name — a picker when the document defines several named operations. With a schema (PIGN-055:
 * "Fetch schema" by introspection, cached per URL in local state, or the request's committed
 * schema file) the query editor completes, validates and explains fields, the variables are
 * checked against the operation, and the docs panel browses the schema.
 */
export function GraphqlBody({ body }: { body: BodyOf<'graphql'> }) {
  const setBody = useScratchRequest((s) => s.setBody);
  const rawUrl = useScratchRequest((s) => s.request.url.raw);
  const projectFs = useScratchRequest((s) => s.projectFs);
  const introspect = useScratchRequest((s) => s.introspect);
  const localKey = useAppStore((s) => s.project?.session.localKey ?? null);
  const platform = usePlatform();
  const variables = useVariableScopes();
  const id = useId();
  const operations = useMemo(() => graphqlOperations(body.query), [body.query]);
  const named = operations.flatMap((operation) => (operation.name ? [operation.name] : []));
  const variablesError = graphqlVariablesError(body.variables);
  const setOperationName = (name: string) => {
    const { operationName: _old, ...rest } = body;
    setBody(name === '' ? rest : { ...rest, operationName: name });
  };
  const setSchemaFile = (path: string) => {
    const { schemaFile: _old, ...rest } = body;
    setBody(path.trim() === '' ? rest : { ...rest, schemaFile: path.trim() });
  };

  const cache = schemaCache(
    platform.appState,
    projectFs && localKey ? `project:${localKey}` : 'app',
  );
  const { state, fetching, fetchError, fetchSchema, clearSchema } = useGraphqlSchema({
    rawUrl,
    schemaFile: projectFs ? body.schemaFile : undefined,
    projectFs,
    cache,
    introspect,
  });
  const schema = state.status === 'ready' ? state.schema : null;
  const [docsOpen, setDocsOpen] = useState(false);
  const [docsFocus, setDocsFocus] = useState<string | null>(null);
  const variableProblems = useMemo(
    () =>
      state.status === 'ready' && !variablesError
        ? state.runtime.variableProblems(
            state.schema,
            body.query,
            body.operationName,
            body.variables,
          )
        : [],
    [state, variablesError, body.query, body.operationName, body.variables],
  );
  const fromFile = projectFs !== null && body.schemaFile !== undefined;

  return (
    <div data-testid="graphql-body" className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2 text-sm">
        <label htmlFor={`${id}-operation`} className="text-fg-muted">
          Operation
        </label>
        {named.length > 1 ? (
          <select
            id={`${id}-operation`}
            data-testid="graphql-operation"
            value={body.operationName ?? ''}
            onChange={(event) => setOperationName(event.target.value)}
            className="h-7 rounded border border-border bg-surface px-2 text-xs text-fg"
          >
            <option value="">Choose an operation…</option>
            {named.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`${id}-operation`}
            data-testid="graphql-operation"
            value={body.operationName ?? ''}
            placeholder={named[0] ?? 'optional'}
            onChange={(event) => setOperationName(event.target.value)}
            className="h-7 w-48 rounded border border-border bg-bg px-2 font-mono text-xs text-fg"
          />
        )}
        {named.length > 1 && !body.operationName && (
          <span data-testid="graphql-operation-hint" className="text-xs text-warn">
            The document has {named.length} operations: pick the one to run.
          </span>
        )}
      </div>
      <SchemaBar
        state={state}
        fromFile={fromFile}
        fetching={fetching}
        fetchError={fetchError}
        onFetch={() => void fetchSchema()}
        onClear={() => void clearSchema()}
        docsOpen={docsOpen}
        onToggleDocs={() => setDocsOpen(!docsOpen)}
        schemaFile={projectFs ? (body.schemaFile ?? '') : null}
        onSchemaFile={setSchemaFile}
        fileInputId={`${id}-schema-file`}
      />
      <div
        className={`grid min-h-0 flex-1 gap-2 ${
          docsOpen && state.status === 'ready'
            ? 'grid-cols-[minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)]'
            : 'grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
        }`}
      >
        <section aria-label="Query" className="flex min-h-0 flex-col">
          <h2 className="pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Query
          </h2>
          <CodeEditor
            variables={variables}
            value={body.query}
            onChange={(query) => setBody({ ...body, query })}
            language="graphql"
            graphqlSchema={schema}
            onShowInDocs={(type) => {
              setDocsFocus(type);
              setDocsOpen(true);
            }}
            ariaLabel="GraphQL query"
            testId="graphql-query"
            placeholder="query { … }"
            className="min-h-32 flex-1"
          />
        </section>
        <section aria-label="Variables" className="flex min-h-0 flex-col">
          <h2 className="pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Variables
          </h2>
          <CodeEditor
            variables={variables}
            value={body.variables}
            onChange={(text) => setBody({ ...body, variables: text })}
            language="json"
            lint
            ariaLabel="GraphQL variables"
            testId="graphql-variables"
            placeholder='{ "id": 1 }'
            className="min-h-32 flex-1"
          />
          {variablesError && (
            <p
              role="alert"
              data-testid="graphql-variables-error"
              className="pt-1 text-xs text-fail"
            >
              {variablesError} Sending is blocked until it is fixed.
            </p>
          )}
          {variableProblems.length > 0 && (
            <ul data-testid="graphql-variables-schema" className="pt-1 text-xs text-warn">
              {variableProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </section>
        {docsOpen && state.status === 'ready' && (
          <GraphqlDocs
            docs={state.docs}
            focus={docsFocus}
            onFocus={setDocsFocus}
            onClose={() => setDocsOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function SchemaBar({
  state,
  fromFile,
  fetching,
  fetchError,
  onFetch,
  onClear,
  docsOpen,
  onToggleDocs,
  schemaFile,
  onSchemaFile,
  fileInputId,
}: {
  state: SchemaState;
  fromFile: boolean;
  fetching: boolean;
  fetchError: string | null;
  onFetch: () => void;
  onClear: () => void;
  docsOpen: boolean;
  onToggleDocs: () => void;
  /** `null` for the scratch request (no project to keep a file in). */
  schemaFile: string | null;
  onSchemaFile: (path: string) => void;
  fileInputId: string;
}) {
  const button =
    'inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-hover disabled:opacity-50';
  const status =
    state.status === 'ready'
      ? `Schema: ${state.types} types ${
          state.origin === 'file'
            ? 'from the schema file'
            : `from introspection${state.fetchedAt ? `, fetched ${new Date(state.fetchedAt).toLocaleString()}` : ''}${state.notCached ? ' (too large to keep after closing)' : ''}`
        }`
      : state.status === 'loading'
        ? 'Loading the schema…'
        : state.status === 'error'
          ? state.message
          : 'No schema: fetch it for completion and checks.';
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
      {!fromFile && (
        <>
          <button
            type="button"
            data-testid="graphql-fetch-schema"
            disabled={fetching}
            onClick={onFetch}
            title="Send the introspection query to this URL, with this request's headers, auth and variables"
            className={button}
          >
            {fetching ? (
              <LoaderCircle size={12} className="animate-spin" aria-hidden />
            ) : (
              <Download size={12} aria-hidden />
            )}
            {state.status === 'ready' ? 'Refresh schema' : 'Fetch schema'}
          </button>
          {state.status === 'ready' && state.origin === 'introspection' && (
            <button
              type="button"
              data-testid="graphql-clear-schema"
              onClick={onClear}
              title="Forget the schema cached for this URL"
              className={button}
            >
              <Trash2 size={12} aria-hidden />
              Clear
            </button>
          )}
        </>
      )}
      <button
        type="button"
        data-testid="graphql-docs-toggle"
        aria-pressed={docsOpen}
        disabled={state.status !== 'ready'}
        onClick={onToggleDocs}
        className={`${button} aria-pressed:bg-hover`}
      >
        <BookOpen size={12} aria-hidden />
        Docs
      </button>
      <span
        data-testid="graphql-schema-status"
        role={state.status === 'error' ? 'alert' : undefined}
        className={state.status === 'error' ? 'text-fail' : 'text-fg-muted'}
      >
        {status}
      </span>
      {fetchError && (
        <span role="alert" data-testid="graphql-schema-error" className="text-fail">
          {fetchError}
        </span>
      )}
      {schemaFile !== null && (
        <span className="ml-auto flex items-center gap-1">
          <label htmlFor={fileInputId} className="text-fg-muted">
            Schema file
          </label>
          <input
            id={fileInputId}
            data-testid="graphql-schema-file"
            value={schemaFile}
            spellCheck={false}
            placeholder="schema.graphql (optional)"
            title="A project-relative SDL (.graphql) or introspection (.json) file, committed with the request"
            onChange={(event) => onSchemaFile(event.target.value)}
            className="h-7 w-48 rounded border border-border bg-bg px-2 font-mono text-xs text-fg"
          />
        </span>
      )}
    </div>
  );
}
