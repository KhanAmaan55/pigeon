import { Send } from 'lucide-react';
import { Tabs } from 'radix-ui';
import type { KeyboardEvent, ReactNode } from 'react';

import { usePlatform } from '../../app/PlatformProvider';
import { HeadersTab } from './HeadersTab';
import { methodColorClass } from './methods';
import { ParamsTab } from './ParamsTab';
import { useScratchRequest } from './ScratchRequestProvider';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** URL bar and Params / Headers / Body tabs for the scratch request (docs/ui-ux.md §3.3). */
export function RequestEditor() {
  const method = useScratchRequest((s) => s.request.method);
  const url = useScratchRequest((s) => s.request.url.raw);
  const bodyText = useScratchRequest((s) =>
    s.request.body.mode === 'raw' ? s.request.body.raw : '',
  );
  const sending = useScratchRequest((s) => s.status === 'sending');
  const setMethod = useScratchRequest((s) => s.setMethod);
  const setUrl = useScratchRequest((s) => s.setUrl);
  const setBodyText = useScratchRequest((s) => s.setBodyText);
  const paramCount = useScratchRequest(
    (s) =>
      s.request.url.query.filter((p) => !p.disabled && (p.key !== '' || p.value !== '')).length,
  );
  const headerCount = useScratchRequest(
    (s) => s.request.headers.filter((h) => !h.disabled && h.key.trim() !== '').length,
  );
  const send = useScratchRequest((s) => s.send);
  const shortcut = usePlatform().os === 'macos' ? '⌘↵' : 'Ctrl+Enter';

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div
      data-testid="request-editor"
      className="flex h-full min-h-0 flex-col"
      onKeyDown={onKeyDown}
    >
      <form
        aria-label="Request"
        className="flex shrink-0 items-center gap-2 border-b border-border p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <select
          aria-label="Method"
          data-testid="method-select"
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          className={`h-8 rounded border border-border bg-surface px-2 font-mono text-sm font-semibold ${methodColorClass(method)}`}
        >
          {(METHODS.includes(method) ? METHODS : [method, ...METHODS]).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          aria-label="URL"
          data-testid="url-input"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Enter a URL, e.g. https://api.example.com/users"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          className="h-8 min-w-0 flex-1 rounded border border-border bg-bg px-2 font-mono text-sm text-fg placeholder:text-fg-muted"
        />
        <button
          type="submit"
          data-testid="send-button"
          title={`Send (${shortcut})`}
          className="inline-flex h-8 items-center gap-1.5 rounded bg-accent px-3 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-60"
        >
          <Send size={14} aria-hidden />
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
      <Tabs.Root defaultValue="params" className="flex min-h-0 flex-1 flex-col">
        <Tabs.List
          aria-label="Request sections"
          className="flex shrink-0 gap-1 border-b border-border px-2"
        >
          <TabTrigger value="params" count={paramCount} testId="params-tab">
            Params
          </TabTrigger>
          <TabTrigger value="headers" count={headerCount} testId="headers-tab">
            Headers
          </TabTrigger>
          <TabTrigger value="body" testId="body-tab">
            Body
          </TabTrigger>
        </Tabs.List>
        <Tabs.Content value="params" className="min-h-0 flex-1 overflow-auto">
          <ParamsTab />
        </Tabs.Content>
        <Tabs.Content value="headers" className="min-h-0 flex-1 overflow-auto">
          <HeadersTab />
        </Tabs.Content>
        <Tabs.Content value="body" className="flex min-h-0 flex-1 flex-col">
          <label className="flex min-h-0 flex-1 flex-col gap-1 p-2">
            <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
              Body (raw text)
            </span>
            <textarea
              data-testid="body-input"
              value={bodyText}
              onChange={(event) => setBodyText(event.target.value)}
              placeholder="No body"
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded border border-border bg-bg p-2 font-mono text-sm text-fg placeholder:text-fg-muted"
            />
          </label>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function TabTrigger({
  value,
  count,
  testId,
  children,
}: {
  value: string;
  count?: number;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Tabs.Trigger
      value={value}
      data-testid={testId}
      className="-mb-px inline-flex h-8 items-center gap-1.5 border-b-2 border-transparent px-2 text-sm text-fg-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg"
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          data-testid={`${testId}-count`}
          aria-label={`(${count})`}
          className="rounded-full bg-hover px-1.5 text-xs leading-4 text-fg"
        >
          {count}
        </span>
      )}
    </Tabs.Trigger>
  );
}
