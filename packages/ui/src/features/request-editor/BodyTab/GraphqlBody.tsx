import type { BodyOf } from '@pigeon/core';
import { graphqlOperations, graphqlVariablesError } from '@pigeon/core';
import { useId, useMemo } from 'react';

import { CodeEditor } from '../../../components/CodeEditor';
import { useVariableScopes } from '../../../components/VariableInput';
import { useScratchRequest } from '../ScratchRequestProvider';

/**
 * GraphQL body (PIGN-032): the query and the variables (JSON) side by side, and the operation
 * name — a picker when the document defines several named operations.
 */
export function GraphqlBody({ body }: { body: BodyOf<'graphql'> }) {
  const setBody = useScratchRequest((s) => s.setBody);
  const variables = useVariableScopes();
  const id = useId();
  const operations = useMemo(() => graphqlOperations(body.query), [body.query]);
  const named = operations.flatMap((operation) => (operation.name ? [operation.name] : []));
  const variablesError = graphqlVariablesError(body.variables);
  const setOperationName = (name: string) => {
    const { operationName: _old, ...rest } = body;
    setBody(name === '' ? rest : { ...rest, operationName: name });
  };

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
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2">
        <section aria-label="Query" className="flex min-h-0 flex-col">
          <h2 className="pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Query
          </h2>
          <CodeEditor
            variables={variables}
            value={body.query}
            onChange={(query) => setBody({ ...body, query })}
            language="graphql"
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
        </section>
      </div>
    </div>
  );
}
