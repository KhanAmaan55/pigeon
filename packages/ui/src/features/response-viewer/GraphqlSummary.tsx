import type { GraphqlView } from '@pigeon/core';
import { CircleAlert } from 'lucide-react';

import { chipClass } from './StatusLine';

/** `errors: N` next to the status: GraphQL errors arrive with HTTP 200 too (PIGN-032). */
export function GraphqlErrorsChip({ view }: { view: GraphqlView }) {
  if (view.errors.length === 0) return null;
  return (
    <span
      data-testid="graphql-errors-chip"
      title="The GraphQL response has errors"
      className={chipClass('fail')}
    >
      <CircleAlert size={12} aria-hidden />
      errors: {view.errors.length}
    </span>
  );
}

/** The GraphQL errors, above the body. */
export function GraphqlErrorList({ view }: { view: GraphqlView }) {
  if (view.errors.length === 0) return null;
  return (
    <ul
      data-testid="graphql-errors"
      className="flex max-h-40 shrink-0 flex-col gap-1.5 overflow-auto border-b border-fail/20 bg-fail/6 px-4 py-2.5 text-sm"
    >
      {view.errors.map((error, index) => (
        <li key={index} data-testid="graphql-error" className="flex flex-col">
          <span className="text-fail">{error.message}</span>
          {(error.path || error.locations) && (
            <span className="font-mono text-xs text-fg-muted">
              {error.path ? `path: ${error.path.join('.')}` : ''}
              {error.path && error.locations ? ' · ' : ''}
              {error.locations
                ? `at ${error.locations.map((l) => `${l.line}:${l.column}`).join(', ')}`
                : ''}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
