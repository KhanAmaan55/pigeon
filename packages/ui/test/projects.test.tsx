import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { MemoryPlatform } from '@pigeon/platform';
import { createMemoryPlatform, MemoryFs, MockTransport } from '@pigeon/platform';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PigeonApp } from '../src/app/PigeonApp';
import { flattenTree, methodLabel } from '../src/features/explorer/tree';
import { createAppStore } from '../src/stores/app-store';
import { locationFolderName, locationKey, locationLabel } from '../src/stores/locations';

beforeEach(() => {
  // react-resizable-panels measures with ResizeObserver; ThemeProvider reads matchMedia (jsdom has neither).
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

async function fixturePlatform(
  transport = new MockTransport(),
): Promise<{ platform: MemoryPlatform; fs: MemoryFs }> {
  const platform = createMemoryPlatform({ transport, os: 'macos' });
  const fs = new MemoryFs();
  await copyInto(fs, fixtureDirectory);
  platform.projects.pickResult = platform.projects.add(fs);
  return { platform, fs };
}

const names = () =>
  screen.queryAllByTestId('explorer-item').map((item) => item.textContent?.trim());

describe('opening a project', () => {
  it('shows the welcome panel, then the tree in file order', async () => {
    const { platform } = await fixturePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();

    expect(screen.getByTestId('welcome')).toBeTruthy();
    await user.click(screen.getByTestId('open-folder'));

    await waitFor(() => expect(screen.getByTestId('explorer')).toBeTruthy());
    expect(screen.getByTestId('project-tab').textContent).toContain('Basic project');
    expect(names()).toEqual([
      'Users API',
      'GETList users',
      'Admin',
      'POSTCreate user',
      'Billing API',
      'GETGet invoices',
      'POSTPay invoice',
    ]);

    await user.click(screen.getByText('Admin'));
    await user.click(screen.getByText('Nested'));
    expect(names().slice(2, 6)).toEqual(['Admin', 'DELDelete user', 'Nested', 'GETGet audit log']);
  });

  it('opens a request in the editor and sends it with the project context', async () => {
    const transport = new MockTransport().on(
      { url: /billing\.example\.test\/invoices\/inv_1\/pay/ },
      { body: 'paid' },
    );
    const { platform, fs } = await fixturePlatform(transport);
    await fs.writeFileAtomic('receipts/invoice.pdf', new Uint8Array([37, 80, 68, 70]));
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await user.click(await screen.findByText('Pay invoice'));

    await waitFor(() =>
      expect((screen.getByTestId('url-input') as HTMLInputElement).value).toBe(
        'https://billing.example.test/invoices/:id/pay',
      ),
    );
    expect(screen.getByTestId('project-request-banner').textContent).toContain(
      'collections/billing/pay-invoice.request.json',
    );
    expect(screen.getByTestId('request-tab-label').textContent).toBe('Pay invoice');

    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    const sent = transport.requests[0]!;
    expect(sent.url).toBe('https://billing.example.test/invoices/inv_1/pay');
    expect(sent.meta.projectId).toBe('project-basic');
    expect(sent.body?.kind).toBe('file');
    expect(platform.pickedFiles.size).toBe(0);

    await user.click(screen.getByTestId('close-project'));
    expect(screen.getByTestId('welcome')).toBeTruthy();
    expect(screen.getByTestId('request-tab-label').textContent).toBe('Scratch request');
    expect(screen.queryByTestId('project-request-banner')).toBeNull();
  });

  it('marks broken files and shows their error instead of the editor', async () => {
    const { platform, fs } = await fixturePlatform();
    await fs.writeFileAtomic('collections/billing/refund.request.json', '<<<<<<< HEAD\n{');
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));

    const broken = await screen.findByText('refund');
    const row = broken.closest('[data-testid="explorer-item"]') as HTMLElement;
    expect(within(row).getByTestId('explorer-broken')).toBeTruthy();
    await user.click(broken);
    expect(screen.getByTestId('broken-file-panel').textContent).toContain(
      'collections/billing/refund.request.json',
    );
    await user.click(screen.getByText('Get invoices'));
    expect(screen.queryByTestId('broken-file-panel')).toBeNull();
    expect((screen.getByTestId('url-input') as HTMLInputElement).value).toContain(
      'invoices?status=open',
    );
  });

  it('offers to initialize a folder without pigeon.json', async () => {
    const platform = createMemoryPlatform();
    const fs = new MemoryFs();
    await fs.writeFileAtomic('README.md', '# repo');
    platform.projects.pickResult = platform.projects.add(fs);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('open-folder'));
    const dialog = await screen.findByTestId('init-project-dialog');
    const name = within(dialog).getByTestId('init-project-name');
    await user.clear(name);
    await user.type(name, 'Repo API');
    await user.click(within(dialog).getByTestId('init-project-confirm'));

    await waitFor(() => expect(screen.getByTestId('explorer')).toBeTruthy());
    expect((await fs.list('')).map((entry) => entry.path)).toEqual([
      '.gitattributes',
      'README.md',
      'collections',
      'environments',
      'examples',
      'pigeon.json',
    ]);
    expect(screen.getByTestId('explorer-project-name').textContent).toBe('Repo API');
  });

  it('creates a project and reopens it from the recent list after a restart', async () => {
    const platform = createMemoryPlatform();
    const first = render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('create-project'));
    // jsdom lays everything out at 0×0, so the panel library's resize handles take pointer
    // focus; type into the (auto-focused) field directly.
    expect(document.activeElement).toBe(screen.getByTestId('create-project-name'));
    await user.keyboard('Shop API');
    await user.click(screen.getByTestId('create-project-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('project-tab').textContent).toContain('Shop API'),
    );
    first.unmount();

    // A new app over the same local state, as after a restart.
    render(<PigeonApp platform={platform} />);
    const recent = await screen.findByTestId('recent-project');
    await waitFor(() => expect(recent.getAttribute('data-status')).toBe('ok'));
    expect(recent.textContent).toContain('Shop API');
    await user.click(within(recent).getByText('Shop API'));
    await waitFor(() =>
      expect(screen.getByTestId('project-tab').textContent).toContain('Shop API'),
    );
  });
});

describe('app store', () => {
  it('flags missing recent projects and can forget them', async () => {
    const platform = createMemoryPlatform();
    await platform.appState.set('app', 'recentProjects', [
      {
        projectId: 'p',
        name: 'Gone',
        location: { kind: 'memory', id: 'gone' },
        lastOpenedAt: '2026-01-01T00:00:00Z',
      },
    ]);
    const store = createAppStore(platform);
    await store.getState().loadRecents();
    const [recent] = store.getState().recentProjects;
    expect(store.getState().recentStatus).toEqual({ 'memory:gone': 'missing' });

    await store.getState().openRecent(recent!);
    expect(store.getState().error).toContain('moved or deleted');
    await store.getState().forgetRecent(recent!);
    expect(await platform.appState.get('app', 'recentProjects')).toEqual([]);
  });

  it('keeps at most ten recent projects, most recent first, without duplicates', async () => {
    const platform = createMemoryPlatform();
    const store = createAppStore(platform);
    const fss = Array.from({ length: 12 }, () => new MemoryFs());
    for (const [index, fs] of fss.entries()) {
      platform.projects.pickResult = platform.projects.add(fs);
      await store.getState().openFolder();
      await store.getState().confirmInit(`P${index}`);
    }
    await store.getState().openLocation(fss[3]!.root);
    const recents = store.getState().recentProjects.map((recent) => recent.name);
    expect(recents).toEqual(['P3', 'P11', 'P10', 'P9', 'P8', 'P7', 'P6', 'P5', 'P4', 'P2']);
  });

  it('rejects an empty project name and ignores cancelled pickers', async () => {
    const platform = createMemoryPlatform();
    const store = createAppStore(platform);
    await store.getState().createProject('  ');
    expect(store.getState().error).toBe('Enter a project name.');
    await store.getState().openFolder();
    expect(store.getState().project).toBeNull();
    expect(store.getState().pendingInit).toBeNull();
  });
});

describe('explorer tree', () => {
  it('flattens expanded containers and attaches file problems', async () => {
    const { fs } = await fixturePlatform();
    await fs.writeFileAtomic('collections/billing/x.request.json', '{');
    const { readProject } = await import('@pigeon/formats');
    const { model, problems } = await readProject(fs);
    const rows = flattenTree(model, { 'billing-collection': true }, problems);
    expect(rows.map((row) => [row.name, row.depth, row.expanded])).toEqual([
      ['Users API', 0, false],
      ['Billing API', 0, true],
      ['Get invoices', 1, false],
      ['Pay invoice', 1, false],
      ['x', 1, false],
    ]);
    expect(rows[4]).toMatchObject({
      broken: true,
      path: 'collections/billing/x.request.json',
      parentId: 'billing-collection',
    });
    expect(rows[4]!.problem).toBeTruthy();
  });

  it('abbreviates long methods', () => {
    expect(methodLabel('delete')).toBe('DEL');
    expect(methodLabel('OPTIONS')).toBe('OPT');
    expect(methodLabel('PROPFIND')).toBe('PROPF');
    expect(methodLabel('GET')).toBe('GET');
  });

  it('labels locations', () => {
    const native = { kind: 'native' as const, absolutePath: 'C:\\Users\\Ada\\My API\\' };
    expect(locationFolderName(native)).toBe('My API');
    expect(locationLabel(native)).toBe('C:\\Users\\Ada\\My API\\');
    expect(locationKey({ kind: 'browser-workspace', workspaceId: 'w', name: 'W' })).toBe(
      'browser-workspace:w',
    );
    expect(locationLabel({ kind: 'fs-access', handleKey: 'h', name: 'repo' })).toBe(
      'repo (folder)',
    );
  });
});
