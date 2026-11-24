import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { forwardRef } from 'react';

import { cx } from './cx';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export type DialogWidth = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const widths: Record<DialogWidth, string> = {
  sm: 'w-[min(26rem,92vw)]',
  md: 'w-[min(30rem,92vw)]',
  lg: 'w-[min(40rem,92vw)]',
  xl: 'w-[min(48rem,94vw)]',
  '2xl': 'w-[min(56rem,94vw)]',
};

type ContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  width?: DialogWidth;
  /** No padding: the dialog lays out its own sections (lists, split panes). */
  flush?: boolean;
};

/** Portal, overlay and the dialog panel. Put `DialogTitle` first inside. */
export const DialogContent = forwardRef<HTMLDivElement, ContentProps>(function DialogContent(
  { width = 'md', flush = false, className, children, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-fade-in bg-overlay backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        ref={ref}
        className={cx(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] -translate-x-1/2 -translate-y-1/2 animate-pop-in flex-col rounded-xl border border-border bg-surface-raised text-sm text-fg shadow-lg focus:outline-none',
          widths[width],
          !flush && 'p-5',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export const DialogTitle = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cx('text-[15px] leading-6 font-semibold text-fg', className)}
      {...props}
    />
  );
});

export const DialogDescription = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cx('mt-1.5 text-fg-muted', className)}
      {...props}
    />
  );
});

/** The row of actions at the bottom, right-aligned. */
export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx('mt-5 flex items-center justify-end gap-2', className)}>{children}</div>
  );
}
