import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { buttonClass, cx } from '../../components/ui';

/** Copies `text` to the clipboard and shows a check mark for a moment. */
export function CopyButton({
  text,
  label,
  icon,
  children,
  className = '',
  testId,
}: {
  text: string | (() => string);
  label: string;
  icon: ReactNode;
  children?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 1500);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <button
      type="button"
      aria-label={label}
      title={state === 'failed' ? 'Copy failed: the clipboard is not available' : label}
      data-testid={testId}
      data-state={state}
      onClick={() => {
        navigator.clipboard.writeText(typeof text === 'function' ? text() : text).then(
          () => setState('copied'),
          () => setState('failed'),
        );
      }}
      className={buttonClass({
        variant: 'ghost',
        size: 'xs',
        // `!`: wins over the ghost button's own text colours.
        className: cx(state === 'failed' && 'text-fail!', className),
      })}
    >
      {state === 'copied' ? <Check size={12} className="text-pass" aria-hidden /> : icon}
      {children}
    </button>
  );
}
