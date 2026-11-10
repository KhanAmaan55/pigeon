import type { BodyMode, BodyOf, RawLanguage } from '@pigeon/core';
import { hasBody, prunesBody } from '@pigeon/core';
import { TriangleAlert, WandSparkles } from 'lucide-react';
import { useState } from 'react';

import { useCapabilities } from '../../../app/PlatformProvider';
import { CodeEditor } from '../../../components/CodeEditor';
import { KeyValueTable } from '../../../components/KeyValueTable';
import { beautifyJson } from '../../../lib/json-format';
import { useScratchRequest } from '../ScratchRequestProvider';
import { FileChip, FilePicker } from './FilePicker';
import { FormDataTable } from './FormDataTable';

const MODES: ReadonlyArray<{ mode: BodyMode; label: string }> = [
  { mode: 'none', label: 'none' },
  { mode: 'formdata', label: 'form-data' },
  { mode: 'urlencoded', label: 'x-www-form-urlencoded' },
  { mode: 'raw', label: 'raw' },
  { mode: 'file', label: 'binary' },
];

const LANGUAGES: ReadonlyArray<{ language: RawLanguage; label: string }> = [
  { language: 'json', label: 'JSON' },
  { language: 'text', label: 'Text' },
  { language: 'javascript', label: 'JavaScript' },
  { language: 'html', label: 'HTML' },
  { language: 'xml', label: 'XML' },
];

/**
 * Body mode radio and the editor for the active mode (docs/ui-ux.md §3.3). Switching modes keeps
 * the other modes' content in the editor state (`bodyDrafts`), like Postman.
 */
export function BodyTab() {
  const body = useScratchRequest((s) => s.request.body);
  const setBodyMode = useScratchRequest((s) => s.setBodyMode);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
        <div role="radiogroup" aria-label="Body type" className="flex flex-wrap items-center gap-3">
          {MODES.map(({ mode, label }) => (
            <label key={mode} className="flex items-center gap-1 text-sm text-fg">
              <input
                type="radio"
                name="body-mode"
                value={mode}
                data-testid={`body-mode-${mode}`}
                checked={body.mode === mode}
                onChange={() => setBodyMode(mode)}
                className="accent-accent"
              />
              {label}
            </label>
          ))}
        </div>
        {body.mode === 'raw' && <RawToolbar body={body} />}
      </div>
      <GetBodyNotice />
      {body.mode === 'none' && (
        <p className="py-6 text-center text-sm text-fg-muted">This request does not have a body.</p>
      )}
      {body.mode === 'raw' && <RawBody body={body} />}
      {body.mode === 'urlencoded' && <UrlencodedBody body={body} />}
      {body.mode === 'formdata' && <FormDataBody body={body} />}
      {body.mode === 'file' && <BinaryBody body={body} />}
    </div>
  );
}

function RawToolbar({ body }: { body: BodyOf<'raw'> }) {
  const setBody = useScratchRequest((s) => s.setBody);
  const [beautifyFailed, setBeautifyFailed] = useState(false);
  return (
    <div className="ml-auto flex items-center gap-2">
      {body.language === 'json' && (
        <button
          type="button"
          data-testid="beautify-button"
          title={beautifyFailed ? 'The JSON is not valid, so it cannot be beautified' : 'Beautify'}
          onClick={() => {
            const pretty = beautifyJson(body.raw);
            setBeautifyFailed(pretty === null);
            if (pretty !== null && pretty !== body.raw) setBody({ ...body, raw: pretty });
          }}
          className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs hover:bg-hover ${beautifyFailed ? 'text-fail' : 'text-fg-muted hover:text-fg'}`}
        >
          <WandSparkles size={12} aria-hidden />
          Beautify
        </button>
      )}
      <select
        aria-label="Raw body language"
        data-testid="raw-language-select"
        value={body.language}
        onChange={(event) => {
          setBeautifyFailed(false);
          setBody({ ...body, language: event.target.value as RawLanguage });
        }}
        className="h-7 rounded border border-border bg-surface px-2 text-xs text-fg"
      >
        {LANGUAGES.map(({ language, label }) => (
          <option key={language} value={language}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RawBody({ body }: { body: BodyOf<'raw'> }) {
  const setBody = useScratchRequest((s) => s.setBody);
  return (
    <CodeEditor
      value={body.raw}
      onChange={(raw) => setBody({ ...body, raw })}
      language={body.language}
      lint={body.language === 'json'}
      ariaLabel="Request body"
      testId="body-input"
      placeholder="Request body"
      className="flex-1"
    />
  );
}

function UrlencodedBody({ body }: { body: BodyOf<'urlencoded'> }) {
  const setBody = useScratchRequest((s) => s.setBody);
  return (
    <KeyValueTable
      label="URL-encoded form"
      testId="urlencoded-table"
      rows={body.params}
      onChange={(params) => setBody({ ...body, params })}
      keyPlaceholder="Add field"
    />
  );
}

function FormDataBody({ body }: { body: BodyOf<'formdata'> }) {
  const setBody = useScratchRequest((s) => s.setBody);
  return <FormDataTable params={body.params} onChange={(params) => setBody({ ...body, params })} />;
}

function BinaryBody({ body }: { body: BodyOf<'file'> }) {
  const setBody = useScratchRequest((s) => s.setBody);
  const clear = () => {
    const next = { ...body };
    delete next.src;
    setBody(next);
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div data-testid="binary-file" className="flex items-center gap-2">
        {body.src !== undefined && <FileChip src={body.src} onRemove={clear} />}
        <FilePicker
          label={body.src === undefined ? 'Select file' : 'Replace'}
          testId="binary-file-input"
          onPicked={([src]) => src !== undefined && setBody({ ...body, src })}
        />
      </div>
      <p className="text-xs text-fg-muted">
        The file is sent as is. Content-Type comes from the file extension unless you set one in
        Headers. Picked files are kept in memory until the app is closed.
      </p>
    </div>
  );
}

/** A GET/HEAD request with a body: browsers can't send it; desktop drops it unless allowed. */
function GetBodyNotice() {
  const method = useScratchRequest((s) => s.request.method);
  const withBody = useScratchRequest((s) => hasBody(s.request.body));
  const sendsGetBody = useScratchRequest((s) => s.request.settings.disableBodyPruning === true);
  const { canSendBodyWithGet } = useCapabilities();
  if (!withBody || !prunesBody(method) || (canSendBodyWithGet && sendsGetBody)) return null;
  return (
    <p
      data-testid="get-body-notice"
      className="flex shrink-0 items-start gap-1.5 rounded bg-hover px-2 py-1 text-xs text-fg-muted"
    >
      <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warn" aria-hidden />
      {canSendBodyWithGet
        ? `${method} requests are sent without this body unless "Send body with GET" is on in the Settings tab.`
        : `Browsers can't send a body with ${method} requests. Use another method, e.g. POST, or the desktop app.`}
    </p>
  );
}
