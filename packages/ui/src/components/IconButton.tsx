import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Tooltip } from './Tooltip';

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  icon: ReactNode;
  active?: boolean;
  /** Show an accent bar on the left edge while active (activity bar). */
  indicator?: boolean;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
};

export function IconButton({
  label,
  icon,
  active = false,
  indicator = false,
  tooltipSide,
  className = '',
  ...buttonProps
}: IconButtonProps) {
  return (
    <Tooltip content={label} side={tooltipSide}>
      <button
        type="button"
        aria-label={label}
        className={`inline-flex size-8 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50 ${
          active ? 'bg-hover text-fg' : ''
        } ${
          active && indicator
            ? 'relative before:absolute before:inset-y-1.5 before:-left-[6px] before:w-0.5 before:rounded-full before:bg-accent'
            : ''
        } ${className}`}
        {...buttonProps}
      >
        {icon}
      </button>
    </Tooltip>
  );
}
