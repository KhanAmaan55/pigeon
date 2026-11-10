import type { ExecutionError, ExecutionResult, NormalizedResponse } from '@pigeon/core';
import {
  CircleAlert,
  Copy,
  FileDown,
  LoaderCircle,
  PanelBottom,
  PanelRight,
  TriangleAlert,
} from 'lucide-react';
import { Tabs } from 'radix-ui';
import type { ReactNode } from 'react';
import { lazy, Suspense, useState } from 'react';

import { usePlatform } from '../../app/PlatformProvider';
import { useScratchRequest } from '../request-editor/ScratchRequestProvider';
import { suggestFileName } from './body-view';
import { CopyButton } from './CopyButton';
import { HeadersTable } from './HeadersTable';
import { StatusLine } from './StatusLine';

export type ResponseDock = 'bottom' | 'right';

/** Loaded with the first response, keeping the formatters out of the initial bundle. */
const BodyView = lazy(async () => ({ default: (await import('./BodyView')).BodyView }));

/**
 * The latest result (docs/ui-ux.md §3.5): status line, warnings, error card, and Body / Headers
 * tabs with copy, save and the dock toggle.
 */
export function ResponseViewer({
  dock = 'bottom',
  onToggleDock,
}: {
  dock?: ResponseDock;
  onToggleDock?: () => void;
} = {}) {
  const sending = useScratchRequest((s) => s.status === 'sending');
  const result = useScratchRequest((s) => s.result);

  return (
    <div
      data-testid="response-panel"
      aria-busy={sending}
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      {sending && (
        <div
          role="status"
          data-testid="response-loading"
          className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-sm text-fg-muted"
        >
          <LoaderCircle size={14} className="animate-spin" aria-hidden />
          Sending request…
        </div>
      )}
      {result === null ? (
        !sending && (
          <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
            Send a request to see the response
          </div>
        )
      ) : (
        <>
          {result.response && (
            <StatusLine response={result.response} transport={result.transport} />
          )}
          {result.warnings.length > 0 && <Warnings warnings={result.warnings} />}
          {result.error && <ErrorCard error={result.error} />}
          {result.response && (
            <ResponseTabs
              key={result.id}
              result={result}
              response={result.response}
              dock={dock}
              {...(onToggleDock ? { onToggleDock } : {})}
            />
          )}
        </>
      )}
    </div>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  return (
    <ul
      data-testid="response-warnings"
      aria-label="Warnings"
      className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-fg-muted"
    >
      {warnings.map((warning) => (
        <li key={warning} className="flex items-start gap-1.5">
          <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          {warning}
        </li>
      ))}
    </ul>
  );
}

function ErrorCard({ error }: { error: ExecutionError }) {
  return (
    <div className="p-3">
      <div
        role="alert"
        data-testid="response-error"
        data-kind={error.kind}
        className="flex flex-col gap-1.5 rounded border border-fail/40 bg-bg p-3 text-sm"
      >
        <div className="flex items-center gap-2 font-semibold text-fail">
          <CircleAlert size={16} aria-hidden />
          <span>{error.message}</span>
        </div>
        <code data-testid="response-error-kind" className="font-mono text-xs text-fg-muted">
          {error.kind}
        </code>
        {error.hint && <p className="text-fg-muted">{error.hint}</p>}
        {error.detail && (
          <pre className="font-mono text-xs break-all whitespace-pre-wrap text-fg-muted">
            {error.detail}
          </pre>
        )}
      </div>
    </div>
  );
}

const actionButton =
  'inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saved' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

function saveMessage(state: SaveState): string {
  switch (state.kind) {
    case 'idle':
      return '';
    case 'saved':
      return 'Saved';
    case 'cancelled':
      return 'Not saved';
    case 'failed':
      return state.message;
  }
}

function ResponseTabs({
  result,
  response,
  dock,
  onToggleDock,
}: {
  result: ExecutionResult;
  response: NormalizedResponse;
  dock: ResponseDock;
  onToggleDock?: () => void;
}) {
  const { files } = usePlatform();
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });

  const save = () => {
    setSaveState({ kind: 'idle' });
    files
      .saveFile(
        suggestFileName(response),
        response.body,
        response.contentType ?? 'application/octet-stream',
      )
      .then(
        (outcome) => setSaveState({ kind: outcome }),
        (error: unknown) =>
          setSaveState({
            kind: 'failed',
            message: error instanceof Error ? error.message : String(error),
          }),
      );
  };

  return (
    <Tabs.Root
      defaultValue="body"
      data-transport={result.transport}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2">
        <Tabs.List aria-label="Response sections" className="flex gap-1">
          <ResponseTab value="body" testId="response-body-tab">
            Body
          </ResponseTab>
          <ResponseTab value="headers" testId="response-headers-tab">
            Headers
            <span
              data-testid="response-headers-count"
              className="rounded-full bg-hover px-1.5 text-xs leading-4 text-fg"
            >
              {response.headers.length}
            </span>
          </ResponseTab>
        </Tabs.List>
        <div className="ml-auto flex items-center gap-1">
          {saveState.kind !== 'idle' && (
            <span
              role="status"
              data-testid="response-save-status"
              data-state={saveState.kind}
              className={`text-xs ${saveState.kind === 'failed' ? 'text-fail' : 'text-fg-muted'}`}
            >
              {saveMessage(saveState)}
            </span>
          )}
          <CopyButton
            text={() => response.bodyText ?? ''}
            label="Copy body"
            testId="response-copy"
            icon={<Copy size={12} aria-hidden />}
            className={response.bodyText === undefined ? 'pointer-events-none opacity-50' : ''}
          >
            Copy
          </CopyButton>
          <button
            type="button"
            data-testid="response-save"
            title={`Save body as ${suggestFileName(response)}`}
            onClick={save}
            className={actionButton}
          >
            <FileDown size={12} aria-hidden />
            Save
          </button>
          {onToggleDock && <DockToggle dock={dock} onToggle={onToggleDock} />}
        </div>
      </div>
      <Tabs.Content
        value="body"
        className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <Suspense
          fallback={<div aria-busy data-testid="response-body-loading" className="flex-1" />}
        >
          <BodyView response={response} onSave={save} />
        </Suspense>
      </Tabs.Content>
      <Tabs.Content
        value="headers"
        className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <HeadersTable headers={response.headers} restricted={response.headersRestricted} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

function DockToggle({ dock, onToggle }: { dock: ResponseDock; onToggle: () => void }) {
  const { os } = usePlatform();
  const shortcut = os === 'macos' ? '⌘⌥L' : 'Ctrl+Alt+L';
  const label = `Move response to the ${dock === 'bottom' ? 'right' : 'bottom'} (${shortcut})`;
  return (
    <button
      type="button"
      data-testid="response-dock-toggle"
      data-dock={dock}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={actionButton}
    >
      {dock === 'bottom' ? (
        <PanelRight size={14} aria-hidden />
      ) : (
        <PanelBottom size={14} aria-hidden />
      )}
    </button>
  );
}

function ResponseTab({
  value,
  testId,
  children,
}: {
  value: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Tabs.Trigger
      value={value}
      data-testid={testId}
      className="-mb-px inline-flex h-8 items-center gap-1.5 border-b-2 border-transparent px-2 text-sm text-fg-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg"
    >
      {children}
    </Tabs.Trigger>
  );
}
