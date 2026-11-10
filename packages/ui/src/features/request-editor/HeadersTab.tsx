import type { KeyValue } from '@pigeon/core';
import { autoHeaders } from '@pigeon/core';
import { isForbiddenHeader } from '@pigeon/platform';
import { TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';

import { useCapabilities } from '../../app/PlatformProvider';
import { KeyValueTable } from '../../components/KeyValueTable';
import { useScratchRequest } from './ScratchRequestProvider';

/**
 * Request headers, the headers Pigeon adds (read-only, greyed) and, where the transport can't set
 * every header (browsers), a warning on the ones that won't be sent.
 */
export function HeadersTab() {
  const headers = useScratchRequest((s) => s.request.headers);
  const body = useScratchRequest((s) => s.request.body);
  const setHeaders = useScratchRequest((s) => s.setHeaders);
  const capabilities = useCapabilities();
  const automatic = useMemo(
    () => autoHeaders({ headers, body }, capabilities),
    [headers, body, capabilities],
  );

  const forbiddenWarning = (row: KeyValue) =>
    !capabilities.canSetAnyHeader && isForbiddenHeader(row.key, row.value) ? (
      <span
        role="img"
        data-testid="forbidden-header-warning"
        aria-label={`Browsers don't allow setting ${row.key.trim()}; it will not be sent`}
        title={`Browsers don't allow setting "${row.key.trim()}", so it will not be sent. The desktop app can send it.`}
        className="shrink-0 text-warn"
      >
        <TriangleAlert size={14} aria-hidden />
      </span>
    ) : null;

  return (
    <div className="flex flex-col gap-4 p-2">
      <KeyValueTable
        label="Headers"
        testId="headers-table"
        rows={headers}
        onChange={setHeaders}
        bulkSeparator=":"
        keyPlaceholder="Add header"
        keyAdornment={forbiddenWarning}
      />
      <section aria-label="Auto-generated headers" className="text-sm text-fg-muted">
        <h3 className="pb-1 text-xs font-semibold tracking-wide uppercase">Auto-generated</h3>
        {automatic.length > 0 && (
          <table aria-label="Auto-generated headers" className="w-full table-fixed">
            <tbody>
              {automatic.map((header) => (
                <tr
                  key={header.name}
                  data-testid="auto-header-row"
                  title={header.reason}
                  className="border-b border-border/60 opacity-70"
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
        <p className="pt-1 text-xs">
          {capabilities.canSetAnyHeader
            ? 'Host, Content-Length and Accept-Encoding are added when the request is sent. A header you add with the same name replaces an auto-generated one.'
            : 'The browser adds User-Agent, Host, Origin, Content-Length, Accept-Encoding and other headers itself. A header you add with the same name replaces an auto-generated one.'}
        </p>
      </section>
    </div>
  );
}
