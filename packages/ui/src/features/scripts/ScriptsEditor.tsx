import type { ScriptListen } from '@pigeon/core';
import { readScript, writeScript } from '@pigeon/core';
import { Info } from 'lucide-react';
import { useId } from 'react';

import { CodeEditor } from '../../components/CodeEditor';

const SCRIPTS: Array<{ listen: ScriptListen; label: string }> = [
  { listen: 'prerequest', label: 'Pre-request' },
  { listen: 'test', label: 'Tests' },
];

/**
 * Pre-request and test scripts of a request, folder or collection (PIGN-031): JavaScript
 * editors with an enable toggle each. Kept in `event[]` exactly as Postman stores them; not run
 * yet (PIGN-043/044).
 */
export function ScriptsEditor({
  events,
  onChange,
  readOnly = false,
  editorClassName = 'h-48',
}: {
  events: readonly unknown[];
  onChange: (events: unknown[]) => void;
  readOnly?: boolean;
  editorClassName?: string;
}) {
  const id = useId();
  return (
    <div data-testid="scripts-editor" className="flex flex-col gap-3 p-3 text-sm">
      <p
        role="note"
        data-testid="scripts-not-run"
        className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1 text-xs text-fg-muted"
      >
        <Info size={12} className="shrink-0" aria-hidden />
        Scripts are saved and exported but not executed yet.
      </p>
      {SCRIPTS.map(({ listen, label }) => {
        const script = readScript(events, listen);
        const lines = script.text === '' ? 0 : script.text.split('\n').length;
        return (
          <section key={listen} aria-label={`${label} script`} data-testid={`script-${listen}`}>
            <div className="flex items-center gap-2 pb-1">
              <h2 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
                {label}
              </h2>
              <span data-testid={`script-${listen}-lines`} className="text-xs text-fg-muted">
                {lines} line{lines === 1 ? '' : 's'}
              </span>
              <label
                htmlFor={`${id}-${listen}`}
                className="ml-auto flex items-center gap-1 text-xs"
              >
                <input
                  id={`${id}-${listen}`}
                  type="checkbox"
                  data-testid={`script-${listen}-enabled`}
                  checked={!script.disabled}
                  disabled={readOnly || script.index === -1}
                  onChange={(event) =>
                    onChange(writeScript(events, listen, script.text, !event.target.checked))
                  }
                />
                Enabled
              </label>
            </div>
            <CodeEditor
              value={script.text}
              onChange={
                readOnly
                  ? undefined
                  : (text) => onChange(writeScript(events, listen, text, script.disabled))
              }
              readOnly={readOnly}
              language="javascript"
              ariaLabel={`${label} script`}
              testId={`script-${listen}-editor`}
              placeholder={
                listen === 'prerequest'
                  ? '// Runs before the request (not executed yet)'
                  : "// pm.test('status is 200', () => pm.response.to.have.status(200));"
              }
              className={editorClassName}
            />
          </section>
        );
      })}
    </div>
  );
}
