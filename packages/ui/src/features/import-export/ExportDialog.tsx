import type { Collection, Folder } from '@pigeon/core';
import { findContainer } from '@pigeon/core';
import { exportCollection, exportCollectionText } from '@pigeon/formats';
import { useId, useMemo, useState } from 'react';

import { usePlatform } from '../../app/PlatformProvider';
import {
  Button,
  Callout,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '../../components/ui';
import { useAppStore } from '../../stores/AppStoreProvider';

/**
 * Export a collection, or a folder as a collection, to a Postman v2.1 file (PIGN-029,
 * compatibility.md §A.5): include examples (on), include Pigeon metadata (off), then the save
 * dialog (desktop) or a download (web).
 */
export function ExportDialog({
  containerId,
  onClose,
}: {
  containerId: string | null;
  onClose: () => void;
}) {
  const project = useAppStore((s) => s.project);
  const container =
    containerId && project
      ? findContainer(project.session.getWorkingModel(), containerId)
      : undefined;
  return (
    <Dialog open={container !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent width="md" data-testid="export-dialog" aria-describedby={undefined}>
        {container && <ExportForm key={container.id} container={container} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ExportForm({ container, onDone }: { container: Collection | Folder; onDone: () => void }) {
  const { files } = usePlatform();
  const notify = useAppStore((s) => s.notify);
  const [includeExamples, setIncludeExamples] = useState(true);
  const [includePigeonMetadata, setIncludePigeonMetadata] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const result = useMemo(
    () => exportCollection(container, { includeExamples, includePigeonMetadata }),
    [container, includeExamples, includePigeonMetadata],
  );

  const save = async () => {
    setError(null);
    try {
      const outcome = await files.saveFile(
        result.fileName,
        exportCollectionText(result),
        'application/json',
      );
      if (outcome === 'saved') notify(`Exported ${result.fileName}.`);
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex flex-col gap-3"
    >
      <DialogTitle>Export “{container.name}” as a Postman collection</DialogTitle>
      <p className="-mt-1.5 text-fg-muted">
        Postman Collection v2.1{container.kind === 'folder' ? ' (this folder as a collection)' : ''}{' '}
        ·{' '}
        <span data-testid="export-file-name" className="font-mono text-xs text-fg">
          {result.fileName}
        </span>
      </p>
      <label htmlFor={`${id}-examples`} className="mt-1 flex items-center gap-2">
        <Checkbox
          id={`${id}-examples`}
          data-testid="export-include-examples"
          checked={includeExamples}
          onChange={(event) => setIncludeExamples(event.target.checked)}
        />
        Include examples (bodies inlined)
      </label>
      <label htmlFor={`${id}-metadata`} className="flex items-center gap-2">
        <Checkbox
          id={`${id}-metadata`}
          data-testid="export-include-metadata"
          checked={includePigeonMetadata}
          onChange={(event) => setIncludePigeonMetadata(event.target.checked)}
        />
        Include Pigeon metadata (<code className="font-mono text-xs">_pigeon</code> keys; Postman
        ignores them)
      </label>
      {result.warnings.length > 0 && (
        <Callout tone="warn">
          <ul data-testid="export-warnings" className="flex flex-col gap-1 text-xs">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Callout>
      )}
      {error && (
        <Callout tone="fail" role="alert">
          {error}
        </Callout>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button>Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="primary" data-testid="export-save">
          Export…
        </Button>
      </DialogFooter>
    </form>
  );
}
