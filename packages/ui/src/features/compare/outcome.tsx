import { CircleCheck, CircleMinus, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Tone } from '../../components/ui';
import type { ComparisonState } from '../request-editor/scratch-store';
import { chipClass } from '../response-viewer/StatusLine';

interface BadgeView {
  label: string;
  icon: ReactNode;
  tone: Exclude<Tone, 'accent'>;
  outcome: string;
}

export const OUTCOMES = {
  pass: { label: 'Pass', icon: <CircleCheck size={12} />, tone: 'pass', outcome: 'pass' },
  warn: { label: 'Warn', icon: <TriangleAlert size={12} />, tone: 'warn', outcome: 'warn' },
  fail: { label: 'Fail', icon: <CircleX size={12} />, tone: 'fail', outcome: 'fail' },
} as const satisfies Record<string, BadgeView>;

function badgeView(comparison: NonNullable<ComparisonState>): BadgeView {
  if (comparison.status === 'running') {
    return {
      label: 'Comparing…',
      icon: <LoaderCircle size={12} className="animate-spin" />,
      tone: 'neutral',
      outcome: 'running',
    };
  }
  const { outcome } = comparison;
  switch (outcome.kind) {
    case 'no-baseline':
      return {
        label: 'No baseline',
        icon: <CircleMinus size={12} />,
        tone: 'neutral',
        outcome: 'none',
      };
    case 'disabled':
      return {
        label: 'Off',
        icon: <CircleMinus size={12} />,
        tone: 'neutral',
        outcome: 'disabled',
      };
    case 'baseline-not-found':
      return {
        label: 'Baseline not found',
        icon: <TriangleAlert size={12} />,
        tone: 'warn',
        outcome: 'not-found',
      };
    case 'compared':
      return OUTCOMES[outcome.result.outcome];
  }
}

/** ✓ Pass / ⚠ Warn / ✗ Fail / — No baseline / Off, next to the status (PIGN-034/037). */
export function ComparisonBadge({
  comparison,
  onOpen,
}: {
  comparison: ComparisonState;
  onOpen: () => void;
}) {
  if (!comparison) return null;
  const view = badgeView(comparison);
  return (
    <button
      type="button"
      data-testid="comparison-badge"
      data-outcome={view.outcome}
      title="Comparison with the baseline example: open the Compare tab"
      onClick={onOpen}
      className={chipClass(view.tone, true)}
    >
      <span aria-hidden className="inline-flex">
        {view.icon}
      </span>
      {view.label}
    </button>
  );
}
