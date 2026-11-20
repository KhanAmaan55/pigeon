import type { ExecutionPreferences } from '@pigeon/core';
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
      void appState
        .set<StoredPreferences>('app', PREFERENCES_KEY, {
          theme: preference,
          ...(execution ? { execution } : {}),
        })
        .catch(() => undefined);
    };
    write();
    return preferences?.subscribe(write);
  }, [appState, preference, preferences]);

  return null;
}
