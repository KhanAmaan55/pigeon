import type { ScriptListen } from '@pigeon/core';
import { readScript, writeScript } from '@pigeon/core';
import { useId } from 'react';

import { CodeEditor } from '../../components/CodeEditor';
import { Callout, Checkbox, SectionLabel } from '../../components/ui';
import { useProjectState } from '../../stores/AppStoreProvider';

const SCRIPTS: Array<{ listen: ScriptListen; label: string }> = [
  { listen: 'prerequest', label: 'Pre-request' },
  { listen: 'test', label: 'Tests' },
];

/**
 * Pre-request and test scripts of a request, folder or collection (PIGN-031): JavaScript
 * editors with an enable toggle each. Kept in `event[]` exactly as Postman stores them; they run
 * in the script sandbox on send (PIGN-043/044).
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
  const scriptsRun = useProjectState((s) => s.scriptsEnabled, true);
  return (
    <div data-testid="scripts-editor" className="flex flex-col gap-5 px-3 pt-2 pb-3 text-sm">
      <Callout tone="neutral" role="note" data-testid="scripts-not-run" className="text-fg-muted">
        {scriptsRun
          ? 'Scripts run in a sandbox: pre-request before each send, tests after the response (Tests and Console tabs).'
          : 'Script execution is off for this project (Settings → Scripts). Scripts are saved and exported.'}
      </Callout>
      {SCRIPTS.map(({ listen, label }) => {
        const script = readScript(events, listen);
        const lines = script.text === '' ? 0 : script.text.split('\n').length;
        return (
          <section key={listen} aria-label={`${label} script`} data-testid={`script-${listen}`}>
            <div className="flex items-center gap-2 pb-1.5">
              <SectionLabel role="heading" aria-level={2}>
                {label}
              </SectionLabel>
              <span data-testid={`script-${listen}-lines`} className="text-xs text-fg-muted/80">
                {lines} line{lines === 1 ? '' : 's'}
              </span>
              <label
                htmlFor={`${id}-${listen}`}
                className="ml-auto flex items-center gap-1.5 text-xs text-fg"
              >
                <Checkbox
                  id={`${id}-${listen}`}
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
