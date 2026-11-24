import { Check, ChevronDown } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';

import { Button, menu } from '../../components/ui';
import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';
import { useCommand } from '../command-palette/CommandsProvider';

/** Environment selector in the top bar, per project (persisted in its local state). */
export function EnvironmentSelector() {
  const project = useAppStore((s) => s.project);
  const model = useProjectState((s) => s.model, null);
  const selected = useProjectState((s) => s.selectedEnvironmentId, null);
  const [open, setOpen] = useState(false);

  // Cmd/Ctrl+E opens the quick switcher (docs/ui-ux.md §4).
  useCommand('environment.switch', project ? () => setOpen(true) : undefined);

  const environments = model?.environments.filter((e) => !e.broken) ?? [];
  const current = environments.find((e) => e.id === selected);
  const item = (id: string | null, label: string) => (
    <DropdownMenu.Item
      key={id ?? 'none'}
      data-testid="environment-option"
      onSelect={() => project?.session.selectEnvironment(id)}
      className={menu.item}
    >
      <Check className={selected === id ? 'text-accent-text!' : 'invisible'} aria-hidden />
      {label}
    </DropdownMenu.Item>
  );
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={!project}
          data-testid="environment-selector"
          title="Environment (Ctrl/⌘ E)"
          className="max-w-48"
        >
          <span className="min-w-0 truncate">{current?.name ?? 'No environment'}</span>
          <ChevronDown className="shrink-0 opacity-70" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={menu.content}>
          {item(null, 'No environment')}
          {environments.length > 0 && <DropdownMenu.Separator className={menu.separator} />}
          {environments.map((environment) => item(environment.id, environment.name))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
