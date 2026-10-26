import { createMemoryPlatform } from '@pigeon/platform';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformProvider, useCapabilities, usePlatform } from '../src/app/PlatformProvider';
import { Sidebar } from '../src/app/Sidebar';
import { StatusBar } from '../src/app/StatusBar';
import { Diagnostics } from '../src/features/settings/Diagnostics';

afterEach(cleanup);

describe('PlatformProvider', () => {
  it('provides the platform and its capabilities', () => {
    const platform = createMemoryPlatform({ capabilities: { bypassesCors: false } });
    const { result } = renderHook(
      () => ({ platform: usePlatform(), capabilities: useCapabilities() }),
      {
        wrapper: ({ children }) => (
          <PlatformProvider platform={platform}>{children}</PlatformProvider>
        ),
      },
    );
    expect(result.current.platform).toBe(platform);
    expect(result.current.capabilities.bypassesCors).toBe(false);
  });

  it('fails loudly without a provider', () => {
    expect(() => renderHook(() => usePlatform())).toThrow('inside <PlatformProvider>');
  });
});

describe('Diagnostics', () => {
  it('lists the platform kind, OS and every capability', () => {
    const platform = createMemoryPlatform({
      os: 'windows',
      capabilities: { projectFolders: 'none' },
    });
    render(
      <PlatformProvider platform={platform}>
        <Diagnostics />
      </PlatformProvider>,
    );

    expect(screen.getByTestId('diagnostics-kind').textContent).toBe('Memory (test)');
    expect(screen.getByTestId('diagnostics-os').textContent).toBe('Windows');
    for (const [name, value] of Object.entries(platform.capabilities)) {
      expect(screen.getByTestId(`capability-${name}`).textContent).toBe(String(value));
    }
    expect(screen.getByTestId('capability-projectFolders').textContent).toBe('none');
  });

  it('is the Settings sidebar view, and the status bar names the platform', () => {
    const platform = createMemoryPlatform({ os: 'macos' });
    render(
      <PlatformProvider platform={platform}>
        <Sidebar view="settings" />
        <StatusBar />
      </PlatformProvider>,
    );

    expect(screen.getByTestId('status-platform').textContent).toBe('Memory (test) · macOS');
    expect(screen.getByTestId('capability-bypassesCors').textContent).toBe('true');
  });
});
