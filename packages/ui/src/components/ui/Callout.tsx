import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

import type { Tone } from './Badge';
import { cx } from './cx';

type CalloutTone = Exclude<Tone, 'accent'>;

const tones: Record<CalloutTone, { box: string; icon: string; Icon: typeof Info }> = {
  neutral: { box: 'border-border bg-sunken', icon: 'text-fg-muted', Icon: Info },
  info: { box: 'border-info/25 bg-info/8', icon: 'text-info', Icon: Info },
  pass: { box: 'border-pass/25 bg-pass/8', icon: 'text-pass', Icon: CircleCheck },
  warn: { box: 'border-warn/30 bg-warn/8', icon: 'text-warn', Icon: TriangleAlert },
  fail: { box: 'border-fail/25 bg-fail/8', icon: 'text-fail', Icon: CircleX },
};

/** A tinted box for a notice, warning or error, with an icon for its tone. */
export function Callout({
  tone = 'neutral',
  icon,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: CalloutTone;
  /** Replaces the tone's icon; `null` for none. */
  icon?: ReactNode;
  children: ReactNode;
}) {
  const { box, icon: iconClass, Icon } = tones[tone];
  return (
    <div
      className={cx('flex gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm text-fg', box, className)}
      {...props}
    >
      {icon === undefined ? (
        <Icon aria-hidden className={cx('mt-0.5 size-3.5 shrink-0', iconClass)} />
      ) : (
        icon
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
