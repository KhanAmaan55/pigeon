import type { ComparisonState } from '../request-editor/scratch-store';
import { CircleCheck, CircleMinus, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react';

/** ✓ Pass / ⚠ Warn / ✗ Fail / — No baseline, next to the status (PIGN-034). */
export function ComparisonBadge({
  comparison,
  onOpen,
}: {
  comparison: ComparisonState;
  onOpen: () => void;
}) {
  if (!comparison) return null;
  const view =
    comparison.status === 'running'
      ? {
          label: 'Comparing…',
          icon: <LoaderCircle size={12} className="animate-spin" />,
          className: 'text-fg-muted',
          outcome: 'running',
        }
      : comparison.outcome.kind === 'no-baseline'
        ? {
            label: 'No baseline',
            icon: <CircleMinus size={12} />,
            className: 'text-fg-muted',
            outcome: 'none',
          }
        : OUTCOMES[comparison.outcome.result.outcome];
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
