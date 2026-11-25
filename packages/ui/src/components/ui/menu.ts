/**
 * Styles for Radix dropdown and context menus (their parts differ, so these are classes, not
 * components): `<DropdownMenu.Content className={menu.content}>`.
 */
export const menu = {
  content:
    'z-50 min-w-48 animate-pop-in rounded-lg border border-border bg-surface-raised p-1.5 text-base text-fg shadow-md focus:outline-none',
  item: 'flex h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover [&_svg]:size-3.5 [&_svg]:text-fg-muted',
  danger:
    'flex h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-fail outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-fail/10 [&_svg]:size-3.5',
  separator: 'mx-1 my-1.5 h-px bg-border',
  label: 'px-2.5 pt-2 pb-1 text-xs font-semibold text-fg-muted',
  shortcut: 'ml-auto pl-4 font-mono text-[10px] text-fg-muted',
} as const;
