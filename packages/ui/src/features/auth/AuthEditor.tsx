import type { Auth, EffectiveAuth } from '@pigeon/core';
import { authTypeLabel } from '@pigeon/formats';
import type { ReactNode } from 'react';
import { useId, useRef } from 'react';

import { Callout, Checkbox, fieldClass, Select } from '../../components/ui';
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

/** Label + field rows of the auth forms (OAuth2.tsx lays out its selects the same way). */
const FIELD_ROW = 'grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3';

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
    <div data-testid="auth-editor" className="flex max-w-2xl flex-col gap-3 px-4 pt-3 pb-4 text-sm">
      <div className={`${FIELD_ROW} pb-1`}>
        <label htmlFor={selectId} className="text-xs font-medium text-fg-muted">
          Auth type
        </label>
        <Select
          id={selectId}
          data-testid="auth-type"
          value={choice}
          disabled={readOnly}
          onChange={(event) => choose(event.target.value as Choice)}
          className="w-56 max-w-full"
        >
          {choices.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          {auth?.type === 'unsupported' && (
            <option value="unsupported">Unsupported: {auth.authType}</option>
          )}
        </Select>
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
            {({ className: _field, ...props }) => (
              <Select
                {...props}
                value={auth.in}
                onChange={(e) => onChange({ ...auth, in: e.target.value as 'header' | 'query' })}
                className="w-40"
              >
                <option value="header">Header</option>
                <option value="query">Query params</option>
              </Select>
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
            {({ className: _field, ...props }) => (
              <Select
                {...props}
                value={auth.algorithm || 'MD5'}
                onChange={(e) => onChange({ ...auth, algorithm: e.target.value })}
                className="w-40"
              >
                {['MD5', 'MD5-sess', 'SHA-256', 'SHA-256-sess'].map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <details className="rounded-lg border border-border px-3 py-2 text-xs">
            <summary className="cursor-default text-fg-muted select-none hover:text-fg">
              Advanced (filled from the server's challenge when empty)
            </summary>
            <div className="mt-3 flex flex-col gap-3 pb-1">
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
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
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
        <Callout tone="warn" role="note" data-testid="auth-unsupported">
          {auth.authType} auth is not supported yet: the request is sent without auth. Its settings
          are kept unchanged in the file until you choose another type.
        </Callout>
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
    <div className={FIELD_ROW}>
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
        className: fieldClass({ mono: true }),
      })}
    </div>
  );
}
