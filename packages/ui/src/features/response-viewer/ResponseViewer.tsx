import type { ExecutionError, NormalizedResponse } from '@pigeon/core';
import { CircleAlert, LoaderCircle, TriangleAlert } from 'lucide-react';

import { formatBytes } from '../../lib/format';
import { useScratchRequest } from '../request-editor/ScratchRequestProvider';
import { StatusLine } from './StatusLine';

/** Status line, time, size and raw body of the latest result. Pretty viewer: PIGN-010. */
export function ResponseViewer() {
  const sending = useScratchRequest((s) => s.status === 'sending');
  const result = useScratchRequest((s) => s.result);

  return (
    <div
      data-testid="response-panel"
      aria-busy={sending}
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      {sending && (
        <div
          role="status"
          data-testid="response-loading"
          className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-sm text-fg-muted"
        >
          <LoaderCircle size={14} className="animate-spin" aria-hidden />
          Sending request…
        </div>
      )}
      {result === null ? (
        !sending && (
          <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
            Send a request to see the response
          </div>
        )
      ) : (
        <>
          {result.response && (
            <StatusLine response={result.response} transport={result.transport} />
          )}
          {result.warnings.length > 0 && <Warnings warnings={result.warnings} />}
          {result.error && <ErrorCard error={result.error} />}
          {result.response && <Body response={result.response} />}
        </>
      )}
    </div>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  return (
    <ul
      data-testid="response-warnings"
      aria-label="Warnings"
      className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-fg-muted"
    >
      {warnings.map((warning) => (
        <li key={warning} className="flex items-start gap-1.5">
          <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          {warning}
        </li>
      ))}
    </ul>
  );
}

function ErrorCard({ error }: { error: ExecutionError }) {
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
          <span>{error.message}</span>
        </div>
        <code data-testid="response-error-kind" className="font-mono text-xs text-fg-muted">
          {error.kind}
        </code>
        {error.hint && <p className="text-fg-muted">{error.hint}</p>}
        {error.detail && (
          <pre className="font-mono text-xs break-all whitespace-pre-wrap text-fg-muted">
            {error.detail}
          </pre>
        )}
      </div>
    </div>
  );
}

function Body({ response }: { response: NormalizedResponse }) {
  if (response.sizeBytes === 0) {
    return <p className="p-3 text-sm text-fg-muted">Empty response body</p>;
  }
  if (response.bodyText === undefined) {
    return (
      <p className="p-3 text-sm text-fg-muted">
        Binary response ({formatBytes(response.sizeBytes)}
        {response.contentType ? `, ${response.contentType}` : ''})
      </p>
    );
  }
  return (
    <pre
      data-testid="response-body"
      tabIndex={0}
      aria-label="Response body"
      className="min-h-0 flex-1 overflow-auto p-3 font-mono text-sm break-all whitespace-pre-wrap text-fg"
    >
      {response.bodyText}
    </pre>
  );
}
