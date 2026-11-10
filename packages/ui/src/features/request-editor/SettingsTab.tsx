import { useCapabilities } from '../../app/PlatformProvider';
import { useScratchRequest } from './ScratchRequestProvider';

/** Per-request settings (`request.settings`); more join with PIGN-011. */
export function SettingsTab() {
  const sendBodyWithGet = useScratchRequest((s) => s.request.settings.disableBodyPruning === true);
  const setSettings = useScratchRequest((s) => s.setSettings);
  const { canSendBodyWithGet } = useCapabilities();

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <label
        className={`flex items-start gap-2 ${canSendBodyWithGet ? '' : 'opacity-60'}`}
        title={canSendBodyWithGet ? undefined : "Browsers can't send a body with GET or HEAD."}
      >
        <input
          type="checkbox"
          data-testid="setting-send-body-with-get"
          checked={canSendBodyWithGet && sendBodyWithGet}
          disabled={!canSendBodyWithGet}
          onChange={(event) =>
            setSettings({ disableBodyPruning: event.target.checked ? true : undefined })
          }
          className="mt-0.5 size-3.5 accent-accent"
        />
        <span className="flex flex-col">
          <span className="text-fg">Send body with GET</span>
          <span className="text-xs text-fg-muted">
            {canSendBodyWithGet
              ? 'GET and HEAD requests are sent without a body unless this is on.'
              : "Browsers can't send a body with GET or HEAD; the desktop app can."}
          </span>
        </span>
      </label>
    </div>
  );
}
