import type { ExecutionResult, NormalizedResponse } from '@pigeon/core';

import { formatBytes, formatDuration, statusText } from '../../lib/format';

type TransportKind = ExecutionResult['transport'];

/** Which transport sent the request, so CORS and header differences are never a mystery. */
export const TRANSPORT_BADGES: Record<TransportKind, { label: string; description: string }> = {
  native: {
    label: 'Native',
    description: 'Sent by the desktop app: no CORS, every header sent and visible.',
  },
  fetch: {
    label: 'Browser',
    description:
      'Sent by the browser: CORS applies, and some request and response headers are hidden.',
  },
  node: { label: 'Node', description: 'Sent from Node.js.' },
};

function statusColor(status: number): string {
  if (status >= 500) return 'text-fail';
  if (status >= 400) return 'text-warn';
  if (status >= 300) return 'text-info';
  if (status >= 200) return 'text-pass';
  return 'text-fg-muted';
}

export function StatusLine({
  response,
  transport,
}: {
  response: NormalizedResponse;
  transport: TransportKind;
}) {
  const badge = TRANSPORT_BADGES[transport];
  return (
    <div
      data-testid="response-status-line"
      className="flex shrink-0 items-center gap-4 border-b border-border px-3 py-1.5 text-sm"
    >
      <span
        data-testid="response-status"
        className={`font-semibold ${statusColor(response.status)}`}
      >
        {`${response.status} ${statusText(response.status, response.statusText)}`.trim()}
      </span>
      <span className="text-fg-muted">
        Time{' '}
        <span data-testid="response-time" className="font-mono text-fg">
          {formatDuration(response.timings.totalMs)}
        </span>
      </span>
      <span className="text-fg-muted">
        Size{' '}
        <span
          data-testid="response-size"
          title={`${response.sizeBytes} bytes`}
          className="font-mono text-fg"
        >
          {formatBytes(response.sizeBytes)}
        </span>
      </span>
      <span
        data-testid="response-transport"
        data-transport={transport}
        title={badge.description}
        aria-label={`Transport: ${badge.label}. ${badge.description}`}
        className="ml-auto rounded border border-border bg-surface-raised px-1.5 py-0.5 text-xs text-fg-muted"
      >
        {badge.label}
      </span>
    </div>
  );
}
