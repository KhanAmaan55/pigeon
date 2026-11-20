import { Dialog } from 'radix-ui';
import { useState } from 'react';

import { useAppStore } from '../../stores/AppStoreProvider';
import { locationLabel } from '../../stores/locations';

/** "Initialize Pigeon project here?" for a picked folder without `pigeon.json` (PIGN-014). */
export function InitProjectDialog() {
  const pending = useAppStore((s) => s.pendingInit);
  const busy = useAppStore((s) => s.busy);
  const confirmInit = useAppStore((s) => s.confirmInit);
  const cancelInit = useAppStore((s) => s.cancelInit);
  return (
    <Dialog.Root open={pending !== null} onOpenChange={(open) => !open && cancelInit()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="init-project-dialog"
          className="fixed top-1/2 left-1/2 w-[min(28rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface-raised p-4 text-sm text-fg shadow-xl"
        >
          <Dialog.Title className="text-base font-semibold">
            Initialize Pigeon project here?
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-fg-muted">
            {pending ? locationLabel(pending.location) : ''} has no <code>pigeon.json</code>. Pigeon
            will add <code>pigeon.json</code>, <code>.gitattributes</code> and the{' '}
            <code>collections</code>, <code>environments</code> and <code>examples</code> folders.
            Other files are left alone.
          </Dialog.Description>
          {pending && (
            // Keyed by the folder, so the name starts from its suggestion for each new folder.
            <InitForm
              key={locationLabel(pending.location)}
              suggestedName={pending.suggestedName}
              busy={busy}
              onConfirm={(name) => void confirmInit(name)}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InitForm({
  suggestedName,
  busy,
  onConfirm,
}: {
  suggestedName: string;
  busy: boolean;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(suggestedName);
  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm(name);
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-fg-muted">Project name</span>
        <input
          data-testid="init-project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-8 rounded border border-border bg-bg px-2"
        />
      </label>
      <div className="flex justify-end gap-2">
        <Dialog.Close asChild>
          <button type="button" className="h-8 rounded border border-border px-3 hover:bg-hover">
            Cancel
          </button>
        </Dialog.Close>
        <button
          type="submit"
          disabled={busy}
          data-testid="init-project-confirm"
          className="h-8 rounded bg-accent px-3 font-semibold text-accent-fg disabled:opacity-60"
        >
          Initialize
        </button>
      </div>
    </form>
  );
}
