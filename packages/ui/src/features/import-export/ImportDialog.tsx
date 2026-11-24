import type { ImportItem } from '@pigeon/core';
import {
  applyImport,
  importContext,
  isValidVariableName,
  placementOf,
  withBaseUrlVariable,
} from '@pigeon/core';
import type { PickedFile } from '@pigeon/platform';
import { FileJson, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { useEffect, useId, useMemo, useState } from 'react';

import { targetContainerId } from '../explorer/actions';
import { useAppStore } from '../../stores/AppStoreProvider';
import type { OpenProject } from '../../stores/app-store';
import { runImportPreview } from './run-import';

/**
 * The import preview (docs/ui-ux.md §3.9, PIGN-028/030) for the files waiting in
 * `AppState.pendingImport`, combined into one confirmation: per file the detected format,
 * counts, warnings and id regenerations; editable collection names; what to do with an
 * environment named like an existing one; "also use imported values as my current values"; the
 * variable name for Apidog / Echo API base URLs (PIGN-048/049).
 * **Import & write files** commits just the imported entities; **Import as local drafts** saves.
 */
export function ImportDialog() {
  const files = useAppStore((s) => s.pendingImport);
  const project = useAppStore((s) => s.project);
  const setPending = useAppStore((s) => s.setPendingImport);
  const open = files !== null && project !== null;
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && setPending(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="import-dialog"
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 flex max-h-[85vh] w-[min(36rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface-raised p-4 text-sm text-fg shadow-xl"
        >
          {open && (
            <ImportPreviewPanel
              key={files.map((f) => `${f.name}:${f.bytes.byteLength}`).join('|')}
              files={files}
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
  files,
  project,
  onDone,
}: {
  files: PickedFile[];
  project: OpenProject;
  onDone: () => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const [previewed, setItems] = useState<ImportItem[] | null>(null);
  const [baseUrlName, setBaseUrlName] = useState('baseUrl');
  const [names, setNames] = useState<Record<number, string>>({});
  const [useAsCurrentValues, setUseAsCurrentValues] = useState(false);
  const [onCollision, setOnCollision] = useState<'keep-both' | 'replace'>('keep-both');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    let current = true;
    void runImportPreview(files, importContext(project.session.getWorkingModel())).then(
      (result) => {
        if (!current) return;
        setItems(result);
        setNames(
          Object.fromEntries(
            result.flatMap((item, index) =>
              item.kind === 'collection'
                ? [[index, item.collection.name]]
                : item.kind === 'request'
                  ? [[index, item.name]]
                  : [],
            ),
          ),
        );
      },
    );
    return () => {
      current = false;
    };
  }, [files, project]);

  const hasBaseUrls =
    previewed?.some((item) => item.kind === 'environment' && (item.baseUrls?.length ?? 0) > 0) ??
    false;
  const baseUrlValid = !hasBaseUrls || isValidVariableName(baseUrlName.trim());
  const items = useMemo(
    () =>
      previewed && hasBaseUrls && baseUrlValid
        ? withBaseUrlVariable(previewed, baseUrlName.trim())
        : previewed,
    [previewed, hasBaseUrls, baseUrlValid, baseUrlName],
  );
  const importable = items?.filter((item) => item.kind !== 'rejected') ?? [];
  const hasVariables = importable.some(
    (item) => item.kind === 'environment' || item.kind === 'globals',
  );
  const collisions = importable.filter((item) => item.kind === 'environment' && item.collidesWith);
  const namesValid = Object.values(names).every((name) => name.trim() !== '') && baseUrlValid;

  const apply = async (write: boolean) => {
    if (!items) return;
    const { session, store } = project;
    setWorking(true);
    setError(null);
    try {
      // Requests from cURL go into the selected collection or folder (PIGN-050).
      const targetId = targetContainerId(session, store.getState().selectedId) ?? undefined;
      const ids = applyImport(session, items, {
        names,
        useAsCurrentValues,
        onCollision,
        ...(targetId ? { targetId } : {}),
      });
      const summary = summarize(importable);
      if (write) {
        const { result } = await session.saveForCommit(ids);
        const count = result.written.length;
        notify(`Imported ${summary}; wrote ${count} file${count === 1 ? '' : 's'}.`);
      } else {
        await session.save(ids);
        notify(`Imported ${summary} as local drafts.`);
      }
      for (const item of importable) {
        if (item.kind === 'collection') store.getState().setExpanded(item.collection.id, true);
      }
      const requests = importable.filter((item) => item.kind === 'request');
      for (const item of requests) {
        const parent = placementOf(session.getWorkingModel(), item.id)?.parentId;
        if (parent) store.getState().setExpanded(parent, true);
      }
      if (requests.length === 1) store.getState().openTab(requests[0]!.id, { pin: true });
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
        <span className="min-w-0 truncate">
          Import {files.length === 1 ? files[0]!.name : `${files.length} files`}
        </span>
      </Dialog.Title>
      {items === null ? (
        <p
          role="status"
          data-testid="import-progress"
          className="mt-4 flex items-center gap-2 text-fg-muted"
        >
          <LoaderCircle size={14} className="animate-spin" aria-hidden />
          Reading {files.length === 1 ? 'the file' : 'the files'}…
        </p>
      ) : (
        <form
          className="mt-3 flex min-h-0 flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (importable.length > 0) void apply(true);
          }}
        >
          <div className="flex min-h-0 flex-col gap-3 overflow-auto">
            {items.map((item, index) => (
              <ItemPreview
                key={index}
                item={item}
                name={names[index]}
                onName={(name) => setNames({ ...names, [index]: name })}
              />
            ))}
          </div>
          {hasBaseUrls && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-fg-muted">
                Base URL variable{' '}
                <span className="font-mono">{`{{${baseUrlName.trim() || '…'}}}`}</span> (other
                services get a suffix)
              </span>
              <input
                data-testid="import-base-url-name"
                value={baseUrlName}
                spellCheck={false}
                aria-invalid={!baseUrlValid}
                onChange={(event) => setBaseUrlName(event.target.value)}
                className="h-8 rounded border border-border bg-bg px-2 font-mono text-fg aria-invalid:border-fail"
              />
              {!baseUrlValid && (
                <span role="alert" className="text-xs text-fail">
                  Use a name without spaces or braces.
                </span>
              )}
            </label>
          )}
          {collisions.length > 0 && (
            <fieldset data-testid="import-collision" className="flex flex-col gap-1">
              <legend className="text-xs text-fg-muted">
                An environment with the same name exists already:
              </legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-collision`}
                  data-testid="import-keep-both"
                  checked={onCollision === 'keep-both'}
                  onChange={() => setOnCollision('keep-both')}
                />
                Keep both (the imported one becomes “Name (2)”)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-collision`}
                  data-testid="import-replace"
                  checked={onCollision === 'replace'}
                  onChange={() => setOnCollision('replace')}
                />
                Replace the existing variables
              </label>
            </fieldset>
          )}
          {hasVariables && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                data-testid="import-use-current"
                checked={useAsCurrentValues}
                onChange={(event) => setUseAsCurrentValues(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                Also use imported values as my current values
                <span className="block text-xs text-fg-muted">
                  Kept on this machine only; secret values go to secure storage, never to files.
                </span>
              </span>
            </label>
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
                {importable.length === 0 ? 'Close' : 'Cancel'}
              </button>
            </Dialog.Close>
            {importable.length > 0 && (
              <>
                <button
                  type="button"
                  data-testid="import-as-drafts"
                  disabled={working || !namesValid || project.session.readOnly}
                  onClick={() => void apply(false)}
                  className="h-8 rounded border border-border px-3 hover:bg-hover disabled:opacity-50"
                >
                  Import as local drafts
                </button>
                <button
                  type="submit"
                  data-testid="import-write"
                  disabled={working || !namesValid || project.session.readOnly}
                  className="h-8 rounded bg-accent px-3 font-semibold text-accent-fg disabled:opacity-50"
                >
                  Import &amp; write files
                </button>
              </>
            )}
          </div>
        </form>
      )}
    </>
  );
}

/** "1 request", "2 environments", … for the toast. */
function summarize(items: readonly ImportItem[]): string {
  const requests = items.reduce(
    (total, item) =>
      total +
      (item.kind === 'collection' ? item.report.counts.requests : item.kind === 'request' ? 1 : 0),
    0,
  );
  const environments = items.filter((item) => item.kind === 'environment').length;
  const globals = items.some((item) => item.kind === 'globals');
  const parts = [
    ...(items.some((item) => item.kind === 'collection' || item.kind === 'request')
      ? [`${requests} request${requests === 1 ? '' : 's'}`]
      : []),
    ...(environments > 0 ? [`${environments} environment${environments === 1 ? '' : 's'}`] : []),
    ...(globals ? ['globals'] : []),
  ];
  return parts.join(', ');
}

function ItemPreview({
  item,
  name,
  onName,
}: {
  item: ImportItem;
  name: string | undefined;
  onName: (name: string) => void;
}) {
  const warnings =
    item.kind === 'environment' || item.kind === 'globals'
      ? [...(item.fileWarnings ?? []), ...item.report.warnings]
      : item.kind === 'collection'
        ? item.report.warnings
        : item.kind === 'request'
          ? item.warnings
          : [];
  return (
    <section
      data-testid="import-item"
      data-kind={item.kind}
      className="flex flex-col gap-2 rounded border border-border p-2"
    >
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs">{item.fileName}</span>
        {item.kind !== 'rejected' || item.format ? (
          <span data-testid="import-format" className="text-fg-muted">
            Detected: {item.format}
          </span>
        ) : null}
      </p>
      {item.kind === 'rejected' && (
        <p role="alert" data-testid="import-rejected" className="text-fail">
          {item.message}
        </p>
      )}
      {item.kind === 'collection' && (
        <>
          <dl data-testid="import-counts" className="grid grid-cols-3 gap-2 text-center">
            {(['folders', 'requests', 'examples'] as const).map((key) => (
              <Count key={key} label={key} testId={`import-count-${key}`}>
                {item.report.counts[key]}
              </Count>
            ))}
          </dl>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">New collection</span>
            <input
              data-testid="import-name"
              value={name ?? ''}
              onChange={(event) => onName(event.target.value)}
              className="h-8 rounded border border-border bg-bg px-2 text-fg"
            />
          </label>
        </>
      )}
      {item.kind === 'request' && (
        <>
          <p data-testid="import-request" className="flex min-w-0 gap-2 font-mono text-xs">
            <span className="font-semibold">{item.request.method}</span>
            <span className="min-w-0 truncate">{item.request.url.raw}</span>
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">
              New request (in the selected collection or folder)
            </span>
            <input
              data-testid="import-name"
              value={name ?? ''}
              onChange={(event) => onName(event.target.value)}
              className="h-8 rounded border border-border bg-bg px-2 text-fg"
            />
          </label>
        </>
      )}
      {(item.kind === 'environment' || item.kind === 'globals') && (
        <dl data-testid="import-variable-counts" className="grid grid-cols-3 gap-2 text-center">
          <Count
            label={item.kind === 'environment' ? 'environment' : 'scope'}
            testId="import-env-name"
          >
            {item.kind === 'environment' ? item.environment.name : 'Globals'}
          </Count>
          <Count label="variables" testId="import-count-variables">
            {item.report.variables}
          </Count>
          <Count label="secrets" testId="import-count-secrets">
            {item.report.secrets}
          </Count>
        </dl>
      )}
      {item.kind === 'environment' && item.baseUrls && item.baseUrls.length > 0 && (
        <ul data-testid="import-base-urls" className="flex flex-col gap-0.5 text-xs">
          {item.baseUrls.map((baseUrl) => (
            <li
              key={baseUrl.suffix}
              data-testid="import-base-url"
              className={`flex min-w-0 gap-2 font-mono ${baseUrl.skipped ? 'text-fg-muted line-through' : ''}`}
            >
              <span className="shrink-0">{`{{${baseUrl.key}}}`}</span>
              <span className="min-w-0 truncate">{baseUrl.url}</span>
              {baseUrl.suffix !== '' && (
                <span className="shrink-0 font-sans text-fg-muted">service {baseUrl.service}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {(warnings.length > 0 ||
        (item.kind === 'collection' && item.report.regeneratedIds.length > 0) ||
        (item.kind === 'environment' && item.regeneratedId)) && (
        <ul
          data-testid="import-warnings"
          className="flex max-h-40 min-h-0 flex-col gap-1 overflow-auto rounded border border-warn/40 bg-warn/10 p-2 text-xs"
        >
          {warnings.map((warning) => (
            <li key={warning} data-testid="import-warning" className="flex gap-1.5">
              <TriangleAlert size={12} className="mt-px shrink-0 text-warn" aria-hidden />
              <span>{warning}</span>
            </li>
          ))}
          {item.kind === 'collection' &&
            item.report.regeneratedIds.map((regenerated) => (
              <li
                key={`${regenerated.kind}:${regenerated.from}:${regenerated.to}`}
                data-testid="import-regenerated-id"
              >
                New id for {regenerated.kind} “{regenerated.name}” ({regenerated.from} is already
                used).
              </li>
            ))}
          {item.kind === 'environment' && item.regeneratedId && (
            <li data-testid="import-regenerated-id">
              New id for this environment ({item.regeneratedId} is already used).
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function Count({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded border border-border px-2 py-1">
      <dt className="text-xs text-fg-muted capitalize">{label}</dt>
      <dd data-testid={testId} className="truncate font-mono text-base">
        {children}
      </dd>
    </div>
  );
}
