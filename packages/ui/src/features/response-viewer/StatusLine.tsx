import type { ReactNode } from 'react';
import type { ExecutionResult, NormalizedResponse } from '@pigeon/core';

import type { Tone } from '../../components/ui';
import { cx } from '../../components/ui';
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
  proxy: {
    label: 'Proxy',
    description:
      'Sent through your self-hosted CORS proxy: no CORS, every header sent and visible.',
  },
};

type ChipTone = Exclude<Tone, 'accent'>;

const CHIP_TONES: Record<ChipTone, { base: string; hover: string }> = {
  neutral: { base: 'bg-hover text-fg-muted', hover: 'hover:bg-border hover:text-fg' },
  pass: { base: 'bg-pass/12 text-pass', hover: 'hover:bg-pass/20' },
  warn: { base: 'bg-warn/12 text-warn', hover: 'hover:bg-warn/20' },
  fail: { base: 'bg-fail/12 text-fail', hover: 'hover:bg-fail/20' },
  info: { base: 'bg-info/12 text-info', hover: 'hover:bg-info/20' },
};

/**
 * A soft chip tinted by outcome, for the status line (status, comparison, tests). Taller than
 * `Badge`, which is sized for counts.
 */
export function chipClass(tone: ChipTone, interactive = false): string {
  return cx(
    'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold [&_svg]:size-3',
    CHIP_TONES[tone].base,
    interactive && cx('cursor-default transition-colors', CHIP_TONES[tone].hover),
  );
}

function statusTone(status: number): ChipTone {
  if (status >= 500) return 'fail';
  if (status >= 400) return 'warn';
  if (status >= 300) return 'info';
  if (status >= 200) return 'pass';
  return 'neutral';
}

function Divider() {
  return <span aria-hidden className="h-3 w-px shrink-0 bg-border" />;
}

function sizeTooltip(bytes: number, transport: TransportKind): string {
  const size = `${bytes.toLocaleString('en-US')} bytes, decoded`;
  return transport === 'fetch'
    ? `${size} by the browser (the compressed size on the wire is not visible to web pages)`
    : `${size} (after removing Content-Encoding)`;
}

export function StatusLine({
  response,
  transport,
  comparison,
}: {
  response: NormalizedResponse;
  transport: TransportKind;
  /** The comparison badge (PIGN-034), for project requests. */
  comparison?: ReactNode;
}) {
  const badge = TRANSPORT_BADGES[transport];
  return (
    <div
      data-testid="response-status-line"
      className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-2 text-xs"
    >
      <span data-testid="response-status" className={chipClass(statusTone(response.status))}>
        {`${response.status} ${statusText(response.status, response.statusText)}`.trim()}
      </span>
      <span className="text-fg-muted">
        Time{' '}
        <span data-testid="response-time" className="font-mono text-fg">
          {formatDuration(response.timings.totalMs)}
        </span>
      </span>
      <Divider />
      <span className="text-fg-muted">
        Size{' '}
        <span
          data-testid="response-size"
          title={sizeTooltip(response.sizeBytes, transport)}
          className="font-mono text-fg"
        >
          {formatBytes(response.sizeBytes)}
        </span>
      </span>
      {comparison}
      <span
        data-testid="response-transport"
        data-transport={transport}
        title={badge.description}
        aria-label={`Transport: ${badge.label}. ${badge.description}`}
        className="ml-auto inline-flex h-5 shrink-0 items-center rounded-full border border-border px-2 text-[11px] font-medium text-fg-muted"
      >
        {badge.label}
      </span>
    </div>
  );
}
