import { useAppStore } from '../stores/AppStoreProvider';
import { OS_LABELS, PLATFORM_KIND_LABELS } from './platformLabels';
import { usePlatform } from './PlatformProvider';

const DETECTION_LABELS = {
  watching: {
    text: 'Watching files',
    title: 'Changes made outside Pigeon are picked up automatically.',
  },
  focus: {
    text: 'Refresh on focus',
    title:
      'Changes made outside Pigeon are picked up when this window gets focus, or with Refresh.',
  },
  'watch-failed': {
    text: 'File watching unavailable',
    title:
      'The file watcher could not start (e.g. inotify limits). Changes are picked up when this window gets focus, or with Refresh.',
  },
} as const;

/** Platform on the left; transport and project status arrive with later stories. */
export function StatusBar() {
  const platform = usePlatform();
  const detection = useAppStore((s) => s.project?.changeDetection);

  return (
    <footer
      data-testid="status-bar"
      className="flex h-statusbar shrink-0 items-center gap-3 border-t border-border bg-surface-raised px-3 text-xs text-fg-muted"
    >
      <span data-testid="status-platform">
        {PLATFORM_KIND_LABELS[platform.kind]} · {OS_LABELS[platform.os]}
      </span>
      {detection && (
        <span
          data-testid="status-change-detection"
          data-mode={detection}
          title={DETECTION_LABELS[detection].title}
        >
          {DETECTION_LABELS[detection].text}
        </span>
      )}
    </footer>
  );
}
