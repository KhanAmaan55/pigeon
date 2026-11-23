import { useId } from 'react';

import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';

/**
 * Settings → Scripts (PIGN-043): whether this project's pre-request scripts run on send (on by
 * default; kept in the project's local state, so it is a per-machine choice).
 */
export function ScriptSettings() {
  const project = useAppStore((s) => s.project);
  const enabled = useProjectState((s) => s.scriptsEnabled, true);
  const id = useId();
  if (!project) return null;
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid="script-settings"
      className="border-b border-border p-3 text-sm"
    >
      <h2 id={`${id}-title`} className="mb-2 font-semibold">
        Scripts
      </h2>
      <label htmlFor={`${id}-run`} className="flex items-start gap-2 text-fg">
        <input
          id={`${id}-run`}
          type="checkbox"
          data-testid="preference-run-scripts"
          checked={enabled}
          onChange={(event) => project.store.getState().setScriptsEnabled(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          Run pre-request scripts of “{project.session.name}”
          <span className="block text-xs text-fg-muted">
            Scripts run in a sandbox without network or file access and stop after 5 s. Their
            variable changes become current values on this machine, never shared values.
          </span>
        </span>
      </label>
    </section>
  );
}
