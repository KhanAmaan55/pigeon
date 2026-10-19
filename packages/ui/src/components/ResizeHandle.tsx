import { Separator } from 'react-resizable-panels';

/**
 * Thin divider between resizable panels. The library sets `data-separator` to
 * inactive | hover | active | disabled, which drives the highlight.
 */
export function ResizeHandle({
  direction,
  testId,
}: {
  /** Direction the panels are laid out in: `horizontal` → vertical line. */
  direction: 'horizontal' | 'vertical';
  testId: string;
}) {
  return (
    <Separator
      data-testid={testId}
      className={`${
        direction === 'horizontal' ? 'w-px' : 'h-px'
      } bg-border transition-colors data-[separator=active]:bg-accent data-[separator=hover]:bg-accent`}
    />
  );
}
