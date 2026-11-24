import { Copy } from 'lucide-react';

import { Callout, EmptyState } from '../../components/ui';
import { HelpLink } from '../help/WebLimitations';
import { CopyButton } from './CopyButton';

/** Response headers in received order, duplicates kept (docs/ui-ux.md §3.5). */
export function HeadersTable({
  headers,
  restricted,
}: {
  headers: Array<[string, string]>;
  restricted: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {restricted && (
        <Callout
          tone="info"
          data-testid="response-headers-restricted"
          className="mx-4 mt-3 mb-1 shrink-0"
        >
          Some headers are hidden by the browser: it only shows CORS-safelisted headers, those the
          server lists in Access-Control-Expose-Headers, and never Set-Cookie. The desktop app shows
          all of them. <HelpLink section="response-headers" />
        </Callout>
      )}
      {headers.length === 0 ? (
        <EmptyState title="No headers" />
      ) : (
        <table aria-label="Response headers" className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-fg-muted">
              <th className="w-1/3 px-4 py-1.5 font-medium">Name</th>
              <th className="px-4 py-1.5 font-medium">Value</th>
              <th className="w-10 py-1.5">
                <span className="sr-only">Copy</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {headers.map(([name, value], index) => (
              <tr
                key={`${index}:${name}`}
                data-testid="response-header-row"
                className="group border-b border-border/60 align-top transition-colors hover:bg-hover/50"
              >
                <td className="px-4 py-1.5 font-mono break-all text-fg-muted">{name}</td>
                <td className="px-4 py-1.5 font-mono break-all whitespace-pre-wrap text-fg">
                  {value}
                </td>
                <td className="py-1">
                  <CopyButton
                    text={`${name}: ${value}`}
                    label={`Copy header ${name}`}
                    icon={<Copy size={12} aria-hidden />}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
