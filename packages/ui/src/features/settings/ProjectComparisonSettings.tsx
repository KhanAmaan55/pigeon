import type { ProjectFieldRule } from '@pigeon/core';
import { projectBodySettings, projectRules } from '@pigeon/core';
import { ruleToFile } from '@pigeon/formats';
import { useId } from 'react';

import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';
import { RulesTable } from '../compare/RulesTable';

type Comparison = Record<string, unknown>;

/**
 * Settings → Comparison defaults of the open project (`pigeon.json` `comparison`, PIGN-035):
 * status mode, compared headers, body mode, additional fields, integers, and project rules that
 * apply to every request. Edits are unsaved changes of `pigeon.json`.
 */
export function ProjectComparisonSettings() {
  const project = useAppStore((s) => s.project);
  const model = useProjectState((s) => s.model, null);
  const readOnly = useProjectState((s) => s.readOnly, true);
  const id = useId();
  if (!project || !model) return null;
  const comparison = (
    typeof model.comparison === 'object' && model.comparison !== null ? model.comparison : {}
  ) as Comparison;
  const body = projectBodySettings(model);
  const headers = (comparison['headers'] ?? {}) as { compare?: string[]; mode?: string };
  const set = (patch: Comparison) => {
    const next: Comparison = { ...comparison, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    project.session.apply({
      type: 'setComparisonDefaults',
      comparison: Object.keys(next).length === 0 ? undefined : next,
    });
  };
  const setBody = (patch: Comparison) =>
    set({ body: { ...((comparison['body'] as Comparison | undefined) ?? {}), ...patch } });
  const select = (
    label: string,
    testId: string,
    value: string,
    options: readonly string[],
    onChange: (value: string) => void,
  ) => (
    <label className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <select
        data-testid={testId}
        value={value}
        disabled={readOnly}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 rounded border border-border bg-surface px-2 text-xs"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid="project-comparison-settings"
      className="flex flex-col gap-2 border-b border-border p-3 text-sm"
    >
      <h2 id={`${id}-title`} className="font-semibold">
        Comparison defaults
        <span className="ml-1 text-xs font-normal text-fg-muted">({model.name}, pigeon.json)</span>
      </h2>
      {select(
        'Status',
        'comparison-status',
        String(comparison['status'] ?? 'exact'),
        ['exact', 'class', 'ignore'],
        (status) => set({ status }),
      )}
      <label className="flex flex-col gap-1">
        <span>Compared headers</span>
        <input
          data-testid="comparison-headers"
          defaultValue={(headers.compare ?? ['content-type']).join(', ')}
          readOnly={readOnly}
          onBlur={(event) =>
            set({
              headers: {
                ...headers,
                compare: event.target.value
                  .split(',')
                  .map((name) => name.trim().toLowerCase())
                  .filter((name) => name !== ''),
              },
            })
          }
          className="h-7 rounded border border-border bg-bg px-2 font-mono text-xs"
        />
      </label>
      {select(
        'Header mode',
        'comparison-header-mode',
        headers.mode ?? 'media-type',
        ['media-type', 'value', 'presence'],
        (mode) => set({ headers: { ...headers, mode } }),
      )}
      {select('Body', 'comparison-body-mode', body.mode, ['schema', 'values', 'none'], (mode) =>
        setBody({ mode }),
      )}
      {select(
        'Additional fields',
        'comparison-additional-fields',
        body.additionalFields,
        ['ignore', 'warn', 'fail'],
        (additionalFields) => setBody({ additionalFields }),
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          data-testid="comparison-distinguish-integers"
          checked={body.distinguishIntegers}
          disabled={readOnly}
          onChange={(event) => setBody({ distinguishIntegers: event.target.checked })}
        />
        Tell integers from other numbers
      </label>
      <h3 className="pt-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
        Project rules (every request)
      </h3>
      <RulesTable
        rules={projectRules(model)}
        testId="project-rules-editor"
        {...(readOnly
          ? {}
          : {
              onChange: (rules: ProjectFieldRule[]) =>
                set({ rules: rules.length === 0 ? undefined : rules.map(ruleToFile) }),
            })}
      />
    </section>
  );
}
