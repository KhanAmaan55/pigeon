import type { NormalizedResponse } from '@pigeon/core';
import { FileDown, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useCapabilities } from '../../app/PlatformProvider';
import { CodeEditor } from '../../components/CodeEditor';
import { Button, Callout, EmptyState } from '../../components/ui';
import { formatBytes } from '../../lib/format';
import type { BodyMode } from './body-view';
import { describeBody, hexDump, PRETTY_LIMIT, TRUNCATED_BYTES, truncateText } from './body-view';
import type { FormatRequest } from './formatting';
import { formatBody } from './formatting';

const MODE_LABELS: Record<BodyMode, string> = { pretty: 'Pretty', raw: 'Raw', preview: 'Preview' };

/** One option of a small segmented pill toggle (Pretty / Raw / Preview). */
const pillToggle =
  'h-6 cursor-default rounded-full px-2.5 text-xs text-fg-muted transition-colors hover:text-fg disabled:pointer-events-none disabled:opacity-50 aria-checked:bg-surface-raised aria-checked:font-medium aria-checked:text-fg aria-checked:shadow-sm';
const noticeClass = 'mx-2 mt-2 shrink-0';
const noticeBody = 'flex flex-wrap items-center gap-2 text-xs text-fg-muted';

/**
 * Pretty / Raw / Preview of a response body (docs/ui-ux.md §3.5). The first view comes from the
 * content type (`describeBody`); bodies over 2 MB open in Raw ("Format anyway"), bodies over
 * 20 MB show their first 2 MB ("Show all" where the app can hold them, or Save).
 * Mount it with `key={result.id}` so each response starts from its own defaults.
 */
export function BodyView({
  response,
  onSave,
  reveal,
}: {
  response: NormalizedResponse;
  onSave: () => void;
  /** "Show in body" (PIGN-034): a line of the Pretty view to scroll to. */
  reveal?: { line: number; nonce: number };
}) {
  const info = useMemo(() => describeBody(response), [response]);
  const [mode, setMode] = useState(info.defaultMode);
  const [formatAnyway, setFormatAnyway] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [revealed, setRevealed] = useState<number | null>(null);
  const capabilities = useCapabilities();
  // Holding 20 MB+ of text in the editor is fine natively; in a browser tab it may not be.
  const canShowAll = capabilities.transport !== 'fetch';

  const truncated = info.huge && !showAll;
  const shown = useMemo(
    () =>
      response.bodyText === undefined
        ? ''
        : truncateText(response.bodyText, truncated ? TRUNCATED_BYTES : Infinity).text,
    [response.bodyText, truncated],
  );

  if (info.kind === 'empty') {
    return <EmptyState data-testid="response-body-empty" title="Empty response body" />;
  }
  if (info.kind === 'binary' && info.modes.length === 0) {
    return <BinarySummary response={response} onSave={onSave} />;
  }

  const prettyBlocked = truncated;
  const choose = (next: BodyMode) => {
    if (next === 'pretty') setFormatAnyway(info.large);
    setMode(next);
  };
  // Showing a path needs the Pretty view (its lines are the ones findings point at).
  if (reveal && revealed !== reveal.nonce && info.modes.includes('pretty') && !prettyBlocked) {
    setRevealed(reveal.nonce);
    if (mode !== 'pretty' || (info.large && !formatAnyway)) choose('pretty');
  }
  const pretty = mode === 'pretty' && (!info.large || formatAnyway) && !prettyBlocked;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {info.modes.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Body view"
          className="mx-2 mt-2 flex w-fit shrink-0 items-center gap-0.5 rounded-full bg-sunken p-0.5"
        >
          {info.modes.map((candidate) => {
            const disabled = candidate === 'pretty' && prettyBlocked;
            return (
              <button
                key={candidate}
                type="button"
                role="radio"
                aria-checked={mode === candidate}
                data-testid={`response-view-${candidate}`}
                disabled={disabled}
                title={disabled ? 'Show the whole body to format it' : undefined}
                onClick={() => choose(candidate)}
                className={pillToggle}
              >
                {MODE_LABELS[candidate]}
              </button>
            );
          })}
        </div>
      )}
      {truncated && (
        <Callout tone="info" data-testid="response-body-truncated" className={noticeClass}>
          <div className={noticeBody}>
            <span>
              Showing the first {formatBytes(TRUNCATED_BYTES)} of {formatBytes(response.sizeBytes)}.
            </span>
            {canShowAll && (
              <Button size="xs" data-testid="response-show-all" onClick={() => setShowAll(true)}>
                Show all
              </Button>
            )}
            <Button size="xs" onClick={onSave} icon={<FileDown aria-hidden />}>
              Save to file
            </Button>
          </div>
        </Callout>
      )}
      {info.large && !truncated && mode === 'raw' && info.modes.includes('pretty') && (
        <Callout tone="info" data-testid="response-body-large" className={noticeClass}>
          <div className={noticeBody}>
            <span>
              Large body ({formatBytes(response.sizeBytes)}, over {formatBytes(PRETTY_LIMIT)}):
              shown raw.
            </span>
            <Button size="xs" data-testid="response-format-anyway" onClick={() => choose('pretty')}>
              Format anyway
            </Button>
          </div>
        </Callout>
      )}
      {mode === 'preview' ? (
        <Preview response={response} kind={info.preview} />
      ) : pretty ? (
        <PrettyBody
          text={shown}
          language={info.language}
          knownValidJson={response.json !== undefined && !truncated}
          {...(reveal ? { reveal } : {})}
        />
      ) : (
        <CodeEditor
          key="raw"
          value={shown}
          readOnly
          search
          ariaLabel="Response body"
          testId="response-body"
          className="m-2 flex-1 rounded"
        />
      )}
      <span hidden data-testid="response-body-mode" data-mode={pretty ? 'pretty' : mode} />
    </div>
  );
}

function PrettyBody({
  text,
  language,
  knownValidJson,
  reveal,
}: FormatRequest & { reveal?: { line: number; nonce: number } }) {
  const request = useMemo<FormatRequest>(
    () => ({ text, language, knownValidJson }),
    [text, language, knownValidJson],
  );
  const [formatted, setFormatted] = useState<{ request: FormatRequest; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    void formatBody(request).then((result) => {
      if (live) setFormatted({ request, text: result });
    });
    return () => {
      live = false;
    };
  }, [request]);

  if (formatted?.request !== request) {
    return (
      <div
        role="status"
        data-testid="response-body-formatting"
        className="flex items-center gap-2 p-4 text-sm text-fg-muted"
      >
        <LoaderCircle size={14} className="animate-spin" aria-hidden />
        Formatting…
      </div>
    );
  }
  return (
    <CodeEditor
      key="pretty"
      value={formatted.text}
      language={language}
      readOnly
      folding
      search
      ariaLabel="Response body"
      testId="response-body"
      className="m-2 flex-1 rounded"
      {...(reveal ? { revealLine: reveal } : {})}
    />
  );
}

/**
 * HTML in an iframe with `sandbox=""`: no scripts, forms, popups or same-origin access; it also
 * inherits the app's CSP. Images from a blob URL of the exact bytes.
 */
function Preview({
  response,
  kind,
}: {
  response: NormalizedResponse;
  kind: 'html' | 'image' | undefined;
}) {
  const url = useMemo(
    () =>
      kind === 'image'
        ? URL.createObjectURL(
            new Blob([response.body as Uint8Array<ArrayBuffer>], {
              type: response.contentType ?? '',
            }),
          )
        : null,
    [kind, response],
  );
  useEffect(
    () => () => {
      if (url !== null) URL.revokeObjectURL(url);
    },
    [url],
  );

  if (kind === 'html') {
    return (
      <iframe
        title="HTML preview"
        data-testid="response-preview"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={response.bodyText ?? ''}
        // HTML pages assume a white canvas whatever the app's theme.
        className="m-2 min-h-0 flex-1 rounded-lg border border-border bg-white"
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      {url && (
        <img
          data-testid="response-preview-image"
          src={url}
          alt={`Response image (${response.contentType ?? 'image'}, ${formatBytes(response.sizeBytes)})`}
          className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
        />
      )}
    </div>
  );
}

function BinarySummary({ response, onSave }: { response: NormalizedResponse; onSave: () => void }) {
  const lines = useMemo(() => hexDump(response.body), [response.body]);
  return (
    <div
      data-testid="response-binary"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 text-sm"
    >
      <div className="flex items-center gap-3">
        <span className="text-fg">
          Binary body: {formatBytes(response.sizeBytes)}
          {response.contentType ? `, ${response.contentType}` : ''}
        </span>
        <Button size="xs" onClick={onSave} icon={<FileDown aria-hidden />}>
          Save to file
        </Button>
      </div>
      <pre
        data-testid="response-hex"
        aria-label={`First ${Math.min(response.sizeBytes, 256)} bytes in hexadecimal`}
        className="rounded-lg bg-sunken p-3 font-mono text-xs text-fg-muted"
      >
        {lines.join('\n')}
        {response.sizeBytes > 256 ? '\n…' : ''}
      </pre>
    </div>
  );
}
