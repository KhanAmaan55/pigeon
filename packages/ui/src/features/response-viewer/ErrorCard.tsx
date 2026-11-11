import type { ExecutionError } from '@pigeon/core';
import { ERROR_TITLES } from '@pigeon/core';
import { CircleAlert } from 'lucide-react';

/**
 * Why a request failed (docs/ui-ux.md §3.5): the kind's title, the message, a hint on what to do
 * next, and the raw transport error folded away. Wording comes from core's `classifyError`, so
 * web and desktop explain failures the same way.
 */
export function ErrorCard({ error }: { error: ExecutionError }) {
  return (
    <div className="p-3">
      <div
        role="alert"
        data-testid="response-error"
        data-kind={error.kind}
        className="flex flex-col gap-1.5 rounded border border-fail/40 bg-bg p-3 text-sm"
      >
        <div className="flex items-center gap-2 font-semibold text-fail">
          <CircleAlert size={16} aria-hidden />
          <span data-testid="response-error-title">{ERROR_TITLES[error.kind]}</span>
          <code
            data-testid="response-error-kind"
            className="ml-auto font-mono text-xs font-normal text-fg-muted"
          >
            {error.kind}
          </code>
        </div>
        <p data-testid="response-error-message" className="text-fg">
          {error.message}
        </p>
        {error.hint && (
          <p data-testid="response-error-hint" className="text-fg-muted">
            {error.hint}
          </p>
        )}
        {error.detail && (
          <details data-testid="response-error-detail" className="text-xs text-fg-muted">
            <summary className="cursor-pointer select-none hover:text-fg">Details</summary>
            <pre className="mt-1 font-mono break-all whitespace-pre-wrap">{error.detail}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
