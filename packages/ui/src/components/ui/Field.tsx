import { ChevronDown } from 'lucide-react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { forwardRef } from 'react';

import { cx } from './cx';

export type FieldSize = 'sm' | 'md';

const field =
  'w-full min-w-0 rounded border border-border bg-sunken text-fg transition-colors placeholder:text-fg-muted hover:border-border-strong focus:border-accent focus:bg-bg focus:ring-3 focus:ring-focus focus:outline-none focus-visible:outline-none disabled:opacity-60 aria-[invalid=true]:border-fail';

const heights: Record<FieldSize, string> = {
  sm: 'h-7 px-2 text-sm',
  md: 'h-8 px-2.5 text-base',
};

/** Classes of a text field, for inputs owned by other components (CodeMirror, custom inputs). */
export function fieldClass({
  size = 'md',
  mono = false,
  className,
}: { size?: FieldSize; mono?: boolean; className?: string | undefined } = {}): string {
  return cx(field, heights[size], mono && 'font-mono', className);
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: FieldSize;
  mono?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', mono = false, className, ...props },
  ref,
) {
  return <input ref={ref} className={fieldClass({ size, mono, className })} {...props} />;
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { mono = false, className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cx(field, 'min-h-16 px-2.5 py-1.5 text-base', mono && 'font-mono', className)}
      {...props}
    />
  );
});

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  size?: FieldSize;
  mono?: boolean;
  /** Classes for the wrapper (layout: width, flex). */
  className?: string;
};

/** A native select (keyboard and screen-reader friendly) with the app's field look. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', mono = false, className, children, ...props },
  ref,
) {
  return (
    <span className={cx('relative inline-flex min-w-0', className)}>
      <select
        ref={ref}
        className={cx(fieldClass({ size, mono }), 'cursor-default appearance-none pr-7')}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-fg-muted"
      />
    </span>
  );
});

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cx('size-3.5 shrink-0 cursor-default rounded-sm accent-accent', className)}
      {...props}
    />
  );
});
