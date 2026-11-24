import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Tooltip } from './Tooltip';

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  icon: ReactNode;
  active?: boolean;
  /** Show the active state in the accent colour (activity bar). */
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
        className={`inline-flex size-8 items-center justify-center rounded-md text-fg-muted transition-colors duration-100 hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50 ${
          active && indicator
            ? 'bg-selected text-accent-text hover:bg-selected hover:text-accent-text'
            : active
              ? 'bg-hover text-fg'
              : ''
        } ${className}`}
        {...buttonProps}
      >
        {icon}
      </button>
    </Tooltip>
  );
}
