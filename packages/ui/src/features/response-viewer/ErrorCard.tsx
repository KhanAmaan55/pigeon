import type { ExecutionError } from '@pigeon/core';
import { ERROR_TITLES } from '@pigeon/core';

import { Callout } from '../../components/ui';
import { useCapabilities, usePlatform } from '../../app/PlatformProvider';
import { PROXY_START_COMMAND } from '../settings/CorsProxySettings';
import type { HelpSectionId } from '../help/WebLimitations';
import { HelpLink } from '../help/WebLimitations';

/** Web: the Web limitations sections that explain an error kind (PIGN-039). */
const WEB_ERROR_SECTIONS: Partial<
  Record<ExecutionError['kind'], Array<{ id: HelpSectionId; label: string }>>
> = {
  'cors-suspected': [
    { id: 'cors', label: 'Learn more about CORS' },
    { id: 'private-network', label: 'Private Network Access' },
  ],
  'mixed-content': [{ id: 'mixed-content', label: 'Learn more' }],
  tls: [{ id: 'tls', label: 'Learn more' }],
  network: [{ id: 'private-network', label: 'Private Network Access' }],
};

/** Problems with the request itself (fixable in the editor) read as warnings, the rest as failures. */
const WARN_KINDS: ReadonlySet<ExecutionError['kind']> = new Set([
  'invalid-url',
  'invalid-request',
  'file-unavailable',
]);

/**
 * Why a request failed (docs/ui-ux.md §3.5): the kind's title, the message, a hint on what to do
 * next, and the raw transport error folded away. Wording comes from core's `classifyError`, so
 * web and desktop explain failures the same way.
 */
export function ErrorCard({ error }: { error: ExecutionError }) {
  const { transport } = useCapabilities();
  const canProxy = usePlatform().corsProxy !== undefined;
  const sections = transport === 'fetch' ? (WEB_ERROR_SECTIONS[error.kind] ?? []) : [];
  const tone = WARN_KINDS.has(error.kind) ? 'warn' : 'fail';
  return (
    <div className="p-4">
      <Callout tone={tone} role="alert" data-testid="response-error" data-kind={error.kind}>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span
              data-testid="response-error-title"
              className={`font-semibold ${tone === 'warn' ? 'text-warn' : 'text-fail'}`}
            >
              {ERROR_TITLES[error.kind]}
            </span>
            <code
              data-testid="response-error-kind"
              className="ml-auto rounded bg-hover px-1.5 font-mono text-[11px] text-fg-muted"
            >
              {error.kind}
            </code>
          </div>
          <p data-testid="response-error-message" className="text-fg">
            {error.message}
          </p>
          {error.hint && (
            <p data-testid="response-error-hint" className="text-fg-muted">
              {error.hint}
              {sections.map((section, index) => (
                <span key={section.id}>
                  {index === 0 ? ' ' : ' · '}
                  <HelpLink section={section.id}>{section.label}</HelpLink>
                </span>
              ))}
            </p>
          )}
          {canProxy && transport === 'fetch' && error.kind === 'cors-suspected' && (
            <div data-testid="response-error-proxy" className="text-fg-muted">
              <span className="font-semibold text-fg">Use a local proxy:</span> run{' '}
              <code className="rounded bg-hover px-1 font-mono text-xs text-fg">
                {PROXY_START_COMMAND}
              </code>{' '}
              on your machine, then{' '}
              <button
                type="button"
                data-testid="response-error-proxy-settings"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent('pigeon:open-view', { detail: 'settings' }))
                }
                className="text-accent-text underline underline-offset-2 hover:no-underline"
              >
                enter its URL and token in Settings
              </button>
              . Requests then bypass CORS; nothing goes through a hosted service.
            </div>
          )}
          {error.detail && (
            <details data-testid="response-error-detail" className="text-xs text-fg-muted">
              <summary className="cursor-default select-none hover:text-fg">Details</summary>
              <pre className="mt-1.5 rounded bg-sunken p-2 font-mono break-all whitespace-pre-wrap">
                {error.detail}
              </pre>
            </details>
          )}
        </div>
      </Callout>
    </div>
  );
}
