import { DEFAULT_VOLATILE_HEADERS } from '@pigeon/core';
import { useId, useState } from 'react';

import { usePreferences } from '../../app/preferences';

/**
 * Settings → Examples: the response headers "Save as example" leaves out because they change on
 * every call (file-format.md §2.6). One name per line.
 */
export function ExampleSettings() {
  const headers = usePreferences((s) => s.volatileHeaders);
  const autoCompare = usePreferences((s) => s.autoCompare);
  const setAutoCompare = usePreferences((s) => s.setAutoCompare);
  const setHeaders = usePreferences((s) => s.setVolatileHeaders);
  const [text, setText] = useState(() => headers.join('\n'));
  const id = useId();
  const apply = (value: string) => {
    setText(value);
    setHeaders(
      value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    );
  };
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid="example-settings"
      className="border-b border-border p-3 text-sm"
    >
      <h2 id={`${id}-title`} className="mb-2 font-semibold">
        Examples &amp; comparison
      </h2>
      <label htmlFor={`${id}-compare`} className="mb-3 flex items-center gap-2 text-fg">
        <input
          id={`${id}-compare`}
          type="checkbox"
          data-testid="preference-auto-compare"
          checked={autoCompare}
          onChange={(event) => setAutoCompare(event.target.checked)}
        />
        Compare responses with the baseline example after each send
      </label>
      <label htmlFor={`${id}-headers`} className="text-fg">
        Headers not saved in examples
      </label>
      <textarea
        id={`${id}-headers`}
        data-testid="preference-volatile-headers"
        value={text}
        rows={6}
        spellCheck={false}
        onChange={(event) => apply(event.target.value)}
        className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-fg"
      />
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-fg-muted">
        <span>One header name per line, any case. They change on every call.</span>
        <button
          type="button"
          data-testid="reset-volatile-headers"
          onClick={() => {
            setText(DEFAULT_VOLATILE_HEADERS.join('\n'));
            setHeaders(DEFAULT_VOLATILE_HEADERS);
          }}
          className="shrink-0 rounded border border-border px-2 py-0.5 hover:bg-hover"
        >
          Reset
        </button>
      </div>
    </section>
  );
}
