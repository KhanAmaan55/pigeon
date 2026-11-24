/**
 * The cookie manager (PIGN-045): the open project's cookie jar by domain, with add, edit,
 * delete and clear. Desktop only; in browsers the browser keeps cookies itself, so the dialog
 * explains that instead. Opened from the command palette or the response's Cookies tab.
 */

import type { StoredCookie } from '@pigeon/core';
import { Trash2 } from 'lucide-react';
import { useEffect, useId, useReducer, useState } from 'react';

import { useCapabilities } from '../../app/PlatformProvider';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  EmptyState,
  Input,
} from '../../components/ui';
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
    <Dialog open={open && hasProject} onOpenChange={setOpen}>
      <DialogContent width="lg" flush data-testid="cookie-manager" aria-describedby={undefined}>
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <DialogTitle className="flex-1">Cookies</DialogTitle>
          <DialogClose asChild>
            <Button size="sm">Close</Button>
          </DialogClose>
        </div>
        {open && <ManagerBody />}
      </DialogContent>
    </Dialog>
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
      <p data-testid="cookie-manager-web" className="px-5 py-4 text-fg-muted">
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
      <div className="flex items-center gap-2 border-b border-border px-5 py-2.5 text-xs text-fg-muted">
        <span className="flex-1">
          {cookies.length} cookie{cookies.length === 1 ? '' : 's'} for “{session.name}” (this
          machine only, never in project files)
        </span>
        <Button
          size="sm"
          data-testid="cookie-add"
          onClick={() => setEditing({ ...EMPTY, createdAt: Date.now() })}
        >
          Add cookie
        </Button>
        <Button
          size="sm"
          variant="danger"
          data-testid="cookie-clear-all"
          disabled={cookies.length === 0}
          onClick={() => {
            jar.clear();
            save();
          }}
        >
          Clear all
        </Button>
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
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {cookies.length === 0 && <EmptyState title="No cookies yet." />}
        {domains.map((domain) => (
          <section key={domain} aria-label={domain} data-testid="cookie-domain" className="mb-3">
            <h3 className="flex items-center gap-2 px-2 py-1 text-xs font-semibold">
              <span className="flex-1">{domain}</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  jar.clear(domain);
                  save();
                }}
              >
                Clear
              </Button>
            </h3>
            <table className="w-full table-fixed text-xs" aria-label={`Cookies for ${domain}`}>
              <tbody>
                {cookies
                  .filter((c) => c.domain === domain)
                  .map((cookie) => (
                    <tr
                      key={`${cookie.name}|${cookie.path}`}
                      data-testid="cookie-row"
                      className="group border-t border-border/50 transition-colors hover:bg-hover/40"
                    >
                      <td className="w-1/4 truncate px-2 py-1.5 font-mono">{cookie.name}</td>
                      <td className="truncate px-2 py-1.5 font-mono">{cookie.value}</td>
                      <td className="w-20 truncate px-2 py-1.5 text-fg-muted">{cookie.path}</td>
                      <td className="w-40 truncate px-2 py-1.5 text-fg-muted">
                        {cookie.expires === undefined
                          ? 'Session'
                          : new Date(cookie.expires).toLocaleString()}
                        {cookie.secure ? ' · Secure' : ''}
                        {cookie.httpOnly ? ' · HttpOnly' : ''}
                      </td>
                      <td className="w-24 px-2 py-1 text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          data-testid="cookie-edit"
                          onClick={() => setEditing(cookie)}
                        >
                          Edit
                        </Button>
                        <button
                          type="button"
                          aria-label={`Delete ${cookie.name}`}
                          data-testid="cookie-delete"
                          onClick={() => {
                            jar.remove(cookie);
                            save();
                          }}
                          className="inline-flex size-6 items-center justify-center rounded align-middle text-fg-muted transition-colors hover:bg-fail/10 hover:text-fail"
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
    <label htmlFor={`${id}-${key}`} className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <Input
        size="sm"
        mono
        id={`${id}-${key}`}
        data-testid={`cookie-${key}`}
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
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
      className="grid grid-cols-2 gap-3 border-b border-border bg-sunken/60 px-5 py-4"
    >
      {field('name', 'Name')}
      {field('value', 'Value')}
      {field('domain', 'Domain (e.g. api.example.com)')}
      {field('path', 'Path')}
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={!draft.hostOnly}
          onChange={(event) => setDraft({ ...draft, hostOnly: !event.target.checked })}
        />
        Also send to subdomains
      </label>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={draft.secure}
          onChange={(event) => setDraft({ ...draft, secure: event.target.checked })}
        />
        Secure (https only)
      </label>
      <div className="col-span-2 flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          data-testid="cookie-save"
          disabled={!valid}
        >
          Save cookie
        </Button>
      </div>
    </form>
  );
}
