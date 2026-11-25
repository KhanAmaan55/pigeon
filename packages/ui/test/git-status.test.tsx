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
        path: '',
        ignored: false,
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
    git.result = {
      available: true,
      repository: { branch: 'feature/login', files: [], path: '', ignored: false },
    };
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

function platformWithGit(git: MemoryGitStatus, gitStatus = true) {
  const base = createMemoryPlatform({ os: 'macos', capabilities: { gitStatus } });
  return { base, platform: Object.assign(base, { git }) as Platform };
}

const ignoredIn = (path: string): MemoryGitStatus['result'] => ({
  available: true,
  repository: { branch: 'main', files: [], path, ignored: true },
});

const IGNORED_TEXT =
  "This folder is ignored by Git (dist/Pigeon): changes here won't be committed. Move the project out of it to share it.";

describe('Git-ignored project folder (PIGN-061)', () => {
  it('warns when an opened project is inside an ignored folder, and clears once it is not', async () => {
    const git = new MemoryGitStatus();
    git.result = ignoredIn('dist/Pigeon/');
    await openWithGit(git);
    const banner = await screen.findByTestId('git-ignored-banner');
    expect(banner.textContent).toBe(IGNORED_TEXT);
    expect(banner.getAttribute('role')).toBe('status');
    // Non-blocking: the explorer still works.
    expect(screen.getByTestId('new-collection')).toHaveProperty('disabled', false);
    expect(screen.getAllByTestId('explorer-item').length).toBeGreaterThan(0);

    // The user moves it out (or fixes .gitignore): the next refresh hides the warning.
    git.result = {
      available: true,
      repository: { branch: 'main', files: [], path: 'api/', ignored: false },
    };
    act(() => {
      fireEvent.focus(window);
    });
    await waitFor(() => expect(screen.queryByTestId('git-ignored-banner')).toBeNull());
  });

  it('warns right after creating a project in an ignored folder', async () => {
    const git = new MemoryGitStatus();
    git.result = ignoredIn('dist/Pigeon/');
    const { platform } = platformWithGit(git);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('create-project'));
    expect(document.activeElement).toBe(screen.getByTestId('create-project-name'));
    await user.keyboard('Pigeon');
    await user.click(screen.getByTestId('create-project-submit'));
    expect((await screen.findByTestId('git-ignored-banner')).textContent).toBe(IGNORED_TEXT);
  });

  it('warns after initializing an ignored folder as a project', async () => {
    const git = new MemoryGitStatus();
    git.result = ignoredIn('build/out/');
    const { base, platform } = platformWithGit(git);
    const fs = new MemoryFs();
    await fs.writeFileAtomic('README.md', '# output');
    base.projects.pickResult = base.projects.add(fs);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    const dialog = await screen.findByTestId('init-project-dialog');
    await user.click(within(dialog).getByTestId('init-project-confirm'));
    expect((await screen.findByTestId('git-ignored-path')).textContent).toBe('build/out');
  });

  it('stays hidden when not ignored, without git, outside a repository, or on web', async () => {
    const tracked = new MemoryGitStatus();
    tracked.result = {
      available: true,
      repository: { branch: 'main', files: [], path: 'api/', ignored: false },
    };
    await openWithGit(tracked);
    await waitFor(() => expect(screen.getByTestId('status-git')).toBeTruthy());
    expect(screen.queryByTestId('git-ignored-banner')).toBeNull();
    cleanup();

    // `git` missing: the status says so, whatever else it carries.
    const missing = new MemoryGitStatus();
    missing.result = { ...ignoredIn('dist/Pigeon/'), available: false };
    await openWithGit(missing);
    await waitFor(() => expect(missing.calls).toBeGreaterThan(0));
    expect(screen.queryByTestId('git-ignored-banner')).toBeNull();
    cleanup();

    const noRepo = new MemoryGitStatus();
    await openWithGit(noRepo);
    await waitFor(() => expect(noRepo.calls).toBeGreaterThan(0));
    expect(screen.queryByTestId('git-ignored-banner')).toBeNull();
    cleanup();

    // Web: no Git capability, so no Git call at all.
    const web = new MemoryGitStatus();
    web.result = ignoredIn('dist/Pigeon/');
    await openWithGit(web, false);
    expect(web.calls).toBe(0);
    expect(screen.queryByTestId('git-ignored-banner')).toBeNull();
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
