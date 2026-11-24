import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from './cx';

export type Tone = 'neutral' | 'accent' | 'pass' | 'warn' | 'fail' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-hover text-fg-muted',
  accent: 'bg-accent/15 text-accent-text',
  pass: 'bg-pass/12 text-pass',
  warn: 'bg-warn/12 text-warn',
  fail: 'bg-fail/12 text-fail',
  info: 'bg-info/12 text-info',
};

/** A small rounded label or count (tab counts, states). */
export function Badge({
  tone = 'neutral',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex h-4 min-w-4 shrink-0 items-center justify-center gap-1 rounded-full px-1.5 text-[10px] leading-none font-semibold',
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** A keyboard key or shortcut. */
export function Kbd({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-4 items-center rounded-sm border border-border bg-sunken px-1 font-mono text-[10px] text-fg-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
