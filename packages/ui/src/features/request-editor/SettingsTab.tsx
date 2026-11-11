import type { RequestSettings } from '@pigeon/core';
import type { ReactNode } from 'react';
import { useId } from 'react';

import { useCapabilities } from '../../app/PlatformProvider';
import { formatTimeoutPreference, useExecutionDefaults } from '../../app/preferences';
import { Tooltip } from '../../components/Tooltip';
import { useScratchRequest } from './ScratchRequestProvider';

/** Why a setting is disabled on platforms that can't honour it (docs/platform.md §6.2). */
export const UNSUPPORTED_SETTING_REASONS = {
  redirects:
    'Browsers always follow redirects and hide the hops, so the web app cannot change this. The desktop app can.',
  tls: 'Browsers always verify TLS certificates, so the web app cannot turn this off. The desktop app can.',
  bodyWithGet: "Browsers can't send a body with GET or HEAD; the desktop app can.",
} as const;

/**
 * Per-request settings (`request.settings`, docs/api-execution.md §8). Unset values follow the
 * app preferences; settings the platform can't honour are disabled with an explanation.
 */
export function SettingsTab() {
  const settings = useScratchRequest((s) => s.request.settings);
  const setSettings = useScratchRequest((s) => s.setSettings);
  const { canSendBodyWithGet, canControlRedirects, canDisableTlsVerification } = useCapabilities();
  const defaults = useExecutionDefaults();

  const followRedirects = canControlRedirects
    ? (settings.followRedirects ?? defaults.followRedirects)
    : true;
  const strictSSL = canDisableTlsVerification ? (settings.strictSSL ?? defaults.strictSSL) : true;

  /** Stores `value`, or clears the setting when it equals the default (so defaults still apply). */
  const setOrClear = <K extends keyof RequestSettings>(
    key: K,
    value: RequestSettings[K],
    fallback: RequestSettings[K],
  ) => setSettings({ [key]: value === fallback ? undefined : value });

  return (
    <div data-testid="request-settings" className="flex flex-col gap-4 p-3 text-sm">
      <NumberSetting
        testId="setting-timeout"
        label="Timeout"
        unit="ms"
        description={`How long to wait for the whole response. 0 = no timeout. Empty uses the default (${formatTimeoutPreference(defaults.timeoutMs)}).`}
        value={settings.timeoutMs}
        placeholder={String(defaults.timeoutMs)}
        onChange={(timeoutMs) => setSettings({ timeoutMs })}
      />

      <CheckboxSetting
        testId="setting-follow-redirects"
        label="Follow redirects"
        description="Follow 3xx responses to their Location. Off shows the redirect itself."
        checked={followRedirects}
        unsupported={canControlRedirects ? undefined : UNSUPPORTED_SETTING_REASONS.redirects}
        onChange={(checked) => setOrClear('followRedirects', checked, defaults.followRedirects)}
      />
      <NumberSetting
        testId="setting-max-redirects"
        label="Maximum redirects"
        description="More redirects than this fail with a “too many redirects” error."
        value={canControlRedirects ? settings.maxRedirects : undefined}
        placeholder={String(defaults.maxRedirects)}
        disabled={!followRedirects}
        unsupported={canControlRedirects ? undefined : UNSUPPORTED_SETTING_REASONS.redirects}
        onChange={(maxRedirects) => setSettings({ maxRedirects })}
      />

      <CheckboxSetting
        testId="setting-strict-ssl"
        label="Verify TLS certificates"
        description="Off accepts self-signed, expired and mismatched certificates. Use only for servers you trust."
        checked={strictSSL}
        unsupported={canDisableTlsVerification ? undefined : UNSUPPORTED_SETTING_REASONS.tls}
        onChange={(checked) => setOrClear('strictSSL', checked, defaults.strictSSL)}
      />

      <CheckboxSetting
        testId="setting-send-body-with-get"
        label="Send body with GET"
        description="GET and HEAD requests are sent without a body unless this is on."
        checked={canSendBodyWithGet && settings.disableBodyPruning === true}
        unsupported={canSendBodyWithGet ? undefined : UNSUPPORTED_SETTING_REASONS.bodyWithGet}
        onChange={(checked) => setSettings({ disableBodyPruning: checked ? true : undefined })}
      />
    </div>
  );
}

/** Wraps a setting that the platform can't honour in a tooltip explaining why. */
function Unsupported({ reason, children }: { reason: string | undefined; children: ReactNode }) {
  if (reason === undefined) return <>{children}</>;
  return (
    <Tooltip content={<span data-testid="setting-unsupported-tooltip">{reason}</span>} side="top">
      {/* Disabled inputs get no pointer events, so the tooltip hangs off a wrapper. */}
      <div tabIndex={0} data-unsupported="true" className="rounded opacity-60 outline-none">
        {children}
      </div>
    </Tooltip>
  );
}

function CheckboxSetting({
  testId,
  label,
  description,
  checked,
  unsupported,
  onChange,
}: {
  testId: string;
  label: string;
  description: string;
  checked: boolean;
  unsupported: string | undefined;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Unsupported reason={unsupported}>
      <label data-testid={`${testId}-row`} className="flex items-start gap-2">
        <input
          type="checkbox"
          data-testid={testId}
          checked={checked}
          disabled={unsupported !== undefined}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 size-3.5 accent-accent"
        />
        <span className="flex flex-col">
          <span className="text-fg">{label}</span>
          <span className="text-xs text-fg-muted">{unsupported ?? description}</span>
        </span>
      </label>
    </Unsupported>
  );
}

function NumberSetting({
  testId,
  label,
  unit,
  description,
  value,
  placeholder,
  disabled = false,
  unsupported,
  onChange,
}: {
  testId: string;
  label: string;
  unit?: string;
  description: string;
  value: number | undefined;
  placeholder: string;
  disabled?: boolean;
  unsupported?: string | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const id = useId();
  return (
    <Unsupported reason={unsupported}>
      <div data-testid={`${testId}-row`} className="flex flex-col gap-1">
        <label htmlFor={id} className="text-fg">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            data-testid={testId}
            value={value ?? ''}
            placeholder={placeholder}
            disabled={disabled || unsupported !== undefined}
            onChange={(event) => onChange(parseNonNegativeInt(event.target.value))}
            className="h-7 w-32 rounded border border-border bg-bg px-2 font-mono text-sm text-fg placeholder:text-fg-muted disabled:opacity-60"
          />
          {unit && <span className="text-xs text-fg-muted">{unit}</span>}
        </div>
        <span className="text-xs text-fg-muted">{unsupported ?? description}</span>
      </div>
    </Unsupported>
  );
}

/** `''` (or anything invalid) → `undefined`, i.e. back to the default. */
export function parseNonNegativeInt(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}
