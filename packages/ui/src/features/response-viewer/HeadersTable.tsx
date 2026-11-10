import { Copy, Info } from 'lucide-react';

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
        <p
          data-testid="response-headers-restricted"
          className="flex shrink-0 items-start gap-1.5 border-b border-border px-3 py-1.5 text-xs text-fg-muted"
        >
          <Info size={12} className="mt-0.5 shrink-0 text-info" aria-hidden />
          Some headers are hidden by the browser: it only shows CORS-safelisted headers, those the
          server lists in Access-Control-Expose-Headers, and never Set-Cookie. The desktop app shows
          all of them.
        </p>
      )}
      {headers.length === 0 ? (
        <p className="p-3 text-sm text-fg-muted">No headers</p>
      ) : (
        <table aria-label="Response headers" className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold text-fg-muted">
              <th className="w-1/3 px-3 py-1">Name</th>
              <th className="px-3 py-1">Value</th>
              <th className="w-10 py-1">
                <span className="sr-only">Copy</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {headers.map(([name, value], index) => (
              <tr
                key={`${index}:${name}`}
                data-testid="response-header-row"
                className="group border-b border-border/60 align-top"
              >
                <td className="px-3 py-1 font-mono break-all text-fg-muted">{name}</td>
                <td className="px-3 py-1 font-mono break-all whitespace-pre-wrap text-fg">
                  {value}
                </td>
                <td className="py-0.5">
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
