import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentPropsWithoutRef } from 'react';
import { forwardRef } from 'react';

import { cx } from './cx';

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

/** A row of soft pill tabs. */
export const TabsList = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cx('flex items-center gap-0.5', className)}
      {...props}
    />
  );
});

/** Classes of one pill tab, for tab rows that aren't Radix tabs. */
export const tabTriggerClass =
  'inline-flex h-7 shrink-0 cursor-default select-none items-center gap-1.5 rounded px-2.5 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg data-[state=active]:bg-hover data-[state=active]:font-medium data-[state=active]:text-fg aria-selected:bg-hover aria-selected:font-medium aria-selected:text-fg';

export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return <TabsPrimitive.Trigger ref={ref} className={cx(tabTriggerClass, className)} {...props} />;
});
