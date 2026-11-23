import type { Auth, EffectiveAuth } from '@pigeon/core';
import { authTypeLabel } from '@pigeon/formats';
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useId, useRef } from 'react';

import { VariableInput } from '../../components/VariableInput';
import { LiteralSecretHint } from '../request-editor/LiteralSecretHint';
import { emptyOAuth2, OAuth2Fields } from './OAuth2';

/**
 * Where the auth is edited: requests and folders can inherit; a collection (and the scratch
 * request) has nothing to inherit from, so "no auth" is its default.
 */
export type AuthLevel = 'request' | 'folder' | 'collection' | 'scratch';

type Choice =
  | 'inherit'
  | 'noauth'
  | 'basic'
  | 'bearer'
  | 'apikey'
  | 'digest'
  | 'awsv4'
  | 'oauth2'
  | 'unsupported';

const CHOICES: Array<{ value: Choice; label: string }> = [
  { value: 'inherit', label: 'Inherit from parent' },
  { value: 'noauth', label: 'No auth' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'apikey', label: 'API Key' },
  { value: 'digest', label: 'Digest Auth' },
  { value: 'awsv4', label: 'AWS Signature' },
  { value: 'oauth2', label: 'OAuth 2.0' },
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
    case 'digest':
      return {
        type,
        username: '',
        password: '',
        realm: '',
        nonce: '',
        algorithm: 'MD5',
        qop: '',
        nonceCount: '',
        clientNonce: '',
        opaque: '',
      };
    case 'oauth2':
      return emptyOAuth2();
    case 'awsv4':
      return {
        type,
        accessKey: '',
        secretKey: '',
        region: '',
        service: '',
        sessionToken: '',
        addAuthDataToQuery: false,
      };
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
 * inherited auth comes from. Unsupported types (OAuth 2.0, NTLM, Hawk, …) are shown read-only and
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

  const text = (
    label: string,
    testId: string,
    value: string,
    set: (value: string) => void,
    placeholder?: string,
  ): ReactNode => (
    <Field disabled={readOnly} label={label} testId={testId}>
      {(props) => (
        <VariableInput
          {...props}
          value={value}
          {...(placeholder ? { placeholder } : {})}
          onChange={(e) => set(e.target.value)}
        />
      )}
    </Field>
  );
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

      {auth?.type === 'digest' && (
        <>
          {text('Username', 'auth-username', auth.username, (username) =>
            onChange({ ...auth, username }),
          )}
          {text('Password', 'auth-password', auth.password, (password) =>
            onChange({ ...auth, password }),
          )}
          {secretField('password', auth.password, 'password', (password) =>
            onChange({ ...auth, password }),
          )}
          <Field disabled={readOnly} label="Algorithm" testId="auth-algorithm">
            {(props) => (
              <select
                {...props}
                value={auth.algorithm || 'MD5'}
                onChange={(e) => onChange({ ...auth, algorithm: e.target.value })}
                className="h-7 w-40 rounded border border-border bg-surface px-2 text-xs text-fg"
              >
                {['MD5', 'MD5-sess', 'SHA-256', 'SHA-256-sess'].map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <details className="text-xs">
            <summary className="cursor-pointer text-fg-muted select-none">
              Advanced (filled from the server's challenge when empty)
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {text('Realm', 'auth-realm', auth.realm, (realm) => onChange({ ...auth, realm }))}
              {text('Nonce', 'auth-nonce', auth.nonce, (nonce) => onChange({ ...auth, nonce }))}
              {text('qop', 'auth-qop', auth.qop, (qop) => onChange({ ...auth, qop }))}
              {text('Nonce count', 'auth-nc', auth.nonceCount, (nonceCount) =>
                onChange({ ...auth, nonceCount }),
              )}
              {text('Client nonce', 'auth-cnonce', auth.clientNonce, (clientNonce) =>
                onChange({ ...auth, clientNonce }),
              )}
              {text('Opaque', 'auth-opaque', auth.opaque, (opaque) =>
                onChange({ ...auth, opaque }),
              )}
            </div>
          </details>
          <p className="text-xs text-fg-muted">
            Pigeon sends the request, answers the server's 401 Digest challenge and sends it again.
            With realm and nonce set, the first request is signed directly.
          </p>
        </>
      )}

      {auth?.type === 'awsv4' && (
        <>
          {text('Access key', 'auth-access-key', auth.accessKey, (accessKey) =>
            onChange({ ...auth, accessKey }),
          )}
          {text('Secret key', 'auth-secret-key', auth.secretKey, (secretKey) =>
            onChange({ ...auth, secretKey }),
          )}
          {secretField('secret key', auth.secretKey, 'awsSecretKey', (secretKey) =>
            onChange({ ...auth, secretKey }),
          )}
          {text(
            'Region',
            'auth-region',
            auth.region,
            (region) => onChange({ ...auth, region }),
            'us-east-1',
          )}
          {text(
            'Service',
            'auth-service',
            auth.service,
            (service) => onChange({ ...auth, service }),
            'execute-api',
          )}
          {text('Session token', 'auth-session-token', auth.sessionToken, (sessionToken) =>
            onChange({ ...auth, sessionToken }),
          )}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              data-testid="auth-aws-query"
              disabled={readOnly}
              checked={auth.addAuthDataToQuery}
              onChange={(e) => onChange({ ...auth, addAuthDataToQuery: e.target.checked })}
            />
            Add the signature to the query string (instead of headers)
          </label>
        </>
      )}

      {auth?.type === 'oauth2' && (
        <OAuth2Fields
          auth={auth}
          onChange={onChange}
          text={text}
          secretField={secretField}
          readOnly={readOnly}
        />
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
