/**
 * The cookie manager (PIGN-045): the open project's cookie jar by domain, with add, edit,
 * delete and clear. Desktop only; in browsers the browser keeps cookies itself, so the dialog
 * explains that instead. Opened from the command palette or the response's Cookies tab.
 */

import type { StoredCookie } from '@pigeon/core';
import { Trash2 } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useId, useReducer, useState } from 'react';

import { useCapabilities } from '../../app/PlatformProvider';
import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';
import { useCommand } from '../command-palette/CommandsProvider';
import { HelpLink } from '../help/WebLimitations';

/** Opens the manager from anywhere (palette, Cookies tab). */
export const OPEN_COOKIES_EVENT = 'pigeon:open-cookies';

export function openCookieManager(): void {
  window.dispatchEvent(new Event(OPEN_COOKIES_EVENT));
}

export function CookieManager() {
  const [open, setOpen] = useState(false);
  const hasProject = useAppStore((s) => s.project !== null);
  useCommand('cookies.manage', hasProject ? () => setOpen(true) : undefined);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_COOKIES_EVENT, show);
    return () => window.removeEventListener(OPEN_COOKIES_EVENT, show);
  }, []);
  return (
    <Dialog.Root open={open && hasProject} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="cookie-manager"
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 flex max-h-[80vh] w-[min(44rem,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface-raised text-sm text-fg shadow-xl"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Dialog.Title className="flex-1 text-base font-semibold">Cookies</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="h-7 rounded border border-border px-2 hover:bg-hover"
              >
                Close
              </button>
            </Dialog.Close>
          </div>
          {open && <ManagerBody />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const EMPTY: StoredCookie = {
  name: '',
  value: '',
  domain: '',
  hostOnly: true,
  path: '/',
  secure: false,
  httpOnly: false,
  createdAt: 0,
};

function ManagerBody() {
  const project = useAppStore((s) => s.project);
  const { canReadAllResponseHeaders } = useCapabilities();
  // Re-render after jar changes (a send stores cookies → the session emits).
  useProjectState((s) => s.changes, null);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [editing, setEditing] = useState<StoredCookie | null>(null);
  if (!project) return null;
  if (!canReadAllResponseHeaders) {
    return (
      <p data-testid="cookie-manager-web" className="p-4 text-fg-muted">
        In the browser, cookies belong to the browser: Pigeon can't read, set or clear them. Turn on
        “Send browser cookies” in a request's Settings tab to let the browser use its own cookies
        for that request. <HelpLink section="cookies" />
      </p>
    );
  }
  const { session } = project;
  const jar = session.cookieJar;
  const cookies = jar.list();
  const domains = [...new Set(cookies.map((c) => c.domain))];
  const save = () => {
    session.saveCookies();
    refresh();
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-fg-muted">
        <span className="flex-1">
          {cookies.length} cookie{cookies.length === 1 ? '' : 's'} for “{session.name}” (this
          machine only, never in project files)
        </span>
        <button
          type="button"
          data-testid="cookie-add"
          onClick={() => setEditing({ ...EMPTY, createdAt: Date.now() })}
          className="h-7 rounded border border-border px-2 text-fg hover:bg-hover"
        >
          Add cookie
        </button>
        <button
          type="button"
          data-testid="cookie-clear-all"
          disabled={cookies.length === 0}
          onClick={() => {
            jar.clear();
            save();
          }}
          className="h-7 rounded border border-fail/50 px-2 text-fail hover:bg-fail/10 disabled:opacity-50"
        >
          Clear all
        </button>
      </div>
      {editing && (
        <CookieForm
          cookie={editing}
          onCancel={() => setEditing(null)}
          onSave={(next) => {
            if (
              editing.name &&
              (editing.name !== next.name ||
                editing.domain !== next.domain ||
                editing.path !== next.path)
            ) {
              jar.remove(editing);
            }
            jar.set(next);
            setEditing(null);
            save();
          }}
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {cookies.length === 0 && <p className="p-2 text-fg-muted">No cookies yet.</p>}
        {domains.map((domain) => (
          <section key={domain} aria-label={domain} data-testid="cookie-domain" className="mb-2">
            <h3 className="flex items-center gap-2 px-2 py-1 text-xs font-semibold">
              <span className="flex-1">{domain}</span>
              <button
                type="button"
                onClick={() => {
                  jar.clear(domain);
                  save();
                }}
                className="rounded px-1 font-normal text-fg-muted hover:bg-hover hover:text-fg"
              >
                Clear
              </button>
            </h3>
            <table className="w-full table-fixed text-xs" aria-label={`Cookies for ${domain}`}>
              <tbody>
                {cookies
                  .filter((c) => c.domain === domain)
                  .map((cookie) => (
                    <tr
                      key={`${cookie.name}|${cookie.path}`}
                      data-testid="cookie-row"
                      className="border-t border-border/60"
                    >
                      <td className="w-1/4 truncate px-2 py-1 font-mono">{cookie.name}</td>
                      <td className="truncate px-2 py-1 font-mono">{cookie.value}</td>
                      <td className="w-20 truncate px-2 py-1 text-fg-muted">{cookie.path}</td>
                      <td className="w-40 truncate px-2 py-1 text-fg-muted">
                        {cookie.expires === undefined
                          ? 'Session'
                          : new Date(cookie.expires).toLocaleString()}
                        {cookie.secure ? ' · Secure' : ''}
                        {cookie.httpOnly ? ' · HttpOnly' : ''}
                      </td>
                      <td className="w-24 px-2 py-1 text-right">
                        <button
                          type="button"
                          data-testid="cookie-edit"
                          onClick={() => setEditing(cookie)}
                          className="rounded px-1 hover:bg-hover"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${cookie.name}`}
                          data-testid="cookie-delete"
                          onClick={() => {
                            jar.remove(cookie);
                            save();
                          }}
                          className="rounded p-1 align-middle text-fg-muted hover:bg-hover hover:text-fail"
                        >
                          <Trash2 size={12} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}

function CookieForm({
  cookie,
  onSave,
  onCancel,
}: {
  cookie: StoredCookie;
  onSave: (cookie: StoredCookie) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(cookie);
  const valid =
    draft.name.trim() !== '' && draft.domain.trim() !== '' && draft.path.startsWith('/');
  const field = (key: 'name' | 'value' | 'domain' | 'path', label: string) => (
    <label htmlFor={`${id}-${key}`} className="flex flex-col gap-0.5">
      <span className="text-xs text-fg-muted">{label}</span>
      <input
        id={`${id}-${key}`}
        data-testid={`cookie-${key}`}
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        className="h-7 rounded border border-border bg-bg px-2 font-mono text-xs"
      />
    </label>
  );
  return (
    <form
      data-testid="cookie-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onSave({
          ...draft,
          name: draft.name.trim(),
          domain: draft.domain.trim().toLowerCase().replace(/^\./, ''),
        });
      }}
      className="grid grid-cols-2 gap-2 border-b border-border px-4 py-3"
    >
      {field('name', 'Name')}
      {field('value', 'Value')}
      {field('domain', 'Domain (e.g. api.example.com)')}
      {field('path', 'Path')}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={!draft.hostOnly}
          onChange={(event) => setDraft({ ...draft, hostOnly: !event.target.checked })}
        />
        Also send to subdomains
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={draft.secure}
          onChange={(event) => setDraft({ ...draft, secure: event.target.checked })}
        />
        Secure (https only)
      </label>
      <div className="col-span-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-7 rounded border border-border px-2 hover:bg-hover"
        >
          Cancel
        </button>
        <button
          type="submit"
          data-testid="cookie-save"
          disabled={!valid}
          className="h-7 rounded bg-accent px-3 font-semibold text-accent-fg disabled:opacity-50"
        >
          Save cookie
        </button>
      </div>
    </form>
  );
}
