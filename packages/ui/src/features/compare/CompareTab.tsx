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

import type { Tone } from '../../components/ui';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  EmptyState,
  SectionLabel,
  Select,
} from '../../components/ui';
import type { ComparisonState } from '../request-editor/scratch-store';
import { chipClass } from '../response-viewer/StatusLine';
import { OUTCOMES } from './outcome';
import type { BaselineMode, ComparisonOverrides } from '../request-editor/scratch-store';
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
  fail: <CircleX size={12} />,
  warn: <TriangleAlert size={12} />,
  info: <Info size={12} />,
  ignored: <EyeOff size={12} />,
};

const SEVERITY_TONES: Record<Severity, Tone> = {
  fail: 'fail',
  warn: 'warn',
  info: 'info',
  ignored: 'neutral',
};

/** One option of a small segmented pill toggle (Findings / Side by side). */
const pillToggle =
  'h-6 cursor-default rounded-full px-2.5 text-xs text-fg-muted transition-colors hover:text-fg aria-checked:bg-surface-raised aria-checked:font-medium aria-checked:text-fg aria-checked:shadow-sm';

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
  baselineMode,
  onAccept,
  onSaveExample,
  schemaActions,
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
  /** Baseline selector (PIGN-037): auto, a pinned example, or disabled. */
  baselineMode?: {
    value: BaselineMode;
    examples: ReadonlyArray<{ id: string; name: string }>;
    onChange: (baseline: BaselineMode) => void;
  };
  /** "Accept as new baseline" (after confirmation) and "Save as new example". */
  onAccept?: () => void;
  onSaveExample?: () => void;
  /** "Copy / Export JSON Schema" of the baseline (PIGN-056). */
  schemaActions?: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
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
      <EmptyState
        data-testid="compare-off"
        title="Not compared. Turn on “Compare responses with the baseline” in Settings, or send again."
      />
    );
  }
  if (shown.status === 'running') {
    return (
      <p role="status" className="flex items-center gap-2 p-4 text-sm text-fg-muted">
        <LoaderCircle size={14} className="animate-spin" aria-hidden />
        Comparing with the baseline…
      </p>
    );
  }
  if (shown.outcome.kind === 'no-baseline') {
    return (
      <EmptyState
        data-testid="compare-no-baseline"
        title="No baseline — Save as example to start tracking."
      />
    );
  }
  if (shown.outcome.kind === 'disabled') {
    return (
      <div
        data-testid="compare-disabled"
        className="flex flex-wrap items-center gap-3 p-4 text-sm text-fg-muted"
      >
        Comparison is turned off for this request.
        {baselineMode && (
          <Button
            size="xs"
            data-testid="compare-enable"
            onClick={() => baselineMode.onChange({ mode: 'auto' })}
          >
            Turn on (auto baseline)
          </Button>
        )}
      </div>
    );
  }
  if (shown.outcome.kind === 'baseline-not-found') {
    return (
      <div className="p-4">
        <Callout tone="warn" data-testid="compare-baseline-not-found">
          <div className="flex flex-wrap items-center gap-3">
            Baseline not found: the pinned example no longer exists.
            {baselineMode && (
              <Button
                size="xs"
                data-testid="compare-use-auto"
                onClick={() => baselineMode.onChange({ mode: 'auto' })}
              >
                Use the auto baseline
              </Button>
            )}
          </div>
        </Callout>
      </div>
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
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <span data-testid="compare-outcome" className={chipClass(outcome.tone)}>
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
        {baselineMode && (
          <Select
            size="sm"
            aria-label="Baseline"
            data-testid="compare-baseline-mode"
            value={
              baselineMode.value.mode === 'example'
                ? `example:${baselineMode.value.exampleId}`
                : baselineMode.value.mode
            }
            onChange={(event) => {
              const value = event.target.value;
              baselineMode.onChange(
                value.startsWith('example:')
                  ? { mode: 'example', exampleId: value.slice('example:'.length) }
                  : value === 'none'
                    ? { mode: 'none' }
                    : { mode: 'auto' },
              );
            }}
            className="max-w-64"
          >
            <option value="auto">Auto (same status, else first)</option>
            {baselineMode.examples.map((example) => (
              <option key={example.id} value={`example:${example.id}`}>
                Pin: {example.name}
              </option>
            ))}
            <option value="none">Disable comparison</option>
          </Select>
        )}
        {schemaActions}
        <div
          role="radiogroup"
          aria-label="Comparison view"
          className="ml-auto flex items-center gap-0.5 rounded-full bg-sunken p-0.5"
        >
          {(['findings', 'side-by-side'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={view === candidate}
              data-testid={`compare-view-${candidate}`}
              onClick={() => setView(candidate)}
              className={pillToggle}
            >
              {candidate === 'findings' ? 'Findings' : 'Side by side'}
            </button>
          ))}
        </div>
      </header>
      {ignored > 0 && view === 'findings' && (
        <label className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-fg-muted">
          <Checkbox
            data-testid="compare-show-ignored"
            checked={showIgnored}
            onChange={(event) => setShowIgnored(event.target.checked)}
          />
          Show ignored ({ignored})
        </label>
      )}
      {view === 'findings' ? (
        groups.length === 0 ? (
          <p data-testid="compare-no-findings" className="p-4 text-fg-muted">
            The response matches the baseline.
          </p>
        ) : (
          <div data-testid="compare-findings" className="min-h-0 flex-1 overflow-auto">
            {groups.map((group) => (
              <section key={group.id} aria-label={group.title}>
                <SectionLabel
                  role="heading"
                  aria-level={2}
                  className="sticky top-0 z-10 bg-surface px-4 pt-3 pb-1.5"
                >
                  {group.title}
                </SectionLabel>
                <ul>
                  {group.findings.map((finding, index) => {
                    const line = lineOf(actualIndex, finding.path, finding.schemaPath);
                    return (
                      <li
                        key={`${finding.kind}:${finding.schemaPath ?? finding.path ?? index}`}
                        data-testid="compare-finding"
                        data-severity={finding.severity}
                        data-kind={finding.kind}
                        className="flex items-start gap-2.5 border-b border-border/60 px-4 py-2 transition-colors hover:bg-hover/50"
                      >
                        <Badge
                          tone={SEVERITY_TONES[finding.severity]}
                          aria-label={finding.severity}
                          className="mt-0.5"
                        >
                          {SEVERITY_ICONS[finding.severity]}
                        </Badge>
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
                          <Button
                            variant="ghost"
                            size="xs"
                            data-testid="compare-show-in-body"
                            onClick={() => onShowInBody(line)}
                          >
                            Show in body
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="xs"
                          data-testid="compare-show-side-by-side"
                          onClick={() => {
                            setSelected({ finding, nonce: Date.now() });
                            setView('side-by-side');
                          }}
                        >
                          Compare
                        </Button>
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
      {(onAccept || onSaveExample) && (
        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-2">
          {onAccept && result.outcome !== 'pass' && (
            <Button
              variant="primary"
              size="sm"
              data-testid="compare-accept"
              onClick={() => setConfirming(true)}
            >
              Accept as new baseline
            </Button>
          )}
          {onSaveExample && (
            <Button size="sm" data-testid="compare-save-example" onClick={onSaveExample}>
              Save as new example
            </Button>
          )}
        </footer>
      )}
      {onAccept && (
        <AcceptDialog
          open={confirming}
          exampleName={result.exampleName}
          findings={result.findings.filter((f) => f.severity !== 'ignored')}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onAccept();
          }}
        />
      )}
      {rules && (
        <details
          data-testid="compare-rules"
          className="max-h-[50%] shrink-0 overflow-auto border-t border-border px-4 py-2"
        >
          <summary className="cursor-default text-xs font-medium text-fg-muted select-none hover:text-fg">
            Rules ({rules.request.length} request · {rules.project.length} project)
          </summary>
          <h4 className="pt-3 pb-1.5 text-xs font-medium text-fg-muted">
            This request (compare.json)
          </h4>
          <RequestOverrides overrides={rules.overrides} onChange={rules.onOverrides} />
          <div className="h-2" />
          <RulesTable rules={rules.request} onChange={rules.onChange} testId="request-rules" />
          <h4 className="flex items-center gap-2 pt-4 pb-1.5 text-xs font-medium text-fg-muted">
            Project (pigeon.json, read-only here)
            {onEditProjectRules && (
              <button
                type="button"
                data-testid="edit-project-rules"
                onClick={onEditProjectRules}
                className="rounded font-normal text-accent-text underline-offset-2 hover:underline"
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
    <div className="flex shrink-0 gap-0.5">
      {actions.map((action) => (
        <Button
          key={action.testId}
          variant="ghost"
          size="xs"
          data-testid={action.testId}
          title={`Add a rule for ${path}`}
          onClick={() => onAddRule(action.rule)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

/** "Accept as new baseline?": what the accept replaces and which findings go away (§6). */
function AcceptDialog({
  open,
  exampleName,
  findings,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  exampleName: string;
  findings: readonly Finding[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent width="md" data-testid="accept-dialog">
        <DialogTitle>Accept as new baseline?</DialogTitle>
        <DialogDescription>
          The example “{exampleName}” gets this response (status, headers without volatile ones,
          body) and the current request definition. These {findings.length} finding
          {findings.length === 1 ? '' : 's'} will go away. Until you save it for commit, discarding
          the change brings the old baseline back.
        </DialogDescription>
        <ul
          data-testid="accept-findings"
          className="mt-3 max-h-40 overflow-auto rounded-lg bg-sunken px-3 py-2 text-xs"
        >
          {findings.slice(0, 20).map((finding, index) => (
            <li key={index} className="truncate leading-5">
              <span className="font-mono">
                {finding.schemaPath ?? finding.path ?? finding.kind}
              </span>{' '}
              — {finding.message}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button variant="primary" data-testid="accept-confirm" onClick={onConfirm}>
            Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
