import type { ComparisonResult, Finding, ProjectExample, Severity } from '@pigeon/core';
import type { NormalizedResponse } from '@pigeon/core';
import { CircleX, Info, LoaderCircle, TriangleAlert, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import type { ComparisonState } from '../request-editor/scratch-store';
import { OUTCOMES } from './outcome';
import { SideBySide } from './SideBySide';
import { indexJson, lineOf } from './json-lines';

const SEVERITY_ORDER: Record<Severity, number> = { fail: 0, warn: 1, info: 2, ignored: 3 };
const SECTIONS = [
  { id: 'status', title: 'Status' },
  { id: 'header', title: 'Headers' },
  { id: 'body', title: 'Body' },
] as const;

/** Findings by section (status / headers / body), each sorted by severity. */
export function groupFindings(findings: readonly Finding[]) {
  return SECTIONS.map((section) => ({
    ...section,
    findings: findings
      .filter((finding) => finding.kind.split('.')[0] === section.id)
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
  })).filter((section) => section.findings.length > 0);
}

const SEVERITY_ICONS: Record<Severity, ReactNode> = {
  fail: <CircleX size={14} className="text-fail" />,
  warn: <TriangleAlert size={14} className="text-warn" />,
  info: <Info size={14} className="text-fg-muted" />,
  ignored: <EyeOff size={14} className="text-fg-muted" />,
};

/**
 * Response panel → Compare (docs/ui-ux.md §3.7): outcome, counts and baseline name; the
 * findings (or the two bodies side by side, with + / − / ~ markers); "Show in body".
 */
export function CompareTab({
  comparison,
  baseline,
  response,
  onShowInBody,
}: {
  comparison: ComparisonState;
  /** The example the comparison used (for the side-by-side view). */
  baseline: ProjectExample | undefined;
  response: NormalizedResponse;
  onShowInBody: (line: number) => void;
}) {
  const [view, setView] = useState<'findings' | 'side-by-side'>('findings');
  const [selected, setSelected] = useState<{ finding: Finding; nonce: number } | null>(null);
  const actualIndex = useMemo(() => indexJson(response.bodyText ?? ''), [response.bodyText]);

  if (!comparison) {
    return (
      <p data-testid="compare-off" className="p-3 text-sm text-fg-muted">
        Not compared. Turn on “Compare responses with the baseline” in Settings, or send again.
      </p>
    );
  }
  if (comparison.status === 'running') {
    return (
      <p role="status" className="flex items-center gap-2 p-3 text-sm text-fg-muted">
        <LoaderCircle size={14} className="animate-spin" aria-hidden />
        Comparing with the baseline…
      </p>
    );
  }
  if (comparison.outcome.kind === 'no-baseline') {
    return (
      <p data-testid="compare-no-baseline" className="p-3 text-sm text-fg-muted">
        No baseline — Save as example to start tracking.
      </p>
    );
  }
  const result: ComparisonResult = comparison.outcome.result;
  const outcome = OUTCOMES[result.outcome];
  const groups = groupFindings(result.findings);

  return (
    <div data-testid="compare-tab" className="flex min-h-0 flex-1 flex-col text-sm">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-3 py-1.5">
        <span
          data-testid="compare-outcome"
          className={`inline-flex items-center gap-1 font-semibold ${outcome.className}`}
        >
          {outcome.icon}
          {outcome.label}
        </span>
        <span data-testid="compare-counts" className="text-xs text-fg-muted">
          {result.counts.fail} fail · {result.counts.warn} warn · {result.counts.info} info
          {result.counts.ignored > 0 ? ` · ${result.counts.ignored} ignored` : ''}
        </span>
        <span className="text-xs text-fg-muted">
          Baseline:{' '}
          <span data-testid="compare-baseline" className="text-fg">
            {result.exampleName}
          </span>
        </span>
        <div role="radiogroup" aria-label="Comparison view" className="ml-auto flex gap-1">
          {(['findings', 'side-by-side'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={view === candidate}
              data-testid={`compare-view-${candidate}`}
              onClick={() => setView(candidate)}
              className="h-6 rounded px-2 text-xs text-fg-muted hover:bg-hover hover:text-fg aria-checked:bg-hover aria-checked:text-fg"
            >
              {candidate === 'findings' ? 'Findings' : 'Side by side'}
            </button>
          ))}
        </div>
      </header>
      {view === 'findings' ? (
        groups.length === 0 ? (
          <p data-testid="compare-no-findings" className="p-3 text-fg-muted">
            The response matches the baseline.
          </p>
        ) : (
          <div data-testid="compare-findings" className="min-h-0 flex-1 overflow-auto">
            {groups.map((group) => (
              <section key={group.id} aria-label={group.title}>
                <h3 className="sticky top-0 bg-surface px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
                  {group.title}
                </h3>
                <ul>
                  {group.findings.map((finding, index) => {
                    const line = lineOf(actualIndex, finding.path, finding.schemaPath);
                    return (
                      <li
                        key={`${finding.kind}:${finding.schemaPath ?? finding.path ?? index}`}
                        data-testid="compare-finding"
                        data-severity={finding.severity}
                        data-kind={finding.kind}
                        className="flex items-start gap-2 border-b border-border/60 px-3 py-1.5 hover:bg-hover/50"
                      >
                        <span className="mt-0.5 shrink-0" aria-label={finding.severity}>
                          {SEVERITY_ICONS[finding.severity]}
                        </span>
                        <div className="min-w-0 flex-1">
                          {(finding.schemaPath ?? finding.path) && (
                            <span data-testid="compare-finding-path" className="font-mono text-xs">
                              {finding.schemaPath ?? finding.path}
                              {finding.count && finding.count > 1 ? (
                                <span className="ml-1 text-fg-muted">×{finding.count}</span>
                              ) : null}
                            </span>
                          )}
                          <p data-testid="compare-finding-message">{finding.message}</p>
                          {(finding.baseline !== undefined || finding.actual !== undefined) && (
                            <p className="font-mono text-xs text-fg-muted">
                              {String(finding.baseline ?? '—')} → {String(finding.actual ?? '—')}
                            </p>
                          )}
                        </div>
                        {line !== undefined && (
                          <button
                            type="button"
                            data-testid="compare-show-in-body"
                            onClick={() => onShowInBody(line)}
                            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-hover hover:text-fg"
                          >
                            Show in body
                          </button>
                        )}
                        <button
                          type="button"
                          data-testid="compare-show-side-by-side"
                          onClick={() => {
                            setSelected({ finding, nonce: Date.now() });
                            setView('side-by-side');
                          }}
                          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-hover hover:text-fg"
                        >
                          Compare
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : (
        <SideBySide
          baselineText={baseline?.response.body.kind === 'text' ? baseline.response.body.text : ''}
          actualIndex={actualIndex}
          findings={result.findings}
          selected={selected}
        />
      )}
    </div>
  );
}
