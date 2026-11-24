import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';

import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** An icon before the label (lucide, sized by the button). */
  icon?: ReactNode;
};

const base =
  'inline-flex shrink-0 cursor-default select-none items-center justify-center whitespace-nowrap rounded font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50';

const sizes: Record<ButtonSize, string> = {
  xs: 'h-6 gap-1 px-2 text-xs [&_svg]:size-3',
  sm: 'h-7 gap-1.5 px-2.5 text-sm [&_svg]:size-3.5',
  md: 'h-8 gap-1.5 px-3 text-base [&_svg]:size-4',
};

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg shadow-sm hover:bg-accent-hover',
  secondary:
    'border border-border bg-surface-raised text-fg shadow-sm hover:border-border-strong hover:bg-hover',
  ghost: 'text-fg-muted hover:bg-hover hover:text-fg',
  danger:
    'border border-border bg-surface-raised text-fail shadow-sm hover:border-fail/40 hover:bg-fail/10',
  link: 'h-auto px-0 text-accent-text underline-offset-2 hover:underline',
};

/** Classes for something that looks like a button but isn't one (a label, an anchor). */
export function buttonClass({
  variant = 'secondary',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string | undefined } = {}): string {
  return cx(base, sizes[size], variants[variant], variant === 'link' && 'px-0', className);
}

/** The app's button. `className` is for layout (margins, flex, width), not looks. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass({ variant, size, className })} {...props}>
      {icon}
      {children}
    </button>
  );
});
