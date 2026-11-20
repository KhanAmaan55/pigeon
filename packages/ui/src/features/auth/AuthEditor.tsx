import type { Auth, EffectiveAuth } from '@pigeon/core';
import { authTypeLabel } from '@pigeon/formats';
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useId, useRef } from 'react';

import { VariableInput } from '../../components/VariableInput';
import { LiteralSecretHint } from '../request-editor/LiteralSecretHint';

/**
 * Where the auth is edited: requests and folders can inherit; a collection (and the scratch
 * request) has nothing to inherit from, so "no auth" is its default.
 */
export type AuthLevel = 'request' | 'folder' | 'collection' | 'scratch';

type Choice = 'inherit' | 'noauth' | 'basic' | 'bearer' | 'apikey' | 'unsupported';

const CHOICES: Array<{ value: Choice; label: string }> = [
  { value: 'inherit', label: 'Inherit from parent' },
  { value: 'noauth', label: 'No auth' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'apikey', label: 'API Key' },
];

function emptyAuth(type: Exclude<Choice, 'inherit' | 'unsupported'>): Auth {
  switch (type) {
    case 'noauth':
      return { type };
    case 'basic':
      return { type, username: '', password: '' };
    case 'bearer':
      return { type, token: '' };
    case 'apikey':
      return { type, key: '', value: '', in: 'header' };
  }
}

/** "Bearer", "Basic", … or "No auth" for what an entity ends up using. */
export function describeAuth(auth: Auth | undefined): string {
  return auth ? authTypeLabel(auth) : 'No auth';
}

/** "Inherited from collection Users API: Bearer" (or what is inherited when nothing is). */
export function inheritedLabel(inherited: EffectiveAuth): string {
  if (!inherited.origin) return 'Nothing to inherit: the request is sent without auth.';
  return `Inherited from ${inherited.origin.kind} ${inherited.origin.name}: ${describeAuth(inherited.auth)}`;
}

/**
 * The Auth section of requests, folders and collections (PIGN-026): type selector, the fields of
 * the chosen type (with `{{variable}}` highlighting and the literal-credential hint), and where
 * inherited auth comes from. Unsupported types (OAuth 2.0, Digest, …) are shown read-only and
 * kept verbatim until another type is chosen.
 */
export function AuthEditor({
  auth,
  onChange,
  level,
  inherited,
  moveToSecret,
  readOnly = false,
}: {
  auth: Auth | undefined;
  onChange: (auth: Auth | undefined) => void;
  level: AuthLevel;
  /** What `auth === undefined` means for requests and folders. */
  inherited?: EffectiveAuth;
  moveToSecret?: ((suggestedName: string, value: string) => string | null) | null;
  readOnly?: boolean;
}) {
  const canInherit = level === 'request' || level === 'folder';
  // Fields typed for other types, so switching back restores them (like Postman).
  const drafts = useRef(new Map<string, Auth>());
  const selectId = useId();
  const choice: Choice = auth ? auth.type : canInherit ? 'inherit' : 'noauth';
  const choices = CHOICES.filter((c) => canInherit || c.value !== 'inherit');

  const choose = (next: Choice) => {
    if (auth) drafts.current.set(auth.type, auth);
    if (next === 'inherit') onChange(undefined);
    else if (next === 'noauth' && !canInherit) onChange(undefined);
    else if (next !== 'unsupported') onChange(drafts.current.get(next) ?? emptyAuth(next));
  };

  const secretField = (
    label: string,
    value: string,
    suggestedName: string,
    set: (value: string) => void,
  ): ReactNode => {
    const literal = value.trim() !== '' && !value.includes('{{');
    if (!literal || !moveToSecret || readOnly) return null;
    return (
      <LiteralSecretHint
        label={label}
        onMove={() => {
          const name = moveToSecret(suggestedName, value);
          if (name) set(`{{${name}}}`);
        }}
      />
    );
  };

  return (
    <div data-testid="auth-editor" className="flex flex-col gap-3 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={selectId}
          className="text-xs font-semibold tracking-wide text-fg-muted uppercase"
        >
          Auth type
        </label>
        <select
          id={selectId}
          data-testid="auth-type"
          value={choice}
          disabled={readOnly}
          onChange={(event) => choose(event.target.value as Choice)}
          className="h-7 rounded border border-border bg-surface px-2 text-xs text-fg"
        >
          {choices.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          {auth?.type === 'unsupported' && (
            <option value="unsupported">Unsupported: {auth.authType}</option>
          )}
        </select>
      </div>

      {!auth && canInherit && inherited && (
        <p data-testid="auth-inherited" className="text-fg-muted">
          {inheritedLabel(inherited)}
          {inherited.auth?.type === 'unsupported' && ' (not supported yet; sent without auth)'}
        </p>
      )}
      {!auth && !canInherit && (
        <p className="text-fg-muted">
          {level === 'collection'
            ? 'Requests and folders set to "Inherit from parent" are sent without auth.'
            : 'The request is sent without auth.'}
        </p>
      )}
      {auth?.type === 'noauth' && (
        <p className="text-fg-muted">
          No auth is sent{canInherit ? ', and nothing is inherited from parents' : ''}.
        </p>
      )}

      {auth?.type === 'basic' && (
        <>
          <Field disabled={readOnly} label="Username" testId="auth-username">
            {(props) => (
              <VariableInput
                {...props}
                value={auth.username}
                onChange={(e) => onChange({ ...auth, username: e.target.value })}
              />
            )}
          </Field>
          <Field disabled={readOnly} label="Password" testId="auth-password">
            {(props) => (
              <VariableInput
                {...props}
                value={auth.password}
                onChange={(e) => onChange({ ...auth, password: e.target.value })}
              />
            )}
          </Field>
          {secretField('password', auth.password, 'password', (password) =>
            onChange({ ...auth, password }),
          )}
        </>
      )}

      {auth?.type === 'bearer' && (
        <>
          <Field disabled={readOnly} label="Token" testId="auth-token">
            {(props) => (
              <VariableInput
                {...props}
                value={auth.token}
                onChange={(e) => onChange({ ...auth, token: e.target.value })}
              />
            )}
          </Field>
          {secretField('token', auth.token, 'token', (token) => onChange({ ...auth, token }))}
        </>
      )}

      {auth?.type === 'apikey' && (
        <>
          <Field disabled={readOnly} label="Key" testId="auth-key">
            {(props) => (
              <VariableInput
                {...props}
                value={auth.key}
                placeholder="X-API-Key"
                onChange={(e) => onChange({ ...auth, key: e.target.value })}
              />
            )}
          </Field>
          <Field disabled={readOnly} label="Value" testId="auth-value">
            {(props) => (
              <VariableInput
                {...props}
                value={auth.value}
                onChange={(e) => onChange({ ...auth, value: e.target.value })}
              />
            )}
          </Field>
          {secretField('API key', auth.value, 'apiKey', (value) => onChange({ ...auth, value }))}
          <Field disabled={readOnly} label="Add to" testId="auth-in">
            {(props) => (
              <select
                {...props}
                value={auth.in}
                onChange={(e) => onChange({ ...auth, in: e.target.value as 'header' | 'query' })}
                className="h-7 w-40 rounded border border-border bg-surface px-2 text-xs text-fg"
              >
                <option value="header">Header</option>
                <option value="query">Query params</option>
              </select>
            )}
          </Field>
        </>
      )}

      {auth?.type === 'unsupported' && (
        <p
          role="note"
          data-testid="auth-unsupported"
          className="flex items-start gap-2 rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-xs"
        >
          <TriangleAlert size={14} className="mt-px shrink-0 text-warn" aria-hidden />
          <span>
            {auth.authType} auth is not supported yet: the request is sent without auth. Its
            settings are kept unchanged in the file until you choose another type.
          </span>
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  testId,
  disabled = false,
  children,
}: {
  label: string;
  testId: string;
  disabled?: boolean;
  children: (props: {
    id: string;
    'aria-label': string;
    'data-testid': string;
    disabled?: boolean;
    spellCheck: false;
    autoComplete: 'off';
    className: string;
  }) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
      <label htmlFor={id} className="text-fg-muted">
        {label}
      </label>
      {children({
        id,
        'aria-label': label,
        'data-testid': testId,
        disabled,
        spellCheck: false,
        autoComplete: 'off',
        className:
          'h-8 w-full min-w-0 rounded border border-border bg-bg px-2 font-mono text-sm text-fg placeholder:text-fg-muted',
      })}
    </div>
  );
}
