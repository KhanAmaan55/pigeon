import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../src/app/theme';
import { TopBar } from '../src/app/TopBar';
import { TooltipProvider } from '../src/components/Tooltip';

/** Controllable `prefers-color-scheme: dark` media query (jsdom has no matchMedia). */
function mockSystemDarkMode(initiallyDark: boolean) {
  let matches = initiallyDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  window.matchMedia = (query: string) =>
    ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    }) as unknown as MediaQueryList;
  return {
    setDark(dark: boolean) {
      matches = dark;
      for (const listener of listeners) listener({ matches: dark } as MediaQueryListEvent);
    },
  };
}

function renderTopBar() {
  return render(
    <ThemeProvider>
      <TooltipProvider>
        <TopBar />
      </TooltipProvider>
    </ThemeProvider>,
  );
}

const appliedTheme = () => document.documentElement.dataset['theme'];

describe('theme', () => {
  beforeEach(() => {
    delete document.documentElement.dataset['theme'];
  });
  afterEach(cleanup);

  it('follows the OS colour scheme by default', () => {
    mockSystemDarkMode(true);
    renderTopBar();
    expect(appliedTheme()).toBe('dark');
  });

  it('tracks OS changes while no explicit choice was made', () => {
    const system = mockSystemDarkMode(false);
    renderTopBar();
    expect(appliedTheme()).toBe('light');

    act(() => system.setDark(true));
    expect(appliedTheme()).toBe('dark');
  });

  it('toggle switches between light and dark and then ignores the OS', async () => {
    const system = mockSystemDarkMode(false);
    renderTopBar();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('theme-toggle'));
    expect(appliedTheme()).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy();

    act(() => system.setDark(false));
    expect(appliedTheme()).toBe('dark');

    await user.click(screen.getByTestId('theme-toggle'));
    expect(appliedTheme()).toBe('light');
  });
});
