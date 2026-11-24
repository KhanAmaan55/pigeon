import type { ExecutionResult, NormalizedResponse } from '@pigeon/core';
import { interpretGraphql } from '@pigeon/core';
import {
  BookmarkPlus,
  CircleSlash,
  Copy,
  FileDown,
  LoaderCircle,
  PanelBottom,
  PanelRight,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { lazy, Suspense, useMemo, useState } from 'react';

import { usePlatform } from '../../app/PlatformProvider';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../components/ui';
import { useVolatileHeaders } from '../../app/preferences';
import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';
import { CompareTab } from '../compare/CompareTab';
import { JsonSchemaActions } from '../compare/JsonSchemaActions';
import { ComparisonBadge } from '../compare/outcome';
import { ExamplesTab, useRequestExamples } from '../examples/ExamplesTab';
import { useScratchRequest } from '../request-editor/ScratchRequestProvider';
import { suggestFileName } from './body-view';
import { CopyButton } from './CopyButton';
import { GraphqlErrorList, GraphqlErrorsChip } from './GraphqlSummary';
import { ErrorCard } from './ErrorCard';
import { HeadersTable } from './HeadersTable';
import { StatusLine } from './StatusLine';
import { TimelineTab } from './TimelineTab';
import { ConsolePanel, useConsoleEntries } from '../console/ConsolePanel';
import { TestsBadge, TestsTab } from './TestsTab';
import { CookiesTab, setCookieHeaders } from '../cookies/CookiesTab';

export type ResponseDock = 'bottom' | 'right';

/** Loaded with the first response, keeping the formatters out of the initial bundle. */
const BodyView = lazy(async () => ({ default: (await import('./BodyView')).BodyView }));

/**
 * The latest result (docs/ui-ux.md §3.5): status line, warnings, error card (or a quiet
 * "Cancelled"), and Body / Headers / Timeline tabs with copy, save and the dock toggle.
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
  const comparison = useScratchRequest((s) => s.comparison);
  const canCompare = useScratchRequest((s) => s.compare !== null);
  // The active response tab, per result (a new response starts on Body).
  const [tab, setTab] = useState<{ resultId: string | undefined; value: string }>({
    resultId: undefined,
    value: 'body',
  });
  const activeTab = tab.resultId === result?.id ? tab.value : 'body';
  const selectTab = (value: string) => setTab({ resultId: result?.id, value });

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
          className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-sm text-fg-muted"
        >
          <LoaderCircle size={14} className="animate-spin" aria-hidden />
          Sending request…
        </div>
      )}
      {result === null ? (
        !sending && <EmptyState title="Send a request to see the response" />
      ) : (
        <>
          {result.response && (
            <StatusLine
              response={result.response}
              transport={result.transport}
              {...(canCompare || result.tests
                ? {
                    comparison: (
                      <>
                        {canCompare && (
                          <ComparisonBadge
                            comparison={comparison}
                            onOpen={() => selectTab('compare')}
                          />
                        )}
                        {result.tests && (
                          <TestsBadge run={result.tests} onOpen={() => selectTab('tests')} />
                        )}
                      </>
                    ),
                  }
                : {})}
            />
          )}
          {result.error?.kind === 'aborted' ? (
            <Cancelled />
          ) : (
            <>
              {result.warnings.length > 0 && <Warnings warnings={result.warnings} />}
              {result.error && <ErrorCard error={result.error} />}
              {/* A failed script: its output explains the error (PIGN-043). */}
              {result.error?.kind === 'script' && (
                <div className="flex max-h-60 min-h-0 flex-col border-t border-border">
                  <ConsolePanel limit={50} />
                </div>
              )}
            </>
          )}
          {result.response && (
            <ResponseTabs
              key={result.id}
              result={result}
              response={result.response}
              tab={activeTab}
              onTab={selectTab}
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
    <Callout tone="warn" icon={null} className="mx-4 mt-3 shrink-0">
      <ul data-testid="response-warnings" aria-label="Warnings" className="flex flex-col gap-1">
        {warnings.map((warning) => (
          <li key={warning} className="flex items-start gap-2">
            <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            {warning}
          </li>
        ))}
      </ul>
    </Callout>
  );
}

/** A cancel is the user's own doing: a muted note, not an error card. */
function Cancelled() {
  return (
    <div
      role="status"
      data-testid="response-cancelled"
      className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-sm text-fg-muted"
    >
      <CircleSlash size={14} aria-hidden />
      Cancelled
    </div>
  );
}

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
  tab,
  onTab,
  dock,
  onToggleDock,
}: {
  result: ExecutionResult;
  response: NormalizedResponse;
  tab: string;
  onTab: (tab: string) => void;
  dock: ResponseDock;
  onToggleDock?: () => void;
}) {
  const comparison = useScratchRequest((s) => s.comparison);
  const canCompare = useScratchRequest((s) => s.compare !== null);
  const addRule = useScratchRequest((s) => s.addRule);
  const rulesApi = useScratchRequest((s) => s.rules);
  const baselineApi = useScratchRequest((s) => s.baselineMode);
  const acceptBaseline = useScratchRequest((s) => s.acceptBaseline);
  // The rules panel follows edits of compare.json / pigeon.json.
  useProjectState((s) => s.model, null);
  const [reveal, setReveal] = useState<{ line: number; nonce: number } | undefined>(undefined);
  const hasProject = useAppStore((s) => s.project !== null);
  // Desktop only: browsers hide Set-Cookie (PIGN-045).
  const showCookies = hasProject && !response.headersRestricted;
  const setCookieCount = setCookieHeaders(response).length;
  const consoleCount = useConsoleEntries().length;
  const { files } = usePlatform();
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const saveAsExample = useScratchRequest((s) => s.saveAsExample);
  const requestId = useScratchRequest((s) => s.request.id);
  const volatileHeaders = useVolatileHeaders();
  const project = useAppStore((s) => s.project);
  const baselineExample = useProjectState(() => {
    const id =
      comparison?.status === 'done' && comparison.outcome.kind === 'compared'
        ? comparison.outcome.result.exampleId
        : undefined;
    return id ? project?.session.findExample(id)?.example : undefined;
  }, undefined);
  const readOnly = useProjectState((s) => s.readOnly, false);
  const examples = useRequestExamples(requestId);
  const [savedExample, setSavedExample] = useState<string | null>(null);
  const isGraphql = useScratchRequest((s) => s.request.body.mode === 'graphql');
  const graphql = useMemo(
    () => (isGraphql ? interpretGraphql(response) : undefined),
    [isGraphql, response],
  );

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
    <Tabs
      value={tab}
      onValueChange={onTab}
      data-transport={result.transport}
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* A container: the action labels hide (screen readers keep them) when the panel is narrow. */}
      <div className="@container flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <TabsList aria-label="Response sections" className="min-w-0 overflow-x-auto">
          <ResponseTab value="body" testId="response-body-tab">
            Body
          </ResponseTab>
          <ResponseTab value="headers" testId="response-headers-tab">
            Headers
            <Badge data-testid="response-headers-count">{response.headers.length}</Badge>
          </ResponseTab>
          <ResponseTab value="timeline" testId="response-timeline-tab">
            Timeline
          </ResponseTab>
          {canCompare && (
            <ResponseTab value="compare" testId="response-compare-tab">
              Compare
            </ResponseTab>
          )}
          {showCookies && (
            <ResponseTab value="cookies" testId="response-cookies-tab">
              Cookies
              {setCookieCount > 0 && <Badge>{setCookieCount}</Badge>}
            </ResponseTab>
          )}
          {result.tests && (
            <ResponseTab value="tests" testId="response-tests-tab">
              Tests
              <Badge
                data-testid="response-tests-count"
                tone={result.tests.counts.fail + result.tests.counts.error > 0 ? 'fail' : 'pass'}
              >
                {result.tests.counts.pass}/
                {result.tests.counts.pass + result.tests.counts.fail + result.tests.counts.error}
              </Badge>
            </ResponseTab>
          )}
          {hasProject && (
            <ResponseTab value="console" testId="response-console-tab">
              Console
              {consoleCount > 0 && (
                <Badge data-testid="response-console-count">{consoleCount}</Badge>
              )}
            </ResponseTab>
          )}
          {saveAsExample && (
            <ResponseTab value="examples" testId="response-examples-tab">
              Examples
              {examples.length > 0 && (
                <Badge data-testid="response-examples-count">{examples.length}</Badge>
              )}
            </ResponseTab>
          )}
        </TabsList>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {graphql && <GraphqlErrorsChip view={graphql} />}
          {savedExample !== null && saveState.kind === 'idle' && (
            <span role="status" data-testid="example-saved" className="text-xs text-fg-muted">
              Saved example “{savedExample}”
            </span>
          )}
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
            <span className="sr-only @3xl:not-sr-only">Copy</span>
          </CopyButton>
          {saveAsExample && (
            <Button
              variant="ghost"
              size="xs"
              data-testid="save-as-example"
              title="Save this response as an example of the request (written on Save for Commit)"
              disabled={readOnly}
              onClick={() => {
                const id = saveAsExample({ volatileHeaders });
                const example = id ? project?.session.findExample(id)?.example : undefined;
                if (example) {
                  setSaveState({ kind: 'idle' });
                  setSavedExample(example.name);
                }
              }}
              icon={<BookmarkPlus aria-hidden />}
            >
              <span className="sr-only @3xl:not-sr-only">Save as example</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            data-testid="response-save"
            title={`Save body as ${suggestFileName(response)}`}
            onClick={save}
            icon={<FileDown aria-hidden />}
          >
            <span className="sr-only @3xl:not-sr-only">Save</span>
          </Button>
          {onToggleDock && <DockToggle dock={dock} onToggle={onToggleDock} />}
        </div>
      </div>
      <TabsContent
        value="body"
        className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        {graphql && <GraphqlErrorList view={graphql} />}
        <Suspense
          fallback={<div aria-busy data-testid="response-body-loading" className="flex-1" />}
        >
          <BodyView response={response} onSave={save} {...(reveal ? { reveal } : {})} />
        </Suspense>
      </TabsContent>
      <TabsContent
        value="headers"
        className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <HeadersTable headers={response.headers} restricted={response.headersRestricted} />
      </TabsContent>
      <TabsContent
        value="timeline"
        className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <TimelineTab result={result} response={response} />
      </TabsContent>
      {canCompare && (
        <TabsContent
          value="compare"
          className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <CompareTab
            comparison={comparison}
            baseline={baselineExample}
            response={response}
            {...(addRule ? { onAddRule: addRule } : {})}
            {...(rulesApi
              ? {
                  rules: {
                    ...rulesApi.read(),
                    onChange: rulesApi.write,
                    overrides: rulesApi.overrides(),
                    onOverrides: rulesApi.setOverrides,
                  },
                }
              : {})}
            {...(baselineApi
              ? {
                  baselineMode: {
                    value: baselineApi.read(),
                    examples,
                    onChange: baselineApi.write,
                  },
                }
              : {})}
            {...(acceptBaseline
              ? { onAccept: () => void acceptBaseline({ volatileHeaders }) }
              : {})}
            {...(saveAsExample
              ? { onSaveExample: () => void saveAsExample({ volatileHeaders }) }
              : {})}
            {...(project && baselineExample && project.session.findExample(baselineExample.id)
              ? {
                  schemaActions: (
                    <JsonSchemaActions
                      session={project.session}
                      exampleId={baselineExample.id}
                      testIdPrefix="compare"
                    />
                  ),
                }
              : {})}
            onEditProjectRules={() =>
              window.dispatchEvent(new CustomEvent('pigeon:open-view', { detail: 'settings' }))
            }
            onShowInBody={(line) => {
              setReveal({ line, nonce: Date.now() });
              onTab('body');
            }}
          />
        </TabsContent>
      )}
      {showCookies && (
        <TabsContent
          value="cookies"
          className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <CookiesTab response={response} url={result.request.url} />
        </TabsContent>
      )}
      {result.tests && (
        <TabsContent
          value="tests"
          className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <TestsTab run={result.tests} />
        </TabsContent>
      )}
      {hasProject && (
        <TabsContent
          value="console"
          className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <ConsolePanel />
        </TabsContent>
      )}
      {saveAsExample && (
        <TabsContent
          value="examples"
          className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <ExamplesTab requestId={requestId} />
        </TabsContent>
      )}
    </Tabs>
  );
}

function DockToggle({ dock, onToggle }: { dock: ResponseDock; onToggle: () => void }) {
  const { os } = usePlatform();
  const shortcut = os === 'macos' ? '⌘⌥L' : 'Ctrl+Alt+L';
  const label = `Move response to the ${dock === 'bottom' ? 'right' : 'bottom'} (${shortcut})`;
  return (
    <Button
      variant="ghost"
      size="xs"
      data-testid="response-dock-toggle"
      data-dock={dock}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      {dock === 'bottom' ? <PanelRight aria-hidden /> : <PanelBottom aria-hidden />}
    </Button>
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
    <TabsTrigger value={value} data-testid={testId}>
      {children}
    </TabsTrigger>
  );
}
