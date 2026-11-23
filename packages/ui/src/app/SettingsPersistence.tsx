import type { ExecutionPreferences } from '@pigeon/core';
import { DEFAULT_VOLATILE_HEADERS } from '@pigeon/core';
import { useEffect, useRef } from 'react';

import { usePlatform } from './PlatformProvider';
import { usePreferencesStore } from './preferences';
import type { ThemePreference } from './theme';
import { useTheme } from './theme';

/** `app` / `preferences` in local app state (docs/file-format.md §6). */
export const PREFERENCES_KEY = 'preferences';

export interface StoredPreferences {
  theme?: ThemePreference;
  execution?: Partial<ExecutionPreferences>;
  /** Only stored once changed from the defaults (so new defaults reach everyone else). */
  volatileHeaders?: string[];
  autoCompare?: boolean;
  recordHistory?: boolean;
}

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/**
 * Loads the theme and request defaults from local app state once, then writes them back on
 * every change (PIGN-018). Renders nothing.
 */
export function SettingsPersistence() {
  const { appState } = usePlatform();
  const { preference, setPreference } = useTheme();
  const preferences = usePreferencesStore();
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void appState
      .get<StoredPreferences>('app', PREFERENCES_KEY)
      .catch(() => undefined)
      .then((stored) => {
        if (cancelled) return;
        if (stored?.theme && THEMES.includes(stored.theme)) setPreference(stored.theme);
        if (stored?.execution && preferences) preferences.getState().setExecution(stored.execution);
        if (typeof stored?.autoCompare === 'boolean' && preferences) {
          preferences.getState().setAutoCompare(stored.autoCompare);
        }
        if (typeof stored?.recordHistory === 'boolean' && preferences) {
          preferences.getState().setRecordHistory(stored.recordHistory);
        }
        if (Array.isArray(stored?.volatileHeaders) && preferences) {
          preferences
            .getState()
            .setVolatileHeaders(stored.volatileHeaders.filter((h) => typeof h === 'string'));
        }
        loaded.current = true;
      });
    return () => {
      cancelled = true;
    };
    // Load once per platform.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState]);

  // Save the theme and request defaults whenever they change (after the initial load).
  useEffect(() => {
    const write = () => {
      if (!loaded.current) return;
      const execution = preferences?.getState().execution;
      const volatileHeaders = preferences?.getState().volatileHeaders;
      const autoCompare = preferences?.getState().autoCompare;
      const recordHistory = preferences?.getState().recordHistory;
      void appState
        .set<StoredPreferences>('app', PREFERENCES_KEY, {
          theme: preference,
          ...(execution ? { execution } : {}),
          ...(autoCompare === false ? { autoCompare } : {}),
          ...(recordHistory === false ? { recordHistory } : {}),
          ...(volatileHeaders && volatileHeaders !== DEFAULT_VOLATILE_HEADERS
            ? { volatileHeaders: [...volatileHeaders] }
            : {}),
        })
        .catch(() => undefined);
    };
    write();
    return preferences?.subscribe(write);
  }, [appState, preference, preferences]);

  return null;
}
