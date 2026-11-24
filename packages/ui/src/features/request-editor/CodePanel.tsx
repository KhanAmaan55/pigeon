/**
 * Code tab (PIGN-050): the request as cURL, JavaScript fetch, Python requests or Go. Variables
 * stay as `{{name}}` unless "Resolve variables" is on; secret values and auth credentials are
 * masked unless "Show secrets" is on too.
 */

import { snippetRequest } from '@pigeon/core';
import { SNIPPET_GENERATORS, snippetGenerator } from '@pigeon/formats';
import { Copy, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Callout, Checkbox, Select } from '../../components/ui';
import { useVariableScopes } from '../../components/VariableInput/VariablesContext';
import { CopyButton } from '../response-viewer/CopyButton';
import { useScratchRequest } from './ScratchRequestProvider';

const LANGUAGE_KEY = 'pigeon.snippetLanguage';

function storedLanguage(): string {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    return stored && snippetGenerator(stored) ? stored : 'curl';
  } catch {
    return 'curl';
  }
}

export function CodePanel() {
  const request = useScratchRequest((s) => s.request);
  const inheritedAuth = useScratchRequest((s) => s.inheritedAuth);
  const scopes = useVariableScopes();
  const [language, setLanguage] = useState(storedLanguage);
  const [resolve, setResolve] = useState(false);
  const [reveal, setReveal] = useState(false);

  const { code, warnings, masked } = useMemo(() => {
    const inherited = request.auth ? undefined : inheritedAuth?.().auth;
    const source = snippetRequest(
      request,
      { scopes, ...(inherited ? { inheritedAuth: inherited } : {}) },
      { resolve, revealSecrets: reveal },
    );
    const generator = snippetGenerator(language) ?? SNIPPET_GENERATORS[0]!;
    return {
      code: generator.generate(source.request),
      warnings: source.warnings,
      masked: source.masked,
    };
  }, [request, inheritedAuth, scopes, language, resolve, reveal]);

  return (
    <div
      data-testid="code-panel"
      className="flex h-full min-h-0 flex-col gap-3 px-3 pt-2 pb-3 text-xs"
    >
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <span className="text-fg-muted">Language</span>
          <Select
            size="sm"
            data-testid="code-language"
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value);
              try {
                localStorage.setItem(LANGUAGE_KEY, event.target.value);
              } catch {
                // Not remembered; fine.
              }
            }}
          >
            {SNIPPET_GENERATORS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1.5 text-fg">
          <Checkbox
            data-testid="code-resolve"
            checked={resolve}
            onChange={(event) => setResolve(event.target.checked)}
          />
          Resolve variables
        </label>
        <label className="flex items-center gap-1.5 text-fg">
          <Checkbox
            data-testid="code-reveal"
            checked={reveal}
            onChange={(event) => setReveal(event.target.checked)}
          />
          Show secrets
        </label>
        <CopyButton
          text={code}
          label="Copy code"
          testId="code-copy"
          icon={<Copy size={12} aria-hidden />}
          className="ml-auto"
        >
          Copy
        </CopyButton>
      </div>
      {(warnings.length > 0 || masked) && (
        <Callout tone="neutral" icon={null} className="shrink-0">
          <ul data-testid="code-notes" className="flex flex-col gap-1 text-xs text-fg-muted">
            {masked && (
              <li data-testid="code-masked">
                Secret values are shown as ••••••. Turn on “Show secrets” to include them.
              </li>
            )}
            {warnings.map((warning) => (
              <li key={warning} className="flex gap-1.5">
                <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                {warning}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      <pre
        data-testid="code-snippet"
        aria-label="Code snippet"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-sunken p-3 font-mono text-xs whitespace-pre text-fg"
      >
        {code}
      </pre>
    </div>
  );
}
