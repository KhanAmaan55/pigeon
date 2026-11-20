import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAppStore } from '../stores/AppStoreProvider';

const VISIBLE_MS = 4000;

/** Background results ("Wrote 3 files"); errors that need action stay inline (docs/ui-ux.md §5). */
export function Toast() {
  const notice = useAppStore((s) => s.notice);
  const [hidden, setHidden] = useState<number | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setHidden(notice.id), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice || hidden === notice.id) return null;
  return (
    <div
      role="status"
      data-testid="toast"
      className="fixed right-4 bottom-10 z-50 flex items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-fg shadow-lg"
    >
      {notice.message}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setHidden(notice.id)}
        className="text-fg-muted hover:text-fg"
      >
        <X size={14} />
      </button>
    </div>
  );
}
