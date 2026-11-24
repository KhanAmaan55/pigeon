/**
 * Styles for Radix dropdown and context menus (their parts differ, so these are classes, not
 * components): `<DropdownMenu.Content className={menu.content}>`.
 */
export const menu = {
  content:
    'z-50 min-w-44 animate-pop-in rounded-lg border border-border bg-surface-raised p-1 text-sm text-fg shadow-md focus:outline-none',
  item: 'flex h-7 cursor-default select-none items-center gap-2 rounded px-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover [&_svg]:size-3.5 [&_svg]:text-fg-muted',
  danger:
    'flex h-7 cursor-default select-none items-center gap-2 rounded px-2 text-fail outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-fail/10 [&_svg]:size-3.5',
  separator: 'my-1 h-px bg-border',
  label: 'px-2 pt-1.5 pb-1 text-xs font-medium text-fg-muted',
  shortcut: 'ml-auto pl-4 font-mono text-[10px] text-fg-muted',
} as const;
