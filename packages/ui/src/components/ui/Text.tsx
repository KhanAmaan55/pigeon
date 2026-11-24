import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from './cx';

/** A quiet heading for a group of fields or a list section. */
export function SectionLabel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cx('text-xs font-medium text-fg-muted', className)} {...props}>
      {children}
    </div>
  );
}

/** Centered placeholder for an empty panel: icon, a line of text, an optional action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={cx(
        'flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-fg-muted',
        className,
      )}
      {...props}
    >
      {icon && (
        <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-hover text-fg-muted [&_svg]:size-5">
          {icon}
        </div>
      )}
      <div className="font-medium text-fg">{title}</div>
      {description && <div className="max-w-80">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
