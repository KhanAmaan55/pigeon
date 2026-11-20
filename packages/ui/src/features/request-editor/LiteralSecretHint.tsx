import { KeyRound } from 'lucide-react';

/**
 * "This value will be committed. Move it to a secret variable?" (PIGN-025) under a field holding
 * a literal credential.
 */
export function LiteralSecretHint({ label, onMove }: { label: string; onMove: () => void }) {
  return (
    <div
      role="note"
      data-testid="literal-secret-hint"
      className="flex flex-wrap items-center gap-2 rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-xs text-fg"
    >
      <KeyRound size={14} className="shrink-0 text-warn" aria-hidden />
      <span className="min-w-0 flex-1">
        The {label} value will be committed. Move it to a secret variable?
      </span>
      <button
        type="button"
        data-testid="move-to-secret"
        onClick={onMove}
        className="rounded border border-border bg-surface px-2 py-0.5 hover:bg-hover"
      >
        Move to secret variable
      </button>
    </div>
  );
}
