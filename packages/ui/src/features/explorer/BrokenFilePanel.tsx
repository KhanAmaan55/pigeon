import { AlertTriangle } from 'lucide-react';

/** Shown instead of the editor for a file that failed to load (docs/ui-ux.md §5). */
export function BrokenFilePanel({
  name,
  path,
  message,
}: {
  name: string;
  path: string;
  message: string;
}) {
  return (
    <div
      data-testid="broken-file-panel"
      className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center"
    >
      <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-warn/12 text-warn">
        <AlertTriangle size={20} aria-hidden />
      </div>
      <h2 className="text-base font-semibold text-fg">“{name}” could not be loaded</h2>
      <p className="font-mono text-xs text-fg-muted">{path}</p>
      <p
        data-testid="broken-file-message"
        className="max-w-lg rounded-lg border border-border bg-sunken px-3 py-2 text-sm break-words text-fg"
      >
        {message}
      </p>
      <p className="max-w-lg text-xs text-fg-muted">
        Pigeon never overwrites a file it cannot read. Fix it on disk (e.g. resolve merge conflict
        markers), then refresh.
      </p>
    </div>
  );
}
