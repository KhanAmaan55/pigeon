/**
 * "Copy JSON Schema" / "Export JSON Schema" of an example (PIGN-056): the response shape Pigeon
 * inferred from the example body, with the request's comparison rules applied
 * (core `exampleJsonSchema`, docs/response-comparison.md §4.7). Shown for JSON examples only.
 */

import type { ProjectSession } from '@pigeon/core';
import { exampleJsonSchema } from '@pigeon/core';
import { Braces, Copy } from 'lucide-react';

import { usePlatform } from '../../app/PlatformProvider';
import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';

export function JsonSchemaActions({
  session,
  exampleId,
  testIdPrefix,
}: {
  session: ProjectSession;
  exampleId: string;
  testIdPrefix: string;
}) {
  const platform = usePlatform();
  const notify = useAppStore((s) => s.notify);
  // Rules and the example change through the session: re-render with it.
  useProjectState((s) => s.model, null);
  const found = session.findExample(exampleId);
  if (!found) return null;
  const { request, example } = found;
  if (example.response.body.kind !== 'text' || example.response.body.format !== 'json') return null;
  const build = () => {
    const result = exampleJsonSchema(session.getWorkingModel(), request, example);
    if (!result.ok) notify(result.message);
    return result.ok ? result : null;
  };
  const copy = async () => {
    const result = build();
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      notify(`Copied the JSON Schema of “${example.name}”.`);
    } catch {
      notify('Copy failed: the clipboard is not available. Use Export instead.');
    }
  };
  const save = async () => {
    const result = build();
    if (!result) return;
    const outcome = await platform.files.saveFile(
      result.fileName,
      result.text,
      'application/schema+json',
    );
    if (outcome === 'saved') notify(`Exported ${result.fileName}.`);
  };
  const button =
    'inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-fg-muted hover:bg-hover hover:text-fg';
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        data-testid={`${testIdPrefix}-schema-copy`}
        title="Copy the JSON Schema (draft 2020-12) of this example’s body, rules applied"
        onClick={() => void copy()}
        className={button}
      >
        <Copy size={12} aria-hidden />
        Copy JSON Schema
      </button>
      <button
        type="button"
        data-testid={`${testIdPrefix}-schema-export`}
        title="Save the JSON Schema (draft 2020-12) of this example’s body, rules applied"
        onClick={() => void save()}
        className={button}
      >
        <Braces size={12} aria-hidden />
        Export JSON Schema
      </button>
    </span>
  );
}
