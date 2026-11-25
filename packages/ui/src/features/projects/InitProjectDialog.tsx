import { useState } from 'react';

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
} from '../../components/ui';
import { useAppStore } from '../../stores/AppStoreProvider';
import { locationLabel } from '../../stores/locations';

/** "Initialize Pigeon project here?" for a picked folder without `pigeon.json` (PIGN-014). */
export function InitProjectDialog() {
  const pending = useAppStore((s) => s.pendingInit);
  const busy = useAppStore((s) => s.busy);
  const confirmInit = useAppStore((s) => s.confirmInit);
  const cancelInit = useAppStore((s) => s.cancelInit);
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && cancelInit()}>
      <DialogContent width="md" data-testid="init-project-dialog">
        <DialogTitle>Initialize Pigeon project here?</DialogTitle>
        <DialogDescription>
          {pending ? locationLabel(pending.location) : ''} has no <code>pigeon.json</code>. Pigeon
          will add <code>pigeon.json</code>, <code>.gitattributes</code>, an{' '}
          <code>INSTRUCTIONS.md</code> guide to the file format, and the <code>collections</code>,{' '}
          <code>environments</code> and <code>examples</code> folders. Other files are left alone.
        </DialogDescription>
        {pending && (
          // Keyed by the folder, so the name starts from its suggestion for each new folder.
          <InitForm
            key={locationLabel(pending.location)}
            suggestedName={pending.suggestedName}
            busy={busy}
            onConfirm={(name) => void confirmInit(name)}
          />
        )}
      </DialogContent>
    </Dialog>
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
      className="mt-4 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm(name);
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">Project name</span>
        <Input
          data-testid="init-project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <DialogFooter>
        <DialogClose asChild>
          <Button>Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="primary" disabled={busy} data-testid="init-project-confirm">
          Initialize
        </Button>
      </DialogFooter>
    </form>
  );
}
