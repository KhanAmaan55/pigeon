import type { ExecutionError } from '@pigeon/core';
import { ERROR_TITLES } from '@pigeon/core';
import { CircleAlert } from 'lucide-react';

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

/**
 * Why a request failed (docs/ui-ux.md §3.5): the kind's title, the message, a hint on what to do
 * next, and the raw transport error folded away. Wording comes from core's `classifyError`, so
 * web and desktop explain failures the same way.
 */
export function ErrorCard({ error }: { error: ExecutionError }) {
  const { transport } = useCapabilities();
  const canProxy = usePlatform().corsProxy !== undefined;
  const sections = transport === 'fetch' ? (WEB_ERROR_SECTIONS[error.kind] ?? []) : [];
  return (
    <div className="p-3">
      <div
        role="alert"
        data-testid="response-error"
        data-kind={error.kind}
        className="flex flex-col gap-1.5 rounded border border-fail/40 bg-bg p-3 text-sm"
      >
        <div className="flex items-center gap-2 font-semibold text-fail">
          <CircleAlert size={16} aria-hidden />
          <span data-testid="response-error-title">{ERROR_TITLES[error.kind]}</span>
          <code
            data-testid="response-error-kind"
            className="ml-auto font-mono text-xs font-normal text-fg-muted"
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
            <code>{PROXY_START_COMMAND}</code> on your machine, then{' '}
            <button
              type="button"
              data-testid="response-error-proxy-settings"
              onClick={() =>
                window.dispatchEvent(new CustomEvent('pigeon:open-view', { detail: 'settings' }))
              }
              className="text-accent underline hover:no-underline"
            >
              enter its URL and token in Settings
            </button>
            . Requests then bypass CORS; nothing goes through a hosted service.
          </div>
        )}
        {error.detail && (
          <details data-testid="response-error-detail" className="text-xs text-fg-muted">
            <summary className="cursor-pointer select-none hover:text-fg">Details</summary>
            <pre className="mt-1 font-mono break-all whitespace-pre-wrap">{error.detail}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
