import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Platform } from '@pigeon/platform';
import { createMemoryPlatform, MemoryFs, MemoryGitStatus } from '@pigeon/platform';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PigeonApp } from '../src/app/PigeonApp';
import { gitStateOfRow } from '../src/features/git/git-status';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: false,
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fixtureDirectory = join(import.meta.dirname, '../../fixtures/projects/basic');

async function copyInto(fs: MemoryFs, local: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await copyInto(fs, join(local, entry.name), path);
    else await fs.writeFileAtomic(path, new Uint8Array(await readFile(join(local, entry.name))));
  }
}

async function openWithGit(git: MemoryGitStatus | undefined, gitStatus = true) {
  const base = createMemoryPlatform({ os: 'macos', capabilities: { gitStatus } });
  const platform: Platform = git ? Object.assign(base, { git }) : base;
  const fs = new MemoryFs();
  await copyInto(fs, fixtureDirectory);
  base.projects.pickResult = base.projects.add(fs);
  render(<PigeonApp platform={platform} />);
  const user = userEvent.setup();
  await user.click(screen.getByTestId('open-folder'));
  await waitFor(() => expect(screen.getByTestId('explorer')).toBeTruthy());
  return { user };
}

const row = (name: string) =>
  screen.getAllByTestId('explorer-item').find((item) => item.textContent?.includes(name))!;

describe('Git status (PIGN-057)', () => {
  it('shows the branch, the changed count and a dot on changed entities', async () => {
    const git = new MemoryGitStatus();
    git.result = {
      available: true,
      repository: {
        branch: 'feature/login',
        files: [
          {
            path: 'collections/users-api/list-users.request.json',
            state: 'modified',
            deleted: false,
          },
          { path: 'collections/billing/collection.json', state: 'staged', deleted: false },
          {
            path: 'examples/users-api/create-user/201.example.json',
            state: 'untracked',
            deleted: false,
          },
        ],
      },
    };
    await openWithGit(git);
    await waitFor(() =>
      expect(screen.getByTestId('status-git-branch').textContent).toBe('feature/login'),
    );
    expect(screen.getByTestId('status-git-changes').textContent).toBe('· 3 changed');
    expect(within(row('List users')).getByTestId('explorer-git').dataset['git']).toBe('modified');
    expect(within(row('Billing API')).getByTestId('explorer-git').dataset['git']).toBe('staged');
    // A request's example files count for the request.
    expect(within(row('Create user')).getByTestId('explorer-git').dataset['git']).toBe('untracked');
    expect(within(row('Users API')).queryByTestId('explorer-git')).toBeNull();

    // Committed outside Pigeon: the next refresh (window focus) clears it.
    git.result = { available: true, repository: { branch: 'feature/login', files: [] } };
    const before = git.calls;
    act(() => {
      fireEvent.focus(window);
    });
    await waitFor(() => expect(git.calls).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryAllByTestId('explorer-git')).toHaveLength(0));
    expect(screen.queryByTestId('status-git-changes')).toBeNull();
    expect(screen.getByTestId('status-git-branch').textContent).toBe('feature/login');
  });

  it('stays hidden without git, outside a repository, or without the capability', async () => {
    const missing = new MemoryGitStatus();
    missing.result = { available: false, repository: null };
    await openWithGit(missing);
    await waitFor(() => expect(missing.calls).toBeGreaterThan(0));
    expect(screen.queryByTestId('status-git')).toBeNull();
    expect(screen.queryAllByTestId('explorer-git')).toHaveLength(0);
    cleanup();

    const noRepo = new MemoryGitStatus();
    await openWithGit(noRepo);
    await waitFor(() => expect(noRepo.calls).toBeGreaterThan(0));
    expect(screen.queryByTestId('status-git')).toBeNull();
    cleanup();

    const web = new MemoryGitStatus();
    await openWithGit(web, false);
    expect(web.calls).toBe(0);
    expect(screen.queryByTestId('status-git')).toBeNull();
  });
});

describe('gitStateOfRow', () => {
  it('uses the most pressing state of a request and its examples', () => {
    const files = new Map([
      ['collections/a/r.request.json', 'staged' as const],
      ['examples/a/r/x.example.json', 'conflicted' as const],
      ['examples/a/rr/y.example.json', 'modified' as const],
    ]);
    expect(gitStateOfRow({ kind: 'request', path: 'collections/a/r.request.json' }, files)).toBe(
      'conflicted',
    );
    expect(gitStateOfRow({ kind: 'folder', path: 'collections/a/folder.json' }, files)).toBe(
      undefined,
    );
  });
});
