import type { ProjectExample } from '@pigeon/core';
import { Bookmark, Trash2 } from 'lucide-react';

import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';
import { baselineExampleId } from '../explorer/tree';

/** Status colour of an example's code, like the response status line. */
export function statusClass(code: number): string {
  if (code >= 500) return 'text-fail';
  if (code >= 400) return 'text-warn';
  if (code >= 200 && code < 300) return 'text-pass';
  return 'text-fg-muted';
}

/** The examples of a project request, from the working model. */
export function useRequestExamples(requestId: string): readonly ProjectExample[] {
  const session = useAppStore((s) => s.project?.session);
  // Re-render on model changes.
  useProjectState((s) => s.model, null);
  return session?.findRequest(requestId)?.examples ?? [];
}

/** Response panel → Examples (docs/ui-ux.md §3.5): this request's examples; open or delete. */
export function ExamplesTab({ requestId }: { requestId: string }) {
  const project = useAppStore((s) => s.project);
  const examples = useRequestExamples(requestId);
  const readOnly = useProjectState((s) => s.readOnly, false);
  const lastBaseline = useProjectState((s) => s.comparisons[requestId]?.exampleId, undefined);
  const session = useAppStore((s) => s.project?.session);
  const baselineId = baselineExampleId(
    {
      id: requestId,
      examples,
      comparison: session?.findRequest(requestId)?.comparison,
    },
    lastBaseline ? { [requestId]: lastBaseline } : undefined,
  );
  if (!project) return null;
  if (examples.length === 0) {
    return (
      <p data-testid="examples-empty" className="p-3 text-sm text-fg-muted">
        No examples yet. Use “Save as example” to keep this response.
      </p>
    );
  }
  return (
    <ul data-testid="examples-list" className="min-h-0 flex-1 overflow-auto py-1 text-sm">
      {examples.map((example) => (
        <li
          key={example.id}
          data-testid="examples-list-item"
          className="group flex items-center gap-2 px-3 py-1 hover:bg-hover"
        >
          <Bookmark size={12} className="shrink-0 text-fg-muted" aria-hidden />
          {example.id === baselineId && (
            <span
              data-testid="examples-baseline"
              title="Baseline"
              aria-label="(baseline)"
              className="text-warn"
            >
              ★
            </span>
          )}
          <button
            type="button"
            data-testid="examples-open"
            onClick={() => project.store.getState().openTab(example.id, { pin: true })}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span
              className={`shrink-0 font-mono text-xs font-bold ${statusClass(example.response.code)}`}
            >
              {example.response.code}
            </span>
            <span className="truncate">{example.name}</span>
          </button>
          {!readOnly && (
            <button
              type="button"
              data-testid="examples-delete"
              aria-label={`Delete example ${example.name}`}
              title="Delete example"
              onClick={() => project.session.apply({ type: 'deleteExample', id: example.id })}
              className="invisible rounded p-0.5 text-fg-muted group-hover:visible hover:bg-hover hover:text-fg focus:visible"
            >
              <Trash2 size={12} aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
