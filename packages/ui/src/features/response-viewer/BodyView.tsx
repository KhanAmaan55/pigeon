import type { NormalizedResponse } from '@pigeon/core';
import { FileDown, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useCapabilities } from '../../app/PlatformProvider';
import { CodeEditor } from '../../components/CodeEditor';
import { formatBytes } from '../../lib/format';
import type { BodyMode } from './body-view';
import { describeBody, hexDump, PRETTY_LIMIT, TRUNCATED_BYTES, truncateText } from './body-view';
import type { FormatRequest } from './formatting';
import { formatBody } from './formatting';

const MODE_LABELS: Record<BodyMode, string> = { pretty: 'Pretty', raw: 'Raw', preview: 'Preview' };

const noticeClass =
  'flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-hover/50 px-3 py-1.5 text-xs text-fg-muted';
const linkButton =
  'inline-flex h-6 items-center gap-1 rounded border border-border bg-bg px-2 text-xs text-fg hover:bg-hover';

/**
 * Pretty / Raw / Preview of a response body (docs/ui-ux.md §3.5). The first view comes from the
 * content type (`describeBody`); bodies over 2 MB open in Raw ("Format anyway"), bodies over
 * 20 MB show their first 2 MB ("Show all" where the app can hold them, or Save).
 * Mount it with `key={result.id}` so each response starts from its own defaults.
 */
export function BodyView({
  response,
  onSave,
}: {
  response: NormalizedResponse;
  onSave: () => void;
}) {
  const info = useMemo(() => describeBody(response), [response]);
  const [mode, setMode] = useState(info.defaultMode);
  const [formatAnyway, setFormatAnyway] = useState(false);
  const [showAll, setShowAll] = useState(false);
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
    return (
      <p data-testid="response-body-empty" className="p-3 text-sm text-fg-muted">
        Empty response body
      </p>
    );
  }
  if (info.kind === 'binary' && info.modes.length === 0) {
    return <BinarySummary response={response} onSave={onSave} />;
  }

  const prettyBlocked = truncated;
  const choose = (next: BodyMode) => {
    if (next === 'pretty') setFormatAnyway(info.large);
    setMode(next);
  };
  const pretty = mode === 'pretty' && (!info.large || formatAnyway) && !prettyBlocked;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {info.modes.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Body view"
          className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1"
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
                className="h-6 rounded px-2 text-xs text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50 aria-checked:bg-hover aria-checked:text-fg"
              >
                {MODE_LABELS[candidate]}
              </button>
            );
          })}
        </div>
      )}
      {truncated && (
        <div data-testid="response-body-truncated" className={noticeClass}>
          <span>
            Showing the first {formatBytes(TRUNCATED_BYTES)} of {formatBytes(response.sizeBytes)}.
          </span>
          {canShowAll && (
            <button
              type="button"
              data-testid="response-show-all"
              onClick={() => setShowAll(true)}
              className={linkButton}
            >
              Show all
            </button>
          )}
          <button type="button" onClick={onSave} className={linkButton}>
            <FileDown size={12} aria-hidden />
            Save to file
          </button>
        </div>
      )}
      {info.large && !truncated && mode === 'raw' && info.modes.includes('pretty') && (
        <div data-testid="response-body-large" className={noticeClass}>
          <span>
            Large body ({formatBytes(response.sizeBytes)}, over {formatBytes(PRETTY_LIMIT)}): shown
            raw.
          </span>
          <button
            type="button"
            data-testid="response-format-anyway"
            onClick={() => choose('pretty')}
            className={linkButton}
          >
            Format anyway
          </button>
        </div>
      )}
      {mode === 'preview' ? (
        <Preview response={response} kind={info.preview} />
      ) : pretty ? (
        <PrettyBody
          text={shown}
          language={info.language}
          knownValidJson={response.json !== undefined && !truncated}
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

function PrettyBody({ text, language, knownValidJson }: FormatRequest) {
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
        className="flex items-center gap-2 p-3 text-sm text-fg-muted"
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
        className="m-2 min-h-0 flex-1 rounded border border-border bg-white"
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
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
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3 text-sm"
    >
      <div className="flex items-center gap-3">
        <span className="text-fg">
          Binary body: {formatBytes(response.sizeBytes)}
          {response.contentType ? `, ${response.contentType}` : ''}
        </span>
        <button type="button" onClick={onSave} className={linkButton}>
          <FileDown size={12} aria-hidden />
          Save to file
        </button>
      </div>
      <pre
        data-testid="response-hex"
        aria-label={`First ${Math.min(response.sizeBytes, 256)} bytes in hexadecimal`}
        className="font-mono text-xs text-fg-muted"
      >
        {lines.join('\n')}
        {response.sizeBytes > 256 ? '\n…' : ''}
      </pre>
    </div>
  );
}
