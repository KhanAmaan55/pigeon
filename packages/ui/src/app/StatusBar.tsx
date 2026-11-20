import { useAppStore } from '../stores/AppStoreProvider';
import { useAppConfig } from './AppConfig';
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
  const openHelp = useAppStore((s) => s.openHelp);
  const { desktopAppUrl } = useAppConfig();

  return (
    <footer
      data-testid="status-bar"
      className="flex h-statusbar shrink-0 items-center gap-3 border-t border-border bg-surface-raised px-3 text-xs text-fg-muted"
    >
      <span data-testid="status-platform">
        {PLATFORM_KIND_LABELS[platform.kind]} · {OS_LABELS[platform.os]}
      </span>
      {platform.capabilities.transport === 'fetch' && (
        <button
          type="button"
          data-testid="status-browser-mode"
          data-section="cors"
          title="The browser decides which requests Pigeon may send and read. Click to learn more."
          onClick={() => openHelp('cors')}
          className="cursor-pointer hover:text-fg"
        >
          Browser mode — CORS applies
        </button>
      )}
      {detection && (
        <span
          data-testid="status-change-detection"
          data-mode={detection}
          title={DETECTION_LABELS[detection].title}
        >
          {DETECTION_LABELS[detection].text}
        </span>
      )}
      {desktopAppUrl && platform.capabilities.transport === 'fetch' && (
        <a
          href={desktopAppUrl}
          target="_blank"
          rel="noreferrer"
          data-testid="status-get-desktop"
          className="ml-auto hover:text-fg"
        >
          Get the desktop app
        </a>
      )}
    </footer>
  );
}
