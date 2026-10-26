import { OS_LABELS, PLATFORM_KIND_LABELS } from './platformLabels';
import { usePlatform } from './PlatformProvider';

/** Platform on the left; transport and project status arrive with later stories. */
export function StatusBar() {
  const platform = usePlatform();

  return (
    <footer
      data-testid="status-bar"
      className="flex h-statusbar shrink-0 items-center gap-3 border-t border-border bg-surface-raised px-3 text-xs text-fg-muted"
    >
      <span data-testid="status-platform">
        {PLATFORM_KIND_LABELS[platform.kind]} · {OS_LABELS[platform.os]}
      </span>
    </footer>
  );
}
