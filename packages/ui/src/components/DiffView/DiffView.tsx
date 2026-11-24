import { diffLines, withContext } from './diff';

/** Unified diff of two texts (current file vs to-be-written), with context. */
export function DiffView({
  before,
  after,
  testId = 'diff-view',
}: {
  before: string;
  after: string;
  testId?: string;
}) {
  const lines = withContext(diffLines(before, after));
  if (lines.length === 0) return <p className="px-3 py-2 text-xs text-fg-muted">No changes.</p>;
  return (
    <pre data-testid={testId} className="overflow-x-auto py-1 font-mono text-xs leading-5">
      {lines.map((line, index) =>
        line === null ? (
          <div key={index} className="px-3 text-fg-muted select-none">
            ⋯
          </div>
        ) : (
          <div
            key={index}
            data-kind={line.kind}
            className={`flex gap-2 px-3 ${
              line.kind === 'add'
                ? 'bg-pass/10 text-fg'
                : line.kind === 'remove'
                  ? 'bg-fail/10 text-fg'
                  : 'text-fg-muted'
            }`}
          >
            <span
              className={`w-3 shrink-0 select-none ${
                line.kind === 'add' ? 'text-pass' : line.kind === 'remove' ? 'text-fail' : ''
              }`}
              aria-hidden
            >
              {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
            </span>
            <span className="whitespace-pre">{line.text}</span>
          </div>
        ),
      )}
    </pre>
  );
}
