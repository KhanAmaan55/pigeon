import { CircleCheck, CircleMinus, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ComparisonState } from '../request-editor/scratch-store';

interface BadgeView {
  label: string;
  icon: ReactNode;
  className: string;
  outcome: string;
}

export const OUTCOMES = {
  pass: { label: 'Pass', icon: <CircleCheck size={12} />, className: 'text-pass', outcome: 'pass' },
  warn: {
    label: 'Warn',
    icon: <TriangleAlert size={12} />,
    className: 'text-warn',
    outcome: 'warn',
  },
  fail: { label: 'Fail', icon: <CircleX size={12} />, className: 'text-fail', outcome: 'fail' },
} as const;

function badgeView(comparison: NonNullable<ComparisonState>): BadgeView {
  if (comparison.status === 'running') {
    return {
      label: 'Comparing…',
      icon: <LoaderCircle size={12} className="animate-spin" />,
      className: 'text-fg-muted',
      outcome: 'running',
    };
  }
  const { outcome } = comparison;
  switch (outcome.kind) {
    case 'no-baseline':
      return {
        label: 'No baseline',
        icon: <CircleMinus size={12} />,
        className: 'text-fg-muted',
        outcome: 'none',
      };
    case 'disabled':
      return {
        label: 'Off',
        icon: <CircleMinus size={12} />,
        className: 'text-fg-muted',
        outcome: 'disabled',
      };
    case 'baseline-not-found':
      return {
        label: 'Baseline not found',
        icon: <TriangleAlert size={12} />,
        className: 'text-warn',
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
      className={`inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-semibold hover:bg-hover ${view.className}`}
    >
      <span aria-hidden className="inline-flex">
        {view.icon}
      </span>
      {view.label}
    </button>
  );
}
