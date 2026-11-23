/**
 * The in-app **Web limitations** help (PIGN-039): what the browser prevents and what to do
 * instead, mirroring docs/platform.md §6. Every limitation hint links to its section with
 * `HelpLink`; the dialog opens scrolled to it.
 */

import { CircleHelp } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import { useAppConfig } from '../../app/AppConfig';
import { useAppStore } from '../../stores/AppStoreProvider';

export type HelpSectionId =
  | 'cors'
  | 'forbidden-headers'
  | 'response-headers'
  | 'cookies'
  | 'redirects'
  | 'body-with-get'
  | 'mixed-content'
  | 'private-network'
  | 'tls'
  | 'proxy'
  | 'timings'
  | 'storage'
  | 'secrets'
  | 'folders'
  | 'git';

interface HelpSection {
  id: HelpSectionId;
  title: string;
  body: ReactNode;
}

const DESKTOP = 'The desktop app is not limited by this.';

/** The help sections, in reading order. */
export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: 'cors',
    title: 'CORS',
    body: (
      <>
        <p>
          A web page may only read a response from another origin when the server allows it with
          CORS headers (<code>Access-Control-Allow-Origin</code>, and for non-simple requests an
          answer to the <code>OPTIONS</code> preflight allowing the method and headers). Otherwise
          the browser blocks the response and does not say why: Pigeon shows “Blocked by the browser
          (CORS?)”. The same opaque error also comes from a server that is down, a host name that
          does not resolve or an untrusted certificate.
        </p>
        <p>
          What to do: use the desktop app, run the API with CORS enabled for this origin (most dev
          servers have an option), or call it through a proxy you control. {DESKTOP}
        </p>
      </>
    ),
  },
  {
    id: 'forbidden-headers',
    title: 'Headers the browser does not let you set',
    body: (
      <p>
        Browsers drop some request headers: <code>Host</code>, <code>Cookie</code>,{' '}
        <code>Content-Length</code>, <code>Origin</code>, <code>Referer</code>,{' '}
        <code>Connection</code>, <code>Accept-Encoding</code>, <code>Sec-*</code>,{' '}
        <code>Proxy-*</code> and a few more. The header editor marks them with a warning; they are
        not sent. {DESKTOP}
      </p>
    ),
  },
  {
    id: 'response-headers',
    title: 'Hidden response headers',
    body: (
      <p>
        A web page only sees the CORS-safelisted response headers and those the server lists in{' '}
        <code>Access-Control-Expose-Headers</code>; <code>Set-Cookie</code> is never visible. The
        Headers tab says when headers may be missing. {DESKTOP}
      </p>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies',
    body: (
      <p>
        The browser manages cookies for the web app: Pigeon cannot read, set or clear them, so there
        is no cookie jar or cookie manager on the web. A request's Settings tab has “Send browser
        cookies”: the browser then sends and stores its own cookies for that URL, if the server
        allows credentials with CORS; cross-site cookies follow the browser's rules. The desktop app
        keeps a cookie jar per project.
      </p>
    ),
  },
  {
    id: 'redirects',
    title: 'Redirects',
    body: (
      <p>
        Browsers always follow redirects and hide the intermediate responses, so “Follow redirects”
        and “Max redirects” can't be changed and the timeline shows no hops. {DESKTOP}
      </p>
    ),
  },
  {
    id: 'body-with-get',
    title: 'A body with GET or HEAD',
    body: (
      <p>
        <code>fetch()</code> refuses a body on GET and HEAD requests. Use another method (e.g. POST)
        if the API allows it. {DESKTOP}
      </p>
    ),
  },
  {
    id: 'mixed-content',
    title: 'Mixed content (http:// from an https:// page)',
    body: (
      <p>
        A page served over <code>https://</code> may not call plain <code>http://</code> APIs,
        except on <code>localhost</code>. Run Pigeon web locally (<code>http://localhost</code>, see
        the README), call the API over <code>https://</code>, or use the desktop app.
      </p>
    ),
  },
  {
    id: 'private-network',
    title: 'Private Network Access',
    body: (
      <p>
        Chromium-based browsers may block a public page from calling private addresses (
        <code>localhost</code>, <code>192.168.x.x</code>, …) unless the server answers a preflight
        with <code>Access-Control-Allow-Private-Network: true</code>. Browser behaviour here is
        still changing. Running Pigeon web locally, or the desktop app, avoids it.
      </p>
    ),
  },
  {
    id: 'tls',
    title: 'TLS certificates',
    body: (
      <p>
        Browsers always verify certificates: self-signed or expired certificates fail, and “Verify
        TLS certificates” can't be turned off. Trust the certificate in your operating system or
        browser, or use the desktop app.
      </p>
    ),
  },
  {
    id: 'proxy',
    title: 'Proxies',
    body: (
      <p>
        Requests go through the browser's (or system's) proxy settings; Pigeon has no proxy settings
        on the web.
      </p>
    ),
  },
  {
    id: 'timings',
    title: 'Timings and sizes',
    body: (
      <p>
        The web app measures the total time only (detailed timings need{' '}
        <code>Timing-Allow-Origin</code>), and the browser decompresses bodies, so sizes are decoded
        sizes.
      </p>
    ),
  },
  {
    id: 'storage',
    title: 'Storage and eviction',
    body: (
      <p>
        Browser workspaces, drafts, tabs and current values live in this browser's storage
        (IndexedDB) for this site. The browser may delete it under storage pressure unless
        persistent storage was granted (the workspace badge shows it), and clearing site data
        removes it. Export your projects as zip files regularly.
      </p>
    ),
  },
  {
    id: 'secrets',
    title: 'Secrets',
    body: (
      <p>
        Secret current values are stored in this browser profile, <strong>unencrypted</strong>, and
        are readable by any script on this site (Pigeon loads no third-party scripts and uses a
        strict Content Security Policy). They are never written to project files. Don't use
        production credentials on shared machines; the desktop app keeps secrets out of the web
        page.
      </p>
    ),
  },
  {
    id: 'folders',
    title: 'Project folders',
    body: (
      <p>
        Only Chromium-based browsers can open a folder on disk; access may need to be granted again
        after a reload (“Reconnect”), and changes made outside Pigeon are picked up on focus or with
        Refresh, not watched. Firefox and Safari use browser workspaces: import and export them as
        zip files.
      </p>
    ),
  },
  {
    id: 'git',
    title: 'Git',
    body: (
      <p>
        The browser can't run Git. With a project folder inside a Git checkout (Chromium), Save for
        Commit writes the files and you commit with your own Git tools; with a browser workspace,
        export a zip and commit it elsewhere.
      </p>
    ),
  },
];

/** A “Learn more” link to a help section. */
export function HelpLink({
  section,
  children = 'Learn more',
  className = '',
}: {
  section: HelpSectionId;
  children?: ReactNode;
  className?: string;
}) {
  const openHelp = useAppStore((s) => s.openHelp);
  return (
    <button
      type="button"
      data-testid="help-link"
      data-section={section}
      onClick={(event) => {
        event.stopPropagation();
        openHelp(section);
      }}
      className={`inline cursor-pointer text-accent underline-offset-2 hover:underline ${className}`}
    >
      {children}
    </button>
  );
}

/** The help dialog, opened by `openHelp(section)`. */
export function WebLimitationsDialog() {
  const help = useAppStore((s) => s.help);
  const closeHelp = useAppStore((s) => s.closeHelp);
  const { desktopAppUrl } = useAppConfig();
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!help) return;
    // After the dialog has rendered its content.
    const frame = requestAnimationFrame(() => {
      const target = bodyRef.current?.querySelector(`[data-help-section="${help}"]`);
      target?.scrollIntoView?.({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [help]);

  return (
    <Dialog.Root open={help !== null} onOpenChange={(open) => !open && closeHelp()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="web-limitations"
          data-section={help ?? undefined}
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 flex max-h-[85vh] w-[min(40rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface-raised text-sm text-fg shadow-xl"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <CircleHelp size={16} aria-hidden />
            <Dialog.Title className="flex-1 text-base font-semibold">Web limitations</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                data-testid="web-limitations-close"
                className="h-7 rounded border border-border px-2 hover:bg-hover"
              >
                Close
              </button>
            </Dialog.Close>
          </div>
          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="text-fg-muted">
              In the browser, Pigeon sends requests with <code>fetch()</code> and keeps its data in
              the browser's storage, so the browser decides what is possible.
              {desktopAppUrl ? (
                <>
                  {' '}
                  The{' '}
                  <a
                    href={desktopAppUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="help-desktop-link"
                    className="text-accent hover:underline"
                  >
                    desktop app
                  </a>{' '}
                  has none of these limits.
                </>
              ) : (
                ' The desktop app has none of these limits.'
              )}
            </p>
            <nav aria-label="Sections" className="my-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {HELP_SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#help-${section.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    bodyRef.current
                      ?.querySelector(`[data-help-section="${section.id}"]`)
                      ?.scrollIntoView?.({ block: 'start' });
                  }}
                  className="text-accent hover:underline"
                >
                  {section.title}
                </a>
              ))}
            </nav>
            {HELP_SECTIONS.map((section) => (
              <section
                key={section.id}
                id={`help-${section.id}`}
                data-help-section={section.id}
                data-current={help === section.id || undefined}
                aria-labelledby={`help-${section.id}-title`}
                className="flex scroll-mt-2 flex-col gap-1.5 border-t border-border py-3 first-of-type:border-t-0 data-[current]:rounded data-[current]:bg-hover/60 data-[current]:px-2 [&_code]:font-mono [&_code]:text-xs"
              >
                <h3 id={`help-${section.id}-title`} className="font-semibold">
                  {section.title}
                </h3>
                {section.body}
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
