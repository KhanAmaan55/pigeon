import type { KeyValue } from '@pigeon/core';
import { autoHeaders } from '@pigeon/core';
import { isForbiddenHeader } from '@pigeon/platform';
import { TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';

import { useCapabilities } from '../../app/PlatformProvider';
import { KeyValueTable } from '../../components/KeyValueTable';
import { SectionLabel } from '../../components/ui';
import { LiteralSecretHint } from './LiteralSecretHint';
import { useScratchRequest } from './ScratchRequestProvider';
import { useAppStore } from '../../stores/AppStoreProvider';
import { HelpLink } from '../help/WebLimitations';

/**
 * Request headers, the headers Pigeon adds (read-only, greyed) and, where the transport can't set
 * every header (browsers), a warning on the ones that won't be sent.
 */
export function HeadersTab() {
  const headers = useScratchRequest((s) => s.request.headers);
  const body = useScratchRequest((s) => s.request.body);
  const setHeaders = useScratchRequest((s) => s.setHeaders);
  const capabilities = useCapabilities();
  const openHelp = useAppStore((s) => s.openHelp);
  const moveToSecret = useScratchRequest((s) => s.moveToSecret);
  const literal = moveToSecret ? literalCredential(headers) : undefined;
  const automatic = useMemo(
    () => autoHeaders({ headers, body }, capabilities),
    [headers, body, capabilities],
  );

  const forbiddenWarning = (row: KeyValue) =>
    !capabilities.canSetAnyHeader && isForbiddenHeader(row.key, row.value) ? (
      <button
        type="button"
        data-testid="forbidden-header-warning"
        data-section="forbidden-headers"
        aria-label={`Browsers don't allow setting ${row.key.trim()}; it will not be sent. Learn more`}
        title={`Browsers don't allow setting "${row.key.trim()}", so it will not be sent. The desktop app can send it. Click to learn more.`}
        onClick={() => openHelp('forbidden-headers')}
        className="inline-flex shrink-0 cursor-pointer items-center rounded-sm text-warn hover:opacity-80"
      >
        <TriangleAlert size={14} aria-hidden />
      </button>
    ) : null;

  return (
    <div className="flex flex-col gap-5 px-3 pt-2 pb-3">
      <KeyValueTable
        label="Headers"
        testId="headers-table"
        rows={headers}
        onChange={setHeaders}
        bulkSeparator=":"
        keyPlaceholder="Add header"
        keyAdornment={forbiddenWarning}
      />
      {literal && moveToSecret && (
        <LiteralSecretHint
          label={literal.header.key.trim()}
          onMove={() => {
            const name = moveToSecret(literal.suggestedName, literal.secret);
            if (!name) return;
            setHeaders(
              headers.map((row, index) =>
                index === literal.index ? { ...row, value: `${literal.prefix}{{${name}}}` } : row,
              ),
            );
          }}
        />
      )}
      <section aria-label="Auto-generated headers" className="text-sm text-fg-muted">
        <SectionLabel role="heading" aria-level={2} className="mb-1.5">
          Auto-generated
        </SectionLabel>
        {automatic.length > 0 && (
          <table aria-label="Auto-generated headers" className="w-full table-fixed">
            <tbody>
              {automatic.map((header) => (
                <tr
                  key={header.name}
                  data-testid="auto-header-row"
                  title={header.reason}
                  className="border-b border-border/60 opacity-75"
                >
                  <td className="w-12" />
                  <td className="px-1.5 py-1 font-mono">{header.name}</td>
                  <td className="truncate px-1.5 py-1 font-mono">{header.value}</td>
                  <td className="w-8" />
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="pt-2 text-xs">
          {capabilities.canSetAnyHeader
            ? 'Host, Content-Length and Accept-Encoding are added when the request is sent. A header you add with the same name replaces an auto-generated one.'
            : 'The browser adds User-Agent, Host, Origin, Content-Length, Accept-Encoding and other headers itself. A header you add with the same name replaces an auto-generated one.'}
          {!capabilities.canSetAnyHeader && (
            <>
              {' '}
              <HelpLink section="forbidden-headers" />
            </>
          )}
        </p>
      </section>
    </div>
  );
}

/** Headers whose value is a credential when typed literally (PIGN-025). */
const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-auth-token',
]);
const SCHEME = /^(Bearer|Basic|Token|Digest|ApiKey)\s+/i;

/**
 * The first enabled credential header with a literal value (no `{{variable}}`): what to move into a
 * secret variable, keeping a scheme prefix like `Bearer `.
 */
export function literalCredential(
  headers: readonly KeyValue[],
):
  | { index: number; header: KeyValue; prefix: string; secret: string; suggestedName: string }
  | undefined {
  for (const [index, header] of headers.entries()) {
    if (header.disabled || !CREDENTIAL_HEADERS.has(header.key.trim().toLowerCase())) continue;
    const value = header.value.trim();
    if (value === '' || value.includes('{{')) continue;
    const prefix = SCHEME.exec(value)?.[0] ?? '';
    const secret = value.slice(prefix.length);
    if (secret === '') continue;
    const scheme = prefix.trim().toLowerCase();
    const suggestedName =
      scheme === 'bearer' || scheme === 'token'
        ? 'token'
        : header.key.trim().toLowerCase().replace(/-/g, '_');
    return { index, header, prefix, secret, suggestedName };
  }
  return undefined;
}
