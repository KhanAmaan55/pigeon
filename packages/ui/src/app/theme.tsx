import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  /** Switches to the opposite of the currently resolved theme (an explicit choice). */
  toggle: () => void;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readSystemTheme(): ResolvedTheme {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
    ? 'dark'
    : 'light';
}

/**
 * Resolves the theme from the user's preference and the OS colour scheme, and applies it as
 * `data-theme` on `<html>` (the design tokens key off that attribute).
 * The preference is in memory only until local state persistence lands (PIGN-018).
 */
export function ThemeProvider({
  children,
  initialPreference = 'system',
}: {
  children: ReactNode;
  initialPreference?: ThemePreference;
}) {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(readSystemTheme);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) =>
      setSystemTheme(event.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = preference === 'system' ? systemTheme : preference;

  useLayoutEffect(() => {
    document.documentElement.dataset['theme'] = resolved;
  }, [resolved]);

  const toggle = useCallback(() => {
    setPreference(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}
