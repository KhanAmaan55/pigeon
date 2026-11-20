import type {
  ComparisonResult,
  Finding,
  ProjectExample,
  ProjectFieldRule,
  Severity,
} from '@pigeon/core';
import type { NormalizedResponse } from '@pigeon/core';
import { CircleX, Info, LoaderCircle, TriangleAlert, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import type { ComparisonState } from '../request-editor/scratch-store';
import { OUTCOMES } from './outcome';
import type { ComparisonOverrides } from '../request-editor/scratch-store';
import { RequestOverrides } from './RequestOverrides';
import { RulesTable } from './RulesTable';
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
  onAddRule,
  rules,
  onEditProjectRules,
}: {
  comparison: ComparisonState;
  /** The example the comparison used (for the side-by-side view). */
  baseline: ProjectExample | undefined;
  response: NormalizedResponse;
  onShowInBody: (line: number) => void;
  /** Row actions (Mark optional, Allow null, Ignore, Mark dynamic); absent = read-only. */
  onAddRule?: (rule: ProjectFieldRule) => void;
  /** The rules panel. */
  rules?: {
    request: ProjectFieldRule[];
    project: ProjectFieldRule[];
    onChange: (rules: ProjectFieldRule[]) => void;
    overrides: ComparisonOverrides;
    onOverrides: (patch: ComparisonOverrides) => void;
  };
  onEditProjectRules?: () => void;
}) {
  const [view, setView] = useState<'findings' | 'side-by-side'>('findings');
  const [showIgnored, setShowIgnored] = useState(false);
  // While a new comparison runs (e.g. after a rule change), keep showing the last result so the
  // panel (and an open rules editor) stays put.
  const [lastDone, setLastDone] = useState<ComparisonState>(null);
  if (comparison?.status === 'done' && comparison !== lastDone) setLastDone(comparison);
  const rerunning = comparison?.status === 'running' && lastDone !== null;
  const shown = rerunning ? lastDone : comparison;
  const [selected, setSelected] = useState<{ finding: Finding; nonce: number } | null>(null);
  const actualIndex = useMemo(() => indexJson(response.bodyText ?? ''), [response.bodyText]);

  if (!shown) {
    return (
      <p data-testid="compare-off" className="p-3 text-sm text-fg-muted">
        Not compared. Turn on “Compare responses with the baseline” in Settings, or send again.
      </p>
    );
  }
  if (shown.status === 'running') {
    return (
      <p role="status" className="flex items-center gap-2 p-3 text-sm text-fg-muted">
        <LoaderCircle size={14} className="animate-spin" aria-hidden />
        Comparing with the baseline…
      </p>
    );
  }
  if (shown.outcome.kind === 'no-baseline') {
    return (
      <p data-testid="compare-no-baseline" className="p-3 text-sm text-fg-muted">
        No baseline — Save as example to start tracking.
      </p>
    );
  }
  const result: ComparisonResult = shown.outcome.result;
  const outcome = OUTCOMES[result.outcome];
  const ignored = result.findings.filter((f) => f.severity === 'ignored').length;
  const groups = groupFindings(
    showIgnored ? result.findings : result.findings.filter((f) => f.severity !== 'ignored'),
  );

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
        {rerunning && (
          <LoaderCircle size={12} className="animate-spin text-fg-muted" aria-label="Comparing…" />
        )}
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
      {ignored > 0 && view === 'findings' && (
        <label className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1 text-xs text-fg-muted">
          <input
            type="checkbox"
            data-testid="compare-show-ignored"
            checked={showIgnored}
            onChange={(event) => setShowIgnored(event.target.checked)}
          />
          Show ignored ({ignored})
        </label>
      )}
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
                        {onAddRule && <RuleActions finding={finding} onAddRule={onAddRule} />}
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
      {rules && (
        <details
          data-testid="compare-rules"
          className="max-h-[50%] shrink-0 overflow-auto border-t border-border px-3 py-1.5"
        >
          <summary className="cursor-default text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Rules ({rules.request.length} request · {rules.project.length} project)
          </summary>
          <h4 className="pt-2 pb-1 text-xs text-fg-muted">This request (compare.json)</h4>
          <RequestOverrides overrides={rules.overrides} onChange={rules.onOverrides} />
          <div className="h-2" />
          <RulesTable rules={rules.request} onChange={rules.onChange} testId="request-rules" />
          <h4 className="flex items-center gap-2 pt-3 pb-1 text-xs text-fg-muted">
            Project (pigeon.json, read-only here)
            {onEditProjectRules && (
              <button
                type="button"
                data-testid="edit-project-rules"
                onClick={onEditProjectRules}
                className="rounded px-1 text-accent hover:underline"
              >
                Edit in project settings
              </button>
            )}
          </h4>
          <RulesTable rules={rules.project} testId="project-rules" />
        </details>
      )}
    </div>
  );
}

/** "Mark optional", "Allow null", "Ignore", "Mark dynamic" for a finding (§6), at its schema path. */
function RuleActions({
  finding,
  onAddRule,
}: {
  finding: Finding;
  onAddRule: (rule: ProjectFieldRule) => void;
}) {
  const path = finding.schemaPath ?? finding.path;
  // Rules are about body paths; status and header findings have their own settings.
  if (!path || !path.startsWith('$') || finding.severity === 'ignored') return null;
  const actions: Array<{ label: string; testId: string; rule: ProjectFieldRule }> = [];
  if (finding.kind === 'body.field.removed') {
    actions.push({
      label: 'Mark optional',
      testId: 'finding-mark-optional',
      rule: { path, optional: true },
    });
  }
  if (
    finding.kind === 'body.type.changed' &&
    (finding.baseline === 'null' || finding.actual === 'null')
  ) {
    actions.push({
      label: 'Allow null',
      testId: 'finding-allow-null',
      rule: { path, nullable: true },
    });
  }
  if (finding.kind === 'body.value.changed') {
    actions.push({
      // A generated-looking value (§5) is only a suggestion.
      label: finding.hint ? 'Mark as dynamic?' : 'Mark dynamic',
      testId: 'finding-mark-dynamic',
      rule: { path, dynamic: true },
    });
  }
  actions.push({ label: 'Ignore', testId: 'finding-ignore', rule: { path, ignore: true } });
  return (
    <div className="flex shrink-0 gap-1">
      {actions.map((action) => (
        <button
          key={action.testId}
          type="button"
          data-testid={action.testId}
          title={`Add a rule for ${path}`}
          onClick={() => onAddRule(action.rule)}
          className="rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-hover hover:text-fg"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
