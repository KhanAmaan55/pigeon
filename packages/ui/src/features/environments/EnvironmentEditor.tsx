import type { ProjectEnvVariable, ProjectSession } from '@pigeon/core';
import { Copy, Eye, RotateCcw, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';

import { usePlatform } from '../../app/PlatformProvider';

import type { KeyValueColumn } from '../../components/KeyValueTable';
import { KeyValueTable } from '../../components/KeyValueTable';
import {
  Button,
  Callout,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../components/ui';
import { useProjectState } from '../../stores/AppStoreProvider';
import { HelpLink } from '../help/WebLimitations';

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

const toVariable = (row: VariableRow, defaultType: string): ProjectEnvVariable => ({
  key: row.key,
  value: row.value,
  type: row.type ?? defaultType,
  enabled: row.disabled !== true,
  ...(row.description === undefined ? {} : { description: row.description }),
  ...(row.extra ? { extra: row.extra } : {}),
});

const NO_VALUES: Readonly<Record<string, string>> = {};
/** Like the key/value table's cells: see-through until hovered or focused. */
const cellInput =
  'h-7 w-full min-w-0 rounded border border-transparent bg-transparent px-2 font-mono text-sm text-fg transition-colors placeholder:text-fg-muted hover:border-border hover:bg-sunken focus:border-accent focus:bg-bg focus:ring-3 focus:ring-focus focus:outline-none disabled:opacity-60';
const cellButton =
  'inline-flex size-6 shrink-0 items-center justify-center rounded text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40';

export interface VariablesEditorProps {
  session: ProjectSession;
  title: string;
  /** Project file the shared values go to (for the explanation line). */
  file: string;
  values: readonly ProjectEnvVariable[];
  onChange: (values: ProjectEnvVariable[]) => void;
  /** Local scope key of the current values (`env:<id>`, `globals`, `collection:<id>`, …). */
  scope: string;
  readOnly: boolean;
  /** Type options; environments and globals use default/secret, collections add Postman's. */
  types?: ReadonlyArray<{ value: string; label: string }>;
  /** "Persist current as shared" (environments). */
  onPersist?: () => void;
  testId?: string;
}

const ENVIRONMENT_TYPES = [
  { value: 'default', label: 'default' },
  { value: 'secret', label: 'secret' },
];

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
  useProjectState((s) => s.model, null);
  const environment = session.findEnvironment(environmentId);
  if (!environment) return null;
  return (
    <VariablesEditor
      session={session}
      title={environment.name}
      file={`environments/${environment.fileKey}.postman_environment.json`}
      values={environment.values}
      onChange={(values) =>
        session.apply({ type: 'setEnvironmentValues', id: environmentId, values })
      }
      scope={`env:${environmentId}`}
      readOnly={session.readOnly || environment.broken === true}
      onPersist={() => session.persistCurrentAsShared(environmentId)}
      testId="environment-editor"
    />
  );
}

/** Variables with shared and current values, for every variable scope. */
export function VariablesEditor({
  session,
  title,
  file,
  values,
  onChange,
  scope,
  readOnly,
  types = ENVIRONMENT_TYPES,
  onPersist,
  testId = 'variables-editor',
}: VariablesEditorProps) {
  const current = useProjectState((s) => s.currentValues[scope] ?? NO_VALUES, NO_VALUES);
  const defaultType = types[0]!.value;
  const [unsecure, setUnsecure] = useState<{ apply: () => void; key: string } | null>(null);
  const showBrowserNotice =
    session.secretBackend === 'indexeddb' && values.some((v) => v.type === 'secret');
  const currentColumn: KeyValueColumn<VariableRow> = {
    id: 'current',
    header: 'Current value',
    headerTitle:
      'Local only: never written to project files or committed. Overrides the shared value on this machine.',
    render: (row, _update, isDraft) => (
      <CurrentValueCell
        secret={row.type === 'secret'}
        disabled={isDraft || row.key === ''}
        value={current[row.key] ?? ''}
        placeholder={isDraft ? '' : row.type === 'secret' ? '' : row.value}
        onChange={(value) =>
          session.setCurrentValue(scope, row.key, value === '' ? undefined : value)
        }
      />
    ),
  };
  const typeColumn: KeyValueColumn<VariableRow> = {
    id: 'type',
    header: 'Type',
    headerTitle:
      'Secret values are masked, kept in secret storage (never local state or project files) and masked in results.',
    render: (row, update) => (
      <select
        aria-label="Type"
        data-testid="env-variable-type"
        value={types.some((t) => t.value === row.type) ? row.type : defaultType}
        disabled={readOnly}
        onChange={(event) => {
          const next = { ...row, type: event.target.value };
          // Leaving "secret" moves the current value into plain local state: confirm first.
          if (row.type === 'secret' && next.type !== 'secret' && current[row.key] !== undefined) {
            setUnsecure({ apply: () => update(next), key: row.key });
          } else {
            update(next);
          }
        }}
        className="h-7 w-full cursor-default rounded border border-transparent bg-transparent px-1.5 text-sm text-fg transition-colors hover:border-border hover:bg-sunken focus:border-accent focus:ring-3 focus:ring-focus focus:outline-none disabled:opacity-60"
      >
        {types.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </select>
    ),
  };

  return (
    <div data-testid={testId} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
        <Button
          size="sm"
          data-testid="env-reset-current"
          disabled={Object.keys(current).length === 0}
          onClick={() => session.resetCurrentValues(scope)}
          icon={<RotateCcw aria-hidden />}
        >
          Reset current values
        </Button>
        {onPersist && (
          <Button
            size="sm"
            data-testid="env-persist-current"
            disabled={readOnly || Object.keys(current).length === 0}
            title={
              values.some((v) => v.type === 'secret' && v.key in current)
                ? 'Careful: this copies secret current values into the shared values, which are committed.'
                : 'Copies current values into the shared values (a change to save and commit).'
            }
            onClick={onPersist}
            icon={<Upload aria-hidden />}
          >
            Persist current as shared
          </Button>
        )}
      </div>
      {showBrowserNotice && <BrowserSecretsNotice />}
      <p className="shrink-0 px-4 pt-3 text-xs text-fg-muted">
        <strong className="text-fg">Shared values</strong> are written to <code>{file}</code> and
        committed. <strong className="text-fg">Current values</strong> stay on this machine.
      </p>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        <KeyValueTable<VariableRow>
          label="Variables"
          testId="env-variables"
          rows={values.map(toRow)}
          onChange={(rows) => onChange(rows.map((row) => toVariable(row, defaultType)))}
          valueHeader="Shared value"
          valueHeaderTitle="Committed to the project files and shared with your team."
          valuePlaceholder="Shared value"
          renderValue={
            readOnly
              ? (row) => (
                  <span className="px-2 font-mono text-sm">
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
          newRow={() => ({ key: '', value: '', type: defaultType })}
        />
      </div>
      <Dialog open={unsecure !== null} onOpenChange={(open) => !open && setUnsecure(null)}>
        <DialogContent width="sm" data-testid="unsecure-dialog">
          <DialogTitle>Stop treating “{unsecure?.key}” as secret?</DialogTitle>
          <DialogDescription>
            Its current value moves out of secret storage into normal local state, and it is no
            longer masked in results.
          </DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              data-testid="unsecure-confirm"
              onClick={() => {
                unsecure?.apply();
                setUnsecure(null);
              }}
            >
              Make it a default variable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A current value; secrets are masked, shown while the eye is held, and can be copied. */
function CurrentValueCell({
  secret,
  disabled,
  value,
  placeholder,
  onChange,
}: {
  secret: boolean;
  disabled: boolean;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  if (!secret) {
    return (
      <input
        aria-label="Current value"
        data-testid="env-current-value"
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className={cellInput}
      />
    );
  }
  return (
    <div className="flex items-center gap-0.5">
      <input
        aria-label="Current value"
        data-testid="env-current-value"
        type={revealed ? 'text' : 'password'}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className={cellInput}
      />
      <button
        type="button"
        aria-label="Hold to reveal"
        title="Hold to reveal"
        data-testid="secret-reveal"
        disabled={disabled || value === ''}
        onPointerDown={() => setRevealed(true)}
        onPointerUp={() => setRevealed(false)}
        onPointerLeave={() => setRevealed(false)}
        onKeyDown={(event) => event.key === ' ' && setRevealed(true)}
        onKeyUp={() => setRevealed(false)}
        className={cellButton}
      >
        <Eye size={12} aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Copy value"
        title="Copy value"
        data-testid="secret-copy"
        disabled={disabled || value === ''}
        onClick={() => void navigator.clipboard?.writeText(value)}
        className={cellButton}
      >
        <Copy size={12} aria-hidden />
      </button>
    </div>
  );
}

const NOTICE_KEY = 'secretsNoticeDismissed';

/** One-time web notice (docs/platform.md §6.4): secrets live unencrypted in this browser profile. */
function BrowserSecretsNotice() {
  const { appState } = usePlatform();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void appState.get<boolean>('app', NOTICE_KEY).then(
      (value) => !cancelled && setDismissed(value === true),
      () => !cancelled && setDismissed(false),
    );
    return () => {
      cancelled = true;
    };
  }, [appState]);
  if (dismissed !== false) return null;
  return (
    <Callout
      role="note"
      tone="warn"
      data-testid="browser-secrets-notice"
      className="mx-4 mt-3 shrink-0"
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          Secrets are stored in this browser profile, unencrypted. Don't use production credentials
          on shared machines. <HelpLink section="secrets" />
        </span>
        <Button
          size="xs"
          data-testid="browser-secrets-dismiss"
          onClick={() => {
            setDismissed(true);
            void appState.set('app', NOTICE_KEY, true);
          }}
        >
          Got it
        </Button>
      </div>
    </Callout>
  );
}
