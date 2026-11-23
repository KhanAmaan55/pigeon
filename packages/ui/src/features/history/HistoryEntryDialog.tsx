/**
 * One history entry, read-only (PIGN-051): the request as sent and the response as received
 * (bounded, secrets masked), with "Open as new request" and "Restore into request". Both use the
 * request definition saved with the entry (`{{variables}}` kept) when there is one.
 */

import type { Body, HistoryEntry, KeyValue, Request } from '@pigeon/core';
import { createUrl, SECRET_MASK, syncUrlFromRaw } from '@pigeon/core';
import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';

import { useAppStore } from '../../stores/AppStoreProvider';
import type { OpenProject } from '../../stores/app-store';
import { newCollection, targetContainerId } from '../explorer/actions';
import { methodColorClass } from '../request-editor/methods';

type Fields = Pick<Request, 'method' | 'url' | 'headers' | 'body' | 'settings'> & {
  auth?: Request['auth'];
};

/** The request fields to restore: the saved definition, or the request as sent. */
export function fieldsFromEntry(entry: HistoryEntry): Fields {
  if (entry.source) {
    const { method, url, headers, body, settings, auth } = entry.source;
    return { method, url, headers, body, settings, ...(auth ? { auth } : {}) };
  }
  const headers: KeyValue[] = entry.request.headers.map(([key, value]) => ({ key, value }));
  const contentType =
    entry.request.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '';
  const text = entry.request.body;
  const body: Body =
    text === undefined || /multipart\//i.test(contentType)
      ? { mode: 'none' }
      : {
          mode: 'raw',
          raw: text,
          language: /json/i.test(contentType)
            ? 'json'
            : /xml/i.test(contentType)
              ? 'xml'
              : /html/i.test(contentType)
                ? 'html'
                : 'text',
        };
  return {
    method: entry.request.method,
    url: syncUrlFromRaw(createUrl(), entry.request.url),
    headers,
    body,
    settings: {},
  };
}

function hasMask(fields: Fields): boolean {
  return JSON.stringify(fields).includes(SECRET_MASK);
}

export function HistoryEntryDialog({
  project,
  entryId,
  onClose,
}: {
  project: OpenProject;
  entryId: string | null;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<HistoryEntry | null | undefined>(undefined);
  useEffect(() => {
    if (!entryId) return;
    let current = true;
    void project.session.history?.get(entryId).then(
      (found) => current && setEntry(found ?? null),
      () => current && setEntry(null),
    );
    return () => {
      current = false;
      setEntry(undefined);
    };
  }, [entryId, project]);

  return (
    <Dialog.Root open={entryId !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="history-entry"
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 flex max-h-[85vh] w-[min(48rem,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 text-sm text-fg shadow-xl"
        >
          <Dialog.Title className="text-base font-semibold">History entry</Dialog.Title>
          {entry === undefined ? (
            <p className="text-fg-muted">Loading…</p>
          ) : entry === null ? (
            <p role="alert" className="text-fail">
              This entry is no longer in the history.
            </p>
          ) : (
            <EntryDetails entry={entry} project={project} onDone={onClose} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Headers({ headers, testId }: { headers: Array<[string, string]>; testId: string }) {
  if (headers.length === 0) return <p className="text-xs text-fg-muted">No headers.</p>;
  return (
    <dl data-testid={testId} className="grid grid-cols-[max-content_1fr] gap-x-3 font-mono text-xs">
      {headers.map(([name, value], index) => (
        <div key={index} className="contents">
          <dt className="text-fg-muted">{name}</dt>
          <dd className="min-w-0 break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EntryDetails({
  entry,
  project,
  onDone,
}: {
  entry: HistoryEntry;
  project: OpenProject;
  onDone: () => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const { session, store } = project;
  const target = entry.requestId ? session.findRequest(entry.requestId) : undefined;
  const fields = fieldsFromEntry(entry);
  const masked = hasMask(fields);
  const maskedNote = masked
    ? ' Secret values were saved as •••••• — enter them again before sending.'
    : '';

  const openAsNew = () => {
    let parent = targetContainerId(session, store.getState().selectedId);
    if (!parent) parent = newCollection(session, store, 'History');
    const id = crypto.randomUUID();
    const base = entry.requestName || `${entry.method} request`;
    session.apply({
      type: 'createRequest',
      id,
      parentId: parent,
      name: `${base} (from history)`,
      request: fields,
    });
    store.getState().setExpanded(parent, true);
    store.getState().cancelRename();
    store.getState().openTab(id, { pin: true });
    notify(`Opened the history entry as a new request.${maskedNote}`);
    onDone();
  };

  const restore = () => {
    if (!target) return;
    session.apply({
      type: 'updateRequest',
      id: target.id,
      patch: {
        method: fields.method,
        url: fields.url,
        headers: fields.headers,
        body: fields.body,
        settings: fields.settings,
        auth: fields.auth,
      },
    });
    store.getState().openTab(target.id, { pin: true });
    notify(`Restored “${target.name}” from history (unsaved).${maskedNote}`);
    onDone();
  };

  const response = entry.response;
  const section = 'flex min-h-0 flex-col gap-1 rounded border border-border p-2';
  return (
    <>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <p className="flex flex-wrap items-baseline gap-x-3 text-xs text-fg-muted">
          <span>{new Date(entry.at).toLocaleString()}</span>
          {entry.requestName && <span data-testid="history-entry-name">{entry.requestName}</span>}
          {entry.environment && <span>Environment: {entry.environment.name}</span>}
          {entry.comparison && (
            <span data-testid="history-entry-comparison">Comparison: {entry.comparison}</span>
          )}
        </p>
        <section aria-label="Request" className={section}>
          <h3 className="flex min-w-0 gap-2 font-mono text-xs">
            <span className={`font-semibold ${methodColorClass(entry.request.method)}`}>
              {entry.request.method}
            </span>
            <span data-testid="history-entry-url" className="min-w-0 break-all">
              {entry.request.url}
            </span>
          </h3>
          <Headers headers={entry.request.headers} testId="history-entry-request-headers" />
          {entry.request.body !== undefined && (
            <pre
              data-testid="history-entry-request-body"
              className="max-h-40 overflow-auto rounded bg-bg p-2 font-mono text-xs whitespace-pre-wrap"
            >
              {entry.request.body}
            </pre>
          )}
        </section>
        <section aria-label="Response" className={section}>
          {response ? (
            <>
              <h3 data-testid="history-entry-status" className="font-mono text-xs font-semibold">
                {response.status} {response.statusText}
                <span className="ml-2 font-normal text-fg-muted">
                  {Math.round(response.timings.totalMs)} ms · {response.sizeBytes} B
                </span>
              </h3>
              <Headers headers={response.headers} testId="history-entry-response-headers" />
              <pre
                data-testid="history-entry-response-body"
                className="max-h-64 overflow-auto rounded bg-bg p-2 font-mono text-xs whitespace-pre-wrap"
              >
                {response.bodyEncoding === 'text'
                  ? response.body
                  : `Binary body (${response.sizeBytes} bytes) — not shown.`}
              </pre>
              {response.truncated && (
                <p data-testid="history-entry-truncated" className="text-xs text-fg-muted">
                  The body was cut to the first 256 KB in history.
                </p>
              )}
            </>
          ) : (
            <p data-testid="history-entry-error" role="alert" className="text-fail">
              {entry.errorDetail?.message ?? entry.error ?? 'No response.'}
            </p>
          )}
        </section>
        {entry.warnings.length > 0 && (
          <ul className="text-xs text-fg-muted">
            {entry.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Dialog.Close asChild>
          <button type="button" className="h-8 rounded border border-border px-3 hover:bg-hover">
            Close
          </button>
        </Dialog.Close>
        <button
          type="button"
          data-testid="history-restore"
          disabled={!target || session.readOnly}
          title={
            target ? `Replace “${target.name}” with this entry` : 'The request no longer exists'
          }
          onClick={restore}
          className="h-8 rounded border border-border px-3 hover:bg-hover disabled:opacity-50"
        >
          Restore into request
        </button>
        <button
          type="button"
          data-testid="history-open-new"
          disabled={session.readOnly}
          onClick={openAsNew}
          className="h-8 rounded bg-accent px-3 font-semibold text-accent-fg disabled:opacity-50"
        >
          Open as new request
        </button>
      </div>
    </>
  );
}
