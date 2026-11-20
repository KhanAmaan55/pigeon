import { Check, ChevronDown } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useEffect, useState } from 'react';

import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';

/** Cmd/Ctrl+E opens the quick switcher (docs/ui-ux.md §4). */
export function isEnvironmentShortcut(event: KeyboardEvent): boolean {
  return (
    event.code === 'KeyE' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey
  );
}

/** Environment selector in the top bar, per project (persisted in its local state). */
export function EnvironmentSelector() {
  const project = useAppStore((s) => s.project);
  const model = useProjectState((s) => s.model, null);
  const selected = useProjectState((s) => s.selectedEnvironmentId, null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!project) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isEnvironmentShortcut(event)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [project]);

  const environments = model?.environments.filter((e) => !e.broken) ?? [];
  const current = environments.find((e) => e.id === selected);
  const item = (id: string | null, label: string) => (
    <DropdownMenu.Item
      key={id ?? 'none'}
      data-testid="environment-option"
      onSelect={() => project?.session.selectEnvironment(id)}
      className="flex cursor-default items-center gap-2 rounded px-2 py-1 outline-none data-[highlighted]:bg-hover"
    >
      <Check size={12} className={selected === id ? '' : 'invisible'} aria-hidden />
      {label}
    </DropdownMenu.Item>
  );
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={!project}
          data-testid="environment-selector"
          title="Environment (Ctrl/⌘ E)"
          className="inline-flex h-7 max-w-48 items-center gap-1 rounded border border-border px-2 text-sm text-fg-muted hover:bg-hover disabled:opacity-60"
        >
          <span className="truncate">{current?.name ?? 'No environment'}</span>
          <ChevronDown size={14} className="shrink-0" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="z-50 min-w-48 rounded-md border border-border bg-surface-raised p-1 text-sm text-fg shadow-lg"
        >
          {item(null, 'No environment')}
          {environments.length > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
          {environments.map((environment) => item(environment.id, environment.name))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
