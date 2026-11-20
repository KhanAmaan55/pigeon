import type { CollectionImportPlan, ImportPreview } from '@pigeon/core';
import { planEntityIds, renamePlan, usedIds } from '@pigeon/core';
import type { PickedFile } from '@pigeon/platform';
import { FileJson, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';

import { useAppStore } from '../../stores/AppStoreProvider';
import type { OpenProject } from '../../stores/app-store';
import { runImportPreview } from './run-import';

/**
 * The import preview (docs/ui-ux.md §3.9, PIGN-028) for the file waiting in
 * `AppState.pendingImport`: detected format, counts, warnings and id regenerations, the new
 * collection's name, and **Import & write files** (drafts, then Save for Commit of just them) or
 * **Import as local drafts**.
 */
export function ImportDialog() {
  const file = useAppStore((s) => s.pendingImport);
  const project = useAppStore((s) => s.project);
  const setPending = useAppStore((s) => s.setPendingImport);
  const open = file !== null && project !== null;
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && setPending(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="import-dialog"
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 flex max-h-[85vh] w-[min(34rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface-raised p-4 text-sm text-fg shadow-xl"
        >
          {open && (
            // A new file starts a new preview.
            <ImportPreviewPanel
              key={`${file.name}:${file.bytes.byteLength}`}
              file={file}
              project={project}
              onDone={() => setPending(null)}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ImportPreviewPanel({
  file,
  project,
  onDone,
}: {
  file: PickedFile;
  project: OpenProject;
  onDone: () => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [name, setName] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void runImportPreview(file.bytes, usedIds(project.session.getWorkingModel())).then((result) => {
      if (!current) return;
      setPreview(result);
      if (result.ok) setName(result.plan.collection.name);
    });
    return () => {
      current = false;
    };
  }, [file, project]);

  const apply = async (write: boolean) => {
    if (!preview?.ok) return;
    const plan: CollectionImportPlan = renamePlan(preview.plan, name);
    const { session, store } = project;
    setWorking(true);
    setError(null);
    try {
      session.apply({ type: 'importCollection', collection: plan.collection });
      const ids = planEntityIds(plan);
      const { requests } = plan.report.counts;
      if (write) {
        const { result } = await session.saveForCommit(ids);
        const files = result.written.length;
        notify(
          `Imported ${requests} request${requests === 1 ? '' : 's'}; wrote ${files} file${files === 1 ? '' : 's'}.`,
        );
      } else {
        await session.save(ids);
        notify(`Imported ${requests} request${requests === 1 ? '' : 's'} as local drafts.`);
      }
      store.getState().setExpanded(plan.collection.id, true);
      store.getState().select(plan.collection.id);
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <Dialog.Title className="flex items-center gap-2 text-base font-semibold">
        <FileJson size={16} className="shrink-0 text-fg-muted" aria-hidden />
        <span className="min-w-0 truncate">Import {file.name}</span>
      </Dialog.Title>
      {preview === null ? (
        <p
          role="status"
          data-testid="import-progress"
          className="mt-4 flex items-center gap-2 text-fg-muted"
        >
          <LoaderCircle size={14} className="animate-spin" aria-hidden />
          Reading the file…
        </p>
      ) : !preview.ok ? (
        <div className="mt-3 flex flex-col gap-3">
          {preview.format && (
            <p data-testid="import-format" className="text-fg-muted">
              Detected: {preview.format}
            </p>
          )}
          <p role="alert" data-testid="import-rejected" className="text-fail">
            {preview.message}
          </p>
          <div className="flex justify-end">
            <Dialog.Close asChild>
              <button
                type="button"
                className="h-8 rounded border border-border px-3 hover:bg-hover"
              >
                Close
              </button>
            </Dialog.Close>
          </div>
        </div>
      ) : (
        <form
          className="mt-3 flex min-h-0 flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void apply(true);
          }}
        >
          <p data-testid="import-format" className="text-fg-muted">
            Detected: {preview.plan.format}
          </p>
          <dl data-testid="import-counts" className="grid grid-cols-3 gap-2 text-center">
            {(['folders', 'requests', 'examples'] as const).map((key) => (
              <div key={key} className="rounded border border-border px-2 py-1">
                <dt className="text-xs text-fg-muted capitalize">{key}</dt>
                <dd data-testid={`import-count-${key}`} className="font-mono text-base">
                  {preview.plan.report.counts[key]}
                </dd>
              </div>
            ))}
          </dl>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">New collection</span>
            <input
              data-testid="import-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-8 rounded border border-border bg-bg px-2 text-fg"
            />
          </label>
          {(preview.plan.report.warnings.length > 0 ||
            preview.plan.report.regeneratedIds.length > 0) && (
            <ul
              data-testid="import-warnings"
              className="flex max-h-48 min-h-0 flex-col gap-1 overflow-auto rounded border border-warn/40 bg-warn/10 p-2 text-xs"
            >
              {preview.plan.report.warnings.map((warning) => (
                <li key={warning} data-testid="import-warning" className="flex gap-1.5">
                  <TriangleAlert size={12} className="mt-px shrink-0 text-warn" aria-hidden />
                  <span>{warning}</span>
                </li>
              ))}
              {preview.plan.report.regeneratedIds.map((id) => (
                <li key={`${id.kind}:${id.from}:${id.to}`} data-testid="import-regenerated-id">
                  New id for {id.kind} “{id.name}” ({id.from} is already used).
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="text-fail">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="h-8 rounded border border-border px-3 hover:bg-hover"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              data-testid="import-as-drafts"
              disabled={working || name.trim() === '' || project.session.readOnly}
              onClick={() => void apply(false)}
              className="h-8 rounded border border-border px-3 hover:bg-hover disabled:opacity-50"
            >
              Import as local drafts
            </button>
            <button
              type="submit"
              data-testid="import-write"
              disabled={working || name.trim() === '' || project.session.readOnly}
              className="h-8 rounded bg-accent px-3 font-semibold text-accent-fg disabled:opacity-50"
            >
              Import &amp; write files
            </button>
          </div>
        </form>
      )}
    </>
  );
}
