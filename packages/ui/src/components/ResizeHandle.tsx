import { Separator } from 'react-resizable-panels';

/**
 * Thin divider between resizable panels. The library sets `data-separator` to
 * inactive | hover | active | disabled, which drives the highlight.
 */
export function ResizeHandle({
  direction,
  variant = 'line',
  testId,
}: {
  /** Direction the panels are laid out in: `horizontal` → vertical line. */
  direction: 'horizontal' | 'vertical';
  /** `gutter`: an invisible gap between the sidebar and the work panel, lit while dragged. */
  variant?: 'line' | 'gutter';
  testId: string;
}) {
  if (variant === 'gutter') {
    return (
      <Separator
        data-testid={testId}
        className="group relative w-1.5 shrink-0 before:absolute before:inset-y-2 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:rounded-full before:transition-colors data-[separator=active]:before:bg-accent data-[separator=hover]:before:bg-border-strong"
      />
    );
  }
  return (
    <Separator
      data-testid={testId}
      className={`${
        direction === 'horizontal' ? 'w-px' : 'h-px'
      } bg-border transition-colors data-[separator=active]:bg-accent data-[separator=hover]:bg-accent`}
    />
  );
}
