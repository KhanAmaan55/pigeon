import { DEFAULT_VOLATILE_HEADERS } from '@pigeon/core';
import { useId, useState } from 'react';

import { usePreferences } from '../../app/preferences';
import { Button, Checkbox, Textarea } from '../../components/ui';

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
      className="border-b border-border/60 p-4 text-sm"
    >
      <h2 id={`${id}-title`} className="mb-3 text-xs font-medium text-fg-muted">
        Examples &amp; comparison
      </h2>
      <label htmlFor={`${id}-compare`} className="mb-4 flex items-center gap-2 text-fg">
        <Checkbox
          id={`${id}-compare`}
          data-testid="preference-auto-compare"
          checked={autoCompare}
          onChange={(event) => setAutoCompare(event.target.checked)}
        />
        Compare responses with the baseline example after each send
      </label>
      <label htmlFor={`${id}-headers`} className="text-fg">
        Headers not saved in examples
      </label>
      <Textarea
        mono
        id={`${id}-headers`}
        data-testid="preference-volatile-headers"
        value={text}
        rows={6}
        spellCheck={false}
        onChange={(event) => apply(event.target.value)}
        className="mt-1.5"
      />
      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-fg-muted">
        <span>One header name per line, any case. They change on every call.</span>
        <Button
          size="xs"
          data-testid="reset-volatile-headers"
          onClick={() => {
            setText(DEFAULT_VOLATILE_HEADERS.join('\n'));
            setHeaders(DEFAULT_VOLATILE_HEADERS);
          }}
        >
          Reset
        </Button>
      </div>
    </section>
  );
}
