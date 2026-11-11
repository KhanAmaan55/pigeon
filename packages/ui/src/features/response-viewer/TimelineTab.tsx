import type { ExecutionResult, NormalizedResponse } from '@pigeon/core';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { useCapabilities } from '../../app/PlatformProvider';
import { formatDuration, statusText } from '../../lib/format';

/**
 * What happened on the wire (docs/ui-ux.md §3.5): the request line and headers as sent (secrets
 * masked by core), every redirect hop, and the timings. Browsers hide hops and TTFB, so the web
 * app shows what it can and says what is missing.
 */
export function TimelineTab({
  result,
  response,
}: {
  result: ExecutionResult;
  response: NormalizedResponse;
}) {
  const { canControlRedirects, detailedTimings } = useCapabilities();
  const { request } = result;
  const version = response.httpVersion ? ` ${response.httpVersion}` : '';

  return (
    <div data-testid="response-timeline" className="min-h-0 flex-1 overflow-auto p-3 text-sm">
      <Section title="Request">
        <p data-testid="timeline-request-line" className="font-mono text-xs break-all">
          <span className="font-semibold">{request.method}</span> {request.url}
          {version}
        </p>
        {request.headers.length > 0 && (
          <dl
            data-testid="timeline-request-headers"
            className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs"
          >
            {request.headers.map(([name, value], index) => (
              <Header key={`${index}-${name}`} name={name} value={value} />
            ))}
          </dl>
        )}
        {!canControlRedirects && (
          <p className="mt-1.5 text-xs text-fg-muted">
            The browser may add or drop headers (Origin, User-Agent, cookies, …); the web app cannot
            see what was finally sent.
          </p>
        )}
      </Section>

      <Section title="Redirects">
        {response.redirects.length > 0 ? (
          <ol data-testid="timeline-redirects" className="flex flex-col gap-1 font-mono text-xs">
            {response.redirects.map((hop, index) => (
              <li
                key={`${index}-${hop.url}`}
                data-testid="timeline-redirect"
                className="flex flex-wrap items-center gap-1.5 break-all"
              >
                <span className="font-semibold text-info">{hop.status}</span>
                <span>{hop.url}</span>
                <ArrowRight size={12} className="shrink-0 text-fg-muted" aria-label="to" />
                <span className="text-fg-muted">{hop.location}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p data-testid="timeline-no-redirects" className="text-xs text-fg-muted">
            {canControlRedirects
              ? 'None.'
              : 'Not visible: the browser follows redirects without telling the page.'}
          </p>
        )}
      </Section>

      <Section title="Response">
        <p data-testid="timeline-response-line" className="font-mono text-xs break-all">
          <span className="font-semibold">
            {`${response.status} ${statusText(response.status, response.statusText)}`.trim()}
          </span>{' '}
          {response.url}
        </p>
      </Section>

      <Section title="Timings">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-fg-muted">Started</dt>
          <dd data-testid="timeline-started">
            {new Date(response.timings.startedAt).toLocaleTimeString()}
          </dd>
          {response.timings.ttfbMs !== undefined && (
            <>
              <dt className="text-fg-muted" title="Time to first byte: until the headers arrived">
                TTFB
              </dt>
              <dd data-testid="timeline-ttfb" className="font-mono">
                {formatDuration(response.timings.ttfbMs)}
              </dd>
            </>
          )}
          <dt className="text-fg-muted">Total</dt>
          <dd data-testid="timeline-total" className="font-mono">
            {formatDuration(response.timings.totalMs)}
          </dd>
        </dl>
        {!detailedTimings && (
          <p className="mt-1.5 text-xs text-fg-muted">
            Browsers only report the total time to web pages.
          </p>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Header({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt className="text-fg-muted">{name}</dt>
      <dd className="min-w-0 break-all">{value}</dd>
    </>
  );
}
