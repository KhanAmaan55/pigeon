import type { Collection, Folder } from '@pigeon/core';
import { findContainer } from '@pigeon/core';
import { exportCollection, exportCollectionText } from '@pigeon/formats';
import { TriangleAlert } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useId, useMemo, useState } from 'react';

import { usePlatform } from '../../app/PlatformProvider';
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
    <Dialog.Root open={container !== undefined} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="export-dialog"
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 w-[min(28rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface-raised p-4 text-sm text-fg shadow-xl"
        >
          {container && <ExportForm key={container.id} container={container} onDone={onClose} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
      <Dialog.Title className="text-base font-semibold">
        Export “{container.name}” as a Postman collection
      </Dialog.Title>
      <p className="text-fg-muted">
        Postman Collection v2.1{container.kind === 'folder' ? ' (this folder as a collection)' : ''}{' '}
        ·{' '}
        <span data-testid="export-file-name" className="font-mono">
          {result.fileName}
        </span>
      </p>
      <label htmlFor={`${id}-examples`} className="flex items-center gap-2">
        <input
          id={`${id}-examples`}
          type="checkbox"
          data-testid="export-include-examples"
          checked={includeExamples}
          onChange={(event) => setIncludeExamples(event.target.checked)}
        />
        Include examples (bodies inlined)
      </label>
      <label htmlFor={`${id}-metadata`} className="flex items-center gap-2">
        <input
          id={`${id}-metadata`}
          type="checkbox"
          data-testid="export-include-metadata"
          checked={includePigeonMetadata}
          onChange={(event) => setIncludePigeonMetadata(event.target.checked)}
        />
        Include Pigeon metadata (<code>_pigeon</code> keys; Postman ignores them)
      </label>
      {result.warnings.length > 0 && (
        <ul
          data-testid="export-warnings"
          className="flex flex-col gap-1 rounded border border-warn/40 bg-warn/10 p-2 text-xs"
        >
          {result.warnings.map((warning) => (
            <li key={warning} className="flex gap-1.5">
              <TriangleAlert size={12} className="mt-px shrink-0 text-warn" aria-hidden />
              {warning}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-fail">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Dialog.Close asChild>
          <button type="button" className="h-8 rounded border border-border px-3 hover:bg-hover">
            Cancel
          </button>
        </Dialog.Close>
        <button
          type="submit"
          data-testid="export-save"
          className="h-8 rounded bg-accent px-3 font-semibold text-accent-fg"
        >
          Export…
        </button>
      </div>
    </form>
  );
}
