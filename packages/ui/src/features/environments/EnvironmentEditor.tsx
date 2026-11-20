import type { ProjectEnvVariable, ProjectSession } from '@pigeon/core';
import { RotateCcw, Upload } from 'lucide-react';

import type { KeyValueColumn } from '../../components/KeyValueTable';
import { KeyValueTable } from '../../components/KeyValueTable';
import { useProjectState } from '../../stores/AppStoreProvider';

/** A variable as a key/value row: `disabled` = !enabled; the type rides in `type`. */
interface VariableRow {
  key: string;
  value: string;
  disabled?: boolean;
  type?: string;
  description?: ProjectEnvVariable['description'];
  extra?: Record<string, unknown>;
}

const toRow = (variable: ProjectEnvVariable): VariableRow => ({
  key: variable.key,
  value: variable.value,
  type: variable.type,
  ...(variable.enabled ? {} : { disabled: true }),
  ...(variable.description === undefined ? {} : { description: variable.description }),
  ...(variable.extra ? { extra: variable.extra } : {}),
});

const toVariable = (row: VariableRow): ProjectEnvVariable => ({
  key: row.key,
  value: row.value,
  type: row.type ?? 'default',
  enabled: row.disabled !== true,
  ...(row.description === undefined ? {} : { description: row.description }),
  ...(row.extra ? { extra: row.extra } : {}),
});

const NO_VALUES: Readonly<Record<string, string>> = {};
const cellInput =
  'h-7 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1.5 font-mono text-sm text-fg placeholder:text-fg-muted hover:border-border focus:border-accent focus:outline-none';

/**
 * An environment's variables (docs/ui-ux.md §3.4): Enabled, Key, Shared value (committed),
 * Current value (local only), Type, Description.
 */
export function EnvironmentEditor({
  session,
  environmentId,
}: {
  session: ProjectSession;
  environmentId: string;
}) {
  // Re-render on working-model and local-state changes.
  useProjectState((s) => s.model, null);
  const scope = `env:${environmentId}`;
  const current = useProjectState((s) => s.currentValues[scope] ?? NO_VALUES, NO_VALUES);
  const environment = session.findEnvironment(environmentId);
  if (!environment) return null;
  const readOnly = session.readOnly || environment.broken === true;

  const currentColumn: KeyValueColumn<VariableRow> = {
    id: 'current',
    header: 'Current value',
    headerTitle:
      'Local only: never written to project files or committed. Overrides the shared value on this machine.',
    render: (row, _update, isDraft) => {
      const secret = row.type === 'secret';
      return (
        <input
          aria-label="Current value"
          data-testid="env-current-value"
          type={secret ? 'password' : 'text'}
          disabled={isDraft || row.key === ''}
          value={current[row.key] ?? ''}
          placeholder={isDraft ? '' : row.value}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) =>
            session.setCurrentValue(
              scope,
              row.key,
              event.target.value === '' ? undefined : event.target.value,
            )
          }
          className={cellInput}
        />
      );
    },
  };
  const typeColumn: KeyValueColumn<VariableRow> = {
    id: 'type',
    header: 'Type',
    headerTitle: 'Secret values are masked (secret storage arrives with secret variables).',
    render: (row, update) => (
      <select
        aria-label="Type"
        data-testid="env-variable-type"
        value={row.type === 'secret' ? 'secret' : 'default'}
        disabled={readOnly}
        onChange={(event) => update({ ...row, type: event.target.value })}
        className="h-7 rounded-sm border border-transparent bg-transparent px-1 text-sm hover:border-border"
      >
        <option value="default">default</option>
        <option value="secret">secret</option>
      </select>
    ),
  };

  return (
    <div data-testid="environment-editor" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{environment.name}</h2>
        <button
          type="button"
          data-testid="env-reset-current"
          disabled={Object.keys(current).length === 0}
          onClick={() => session.resetCurrentValues(scope)}
          className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-hover disabled:opacity-50"
        >
          <RotateCcw size={12} aria-hidden />
          Reset current values
        </button>
        <button
          type="button"
          data-testid="env-persist-current"
          disabled={readOnly || Object.keys(current).length === 0}
          title={
            environment.values.some((v) => v.type === 'secret' && v.key in current)
              ? 'Careful: this copies secret current values into the shared values, which are committed.'
              : 'Copies current values into the shared values (a change to save and commit).'
          }
          onClick={() => session.persistCurrentAsShared(environmentId)}
          className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-hover disabled:opacity-50"
        >
          <Upload size={12} aria-hidden />
          Persist current as shared
        </button>
      </div>
      <p className="shrink-0 px-3 pt-2 text-xs text-fg-muted">
        <strong className="text-fg">Shared values</strong> are written to{' '}
        <code>environments/{environment.fileKey}.postman_environment.json</code> and committed.{' '}
        <strong className="text-fg">Current values</strong> stay on this machine.
      </p>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <KeyValueTable<VariableRow>
          label="Variables"
          testId="env-variables"
          rows={environment.values.map(toRow)}
          onChange={(rows) =>
            session.apply({
              type: 'setEnvironmentValues',
              id: environmentId,
              values: rows.map(toVariable),
            })
          }
          valueHeader="Shared value"
          valueHeaderTitle="Committed to the project files and shared with your team."
          valuePlaceholder="Shared value"
          renderValue={
            readOnly
              ? (row) => (
                  <span className="px-1.5 font-mono text-sm">
                    {row.type === 'secret' ? '••••' : row.value}
                  </span>
                )
              : (row, update) =>
                  row.type === 'secret' ? (
                    <input
                      aria-label="Shared value"
                      type="password"
                      value={row.value}
                      onChange={(event) => update({ ...row, value: event.target.value })}
                      className={cellInput}
                    />
                  ) : undefined
          }
          extraColumns={[currentColumn, typeColumn]}
          newRow={() => ({ key: '', value: '', type: 'default' })}
        />
      </div>
    </div>
  );
}
