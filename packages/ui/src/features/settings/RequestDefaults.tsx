import { useId } from 'react';

import { formatTimeoutPreference, usePreferences } from '../../app/preferences';
import { parseNonNegativeInt } from '../request-editor/SettingsTab';

/**
 * Settings → Requests: defaults for requests that don't override them in their Settings tab.
 * In memory until local state persistence lands (PIGN-018).
 */
export function RequestDefaults() {
  const timeoutMs = usePreferences((s) => s.execution.timeoutMs);
  const setExecution = usePreferences((s) => s.setExecution);
  const id = useId();

  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid="request-defaults"
      className="border-b border-border p-3 text-sm"
    >
      <h2 id={`${id}-title`} className="mb-2 font-semibold">
        Requests
      </h2>
      <label htmlFor={`${id}-timeout`} className="text-fg">
        Default timeout
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={`${id}-timeout`}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          data-testid="preference-timeout"
          value={timeoutMs}
          onChange={(event) => {
            const value = parseNonNegativeInt(event.target.value);
            if (value !== undefined) setExecution({ timeoutMs: value });
          }}
          className="h-7 w-32 rounded border border-border bg-bg px-2 font-mono text-sm text-fg"
        />
        <span className="text-xs text-fg-muted">ms</span>
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        {`Currently ${formatTimeoutPreference(timeoutMs)}. 0 = no timeout. A request's Settings tab can override it.`}
      </p>
    </section>
  );
}
