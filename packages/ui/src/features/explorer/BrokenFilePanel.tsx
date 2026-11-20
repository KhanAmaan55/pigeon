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
      className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <AlertTriangle size={28} className="text-warn" aria-hidden />
      <h2 className="text-base font-semibold text-fg">“{name}” could not be loaded</h2>
      <p className="font-mono text-xs text-fg-muted">{path}</p>
      <p data-testid="broken-file-message" className="max-w-lg text-sm break-words text-fg">
        {message}
      </p>
      <p className="max-w-lg text-xs text-fg-muted">
        Pigeon never overwrites a file it cannot read. Fix it on disk (e.g. resolve merge conflict
        markers), then refresh.
      </p>
    </div>
  );
}
