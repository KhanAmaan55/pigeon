/**
 * The response's Cookies tab (PIGN-045, desktop): the cookies this response set, as the jar
 * understood them (domain, path, expiry, flags), and a way to the cookie manager.
 */

import type { NormalizedResponse } from '@pigeon/core';
import { parseSetCookie } from '@pigeon/core';
import { useState } from 'react';

import { openCookieManager } from './CookieManager';

export function setCookieHeaders(response: NormalizedResponse): string[] {
  return response.headers
    .filter(([name]) => name.toLowerCase() === 'set-cookie')
    .map(([, value]) => value);
}

export function CookiesTab({ response, url }: { response: NormalizedResponse; url: string }) {
  const headers = setCookieHeaders(response);
  const base = URL.canParse(response.url) ? response.url : url;
  // When the tab first rendered (expiry shown relative to it; render stays pure).
  const [now] = useState(() => Date.now());
  return (
    <div data-testid="cookies-tab" className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 text-xs text-fg-muted">
        <span className="flex-1">
          {headers.length === 0
            ? 'This response set no cookies.'
            : `This response set ${headers.length} cookie${headers.length === 1 ? '' : 's'}; they are in the project's cookie jar.`}
        </span>
        <button
          type="button"
          data-testid="cookies-manage"
          onClick={openCookieManager}
          className="h-7 rounded border border-border px-2 text-fg hover:bg-hover"
        >
          Manage cookies…
        </button>
      </div>
      {headers.length > 0 && (
        <table className="w-full table-fixed text-xs" aria-label="Cookies set by the response">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="w-1/4 px-2 py-1">Name</th>
              <th className="px-2 py-1">Value</th>
              <th className="w-32 px-2 py-1">Domain</th>
              <th className="w-16 px-2 py-1">Path</th>
              <th className="w-40 px-2 py-1">Expires</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((header, index) => {
              const cookie = URL.canParse(base) ? parseSetCookie(header, new URL(base), now) : null;
              return (
                <tr key={index} data-testid="response-cookie" className="border-t border-border/60">
                  {cookie ? (
                    <>
                      <td className="truncate px-2 py-1 font-mono">{cookie.name}</td>
                      <td className="truncate px-2 py-1 font-mono">{cookie.value}</td>
                      <td className="truncate px-2 py-1">{cookie.domain}</td>
                      <td className="truncate px-2 py-1">{cookie.path}</td>
                      <td className="truncate px-2 py-1 text-fg-muted">
                        {cookie.expires === undefined
                          ? 'Session'
                          : cookie.expires <= now
                            ? 'Deleted'
                            : new Date(cookie.expires).toLocaleString()}
                        {cookie.secure ? ' · Secure' : ''}
                        {cookie.httpOnly ? ' · HttpOnly' : ''}
                      </td>
                    </>
                  ) : (
                    <td
                      colSpan={5}
                      className="px-2 py-1 font-mono text-warn"
                      title="Ignored by the cookie jar"
                    >
                      {header} (ignored)
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
