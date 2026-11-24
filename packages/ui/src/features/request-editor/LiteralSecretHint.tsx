import { KeyRound } from 'lucide-react';

import { Button, Callout } from '../../components/ui';

/**
 * "This value will be committed. Move it to a secret variable?" (PIGN-025) under a field holding
 * a literal credential.
 */
export function LiteralSecretHint({ label, onMove }: { label: string; onMove: () => void }) {
  return (
    <Callout
      tone="warn"
      role="note"
      data-testid="literal-secret-hint"
      icon={<KeyRound aria-hidden className="mt-1 size-3.5 shrink-0 text-warn" />}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="min-w-0 flex-1">
          The {label} value will be committed. Move it to a secret variable?
        </span>
        <Button size="xs" data-testid="move-to-secret" onClick={onMove}>
          Move to secret variable
        </Button>
      </div>
    </Callout>
  );
}
