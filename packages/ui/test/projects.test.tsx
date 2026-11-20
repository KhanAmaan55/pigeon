import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { MemoryPlatform } from '@pigeon/platform';
import { createMemoryPlatform, MemoryFs, MockTransport } from '@pigeon/platform';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
const tabNames = () => screen.queryAllByTestId('request-tab-name').map((tab) => tab.textContent);

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

  it('opens a request in a tab and sends it with the project context', async () => {
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
    expect(tabNames()).toEqual(['Pay invoice']);

    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    const sent = transport.requests[0]!;
    expect(sent.url).toBe('https://billing.example.test/invoices/inv_1/pay');
    expect(sent.meta.projectId).toBe('project-basic');
    expect(sent.body?.kind).toBe('file');
    expect(platform.pickedFiles.size).toBe(0);

    await user.click(screen.getByTestId('close-project'));
    expect(screen.getByTestId('welcome')).toBeTruthy();
    expect(screen.getByTestId('scratch-tab').textContent).toBe('Scratch request');
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

describe('browser workspaces and project zips', () => {
  function workspacePlatform() {
    const platform = createMemoryPlatform({
      capabilities: { browserWorkspace: true, projectFolders: 'none' },
    });
    platform.projects.createBrowserWorkspace = async () => platform.projects.add(new MemoryFs());
    return platform;
  }

  it('offers workspaces instead of folders when the browser has no folder access', async () => {
    const platform = workspacePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    expect(screen.queryByTestId('open-folder')).toBeNull();
    expect(screen.queryByTestId('create-project')).toBeNull();

    await user.click(screen.getByTestId('new-browser-workspace'));
    expect(document.activeElement).toBe(screen.getByTestId('create-project-name'));
    await user.keyboard('Notes');
    await user.click(screen.getByTestId('create-project-submit'));
    await waitFor(() => expect(screen.getByTestId('project-tab').textContent).toContain('Notes'));
  });

  it('exports the open project and imports it into a new workspace', async () => {
    const platform = workspacePlatform();
    const store = createAppStore(platform);
    await store.getState().createWorkspace('Shop API');
    const fs = store.getState().project!.session.fs;
    await fs.writeFileAtomic(
      'collections/shop/collection.json',
      '{"info":{"_postman_id":"c","name":"Shop"}}\n',
    );
    await fs.writeFileAtomic('collections/shop/notes.md', 'not exported');

    await store.getState().exportProjectZip();
    const [saved] = platform.files.saved;
    expect(saved).toMatchObject({ name: 'shop-api.zip', mime: 'application/zip' });

    platform.files.queuePick([{ name: 'shop-api.zip', bytes: saved!.data as Uint8Array }]);
    await store.getState().importProjectZip();
    expect(store.getState().error).toBeNull();
    const imported = store.getState().project!.session;
    expect(imported.fs).not.toBe(fs);
    expect(imported.name).toBe('Shop API');
    expect(imported.getWorkingModel().collections.map((c) => c.name)).toEqual(['Shop']);
    expect(await imported.fs.exists('collections/shop/notes.md')).toBe(false);

    platform.files.queuePick([{ name: 'bad.zip', bytes: new Uint8Array([1, 2]) }]);
    await store.getState().importProjectZip();
    expect(store.getState().error).toMatch(/not a valid zip/);
  });

  it('reconnects folders that need permission again', async () => {
    const platform = createMemoryPlatform();
    const fs = new MemoryFs();
    await fs.writeFileAtomic(
      'pigeon.json',
      '{"pigeon":{"formatVersion":1},"id":"p","name":"Repo","collections":[]}',
    );
    const location = platform.projects.add(fs);
    await platform.appState.set('app', 'recentProjects', [
      { projectId: 'p', name: 'Repo', location, lastOpenedAt: '2026-01-01T00:00:00Z' },
    ]);
    let granted = false;
    platform.projects.reopen = async () => (granted ? 'ok' : 'needs-permission');
    platform.projects.requestPermission = async () => (granted = true);

    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    const recent = await screen.findByTestId('recent-project');
    await waitFor(() => expect(recent.getAttribute('data-status')).toBe('needs-permission'));
    await user.click(within(recent).getByTestId('recent-reconnect'));
    await waitFor(() => expect(screen.getByTestId('project-tab').textContent).toContain('Repo'));
  });
});

describe('request tabs (PIGN-016)', () => {
  async function openFixture(transport = new MockTransport()) {
    const { platform, fs } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    return { platform, fs, user };
  }
  const urlInput = () => screen.getByTestId('url-input') as HTMLInputElement;

  it('replaces the preview tab, pins on double click or edit', async () => {
    const { user } = await openFixture();
    await user.click(screen.getByText('Get invoices'));
    await user.click(screen.getByText('Pay invoice'));
    expect(tabNames()).toEqual(['Pay invoice']);
    expect(screen.getByTestId('request-tab').getAttribute('data-pinned')).toBe('false');

    await user.dblClick(screen.getByText('List users'));
    await user.click(screen.getByText('Create user'));
    expect(tabNames()).toEqual(['List users', 'Create user']);

    // Editing pins the preview tab, so the next preview opens a third tab.
    await act(async () => {
      urlInput().focus();
    });
    await user.keyboard('/v2');
    await user.click(screen.getByText('Get invoices'));
    expect(tabNames()).toEqual(['List users', 'Create user', 'Get invoices']);
    expect(screen.getAllByTestId('request-tab')[1]!.getAttribute('data-unsaved')).toBe('true');
  });

  it('marks edits ●, sends the edited values and keeps each tab its own response', async () => {
    const transport = new MockTransport()
      .on({ url: /invoices\?status=open&archived&page=&x=1$/ }, { body: 'invoices' })
      .on({ url: /users\?limit=20$/ }, { body: 'users' });
    const { user } = await openFixture(transport);
    await user.dblClick(screen.getByText('Get invoices'));
    await act(async () => {
      urlInput().focus();
    });
    await user.keyboard('&x=1');
    expect(screen.getByTestId('request-tab-unsaved')).toBeTruthy();
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(screen.getByTestId('response-status').textContent).toContain('200'));

    await user.dblClick(screen.getByText('List users'));
    expect(urlInput().value).toBe('{{baseUrl}}/users?limit=20');
    expect(screen.queryByTestId('response-status')).toBeNull();

    await user.click(screen.getAllByTestId('request-tab')[0]!);
    expect(urlInput().value).toContain('&x=1');
    expect(screen.getByTestId('response-status').textContent).toContain('200');
    expect(transport.requests.map((r) => r.url)).toEqual([
      'https://billing.example.test/invoices?status=open&archived&page=&x=1',
    ]);
  });

  it('asks before closing an unsaved tab; Discard restores the file version', async () => {
    const { user } = await openFixture();
    await user.dblClick(screen.getByText('Get invoices'));
    await act(async () => {
      urlInput().focus();
    });
    await user.keyboard('&edited');
    await user.click(screen.getByTestId('request-tab-close'));
    const dialog = await screen.findByTestId('close-tab-dialog');
    await user.click(within(dialog).getByText('Cancel'));
    expect(tabNames()).toEqual(['Get invoices']);

    await user.click(screen.getByTestId('request-tab-close'));
    await user.click(await screen.findByTestId('close-tab-discard'));
    expect(tabNames()).toEqual([]);
    expect(screen.getByTestId('no-tab')).toBeTruthy();
    await user.click(screen.getByText('Get invoices'));
    expect(urlInput().value).toBe(
      'https://billing.example.test/invoices?status=open&archived&page=',
    );
  });

  it('closes with Cmd/Ctrl+W and middle click, cycles with Ctrl+Tab', async () => {
    const { user } = await openFixture();
    for (const name of ['Get invoices', 'Pay invoice', 'List users'])
      await user.dblClick(screen.getByText(name));
    const active = () =>
      screen.getAllByTestId('request-tab').find((t) => t.getAttribute('aria-selected') === 'true')
        ?.textContent;
    expect(active()).toContain('List users');
    await user.keyboard('{Control>}{Tab}{/Control}');
    expect(active()).toContain('Get invoices');
    await user.keyboard('{Control>}{Shift>}{Tab}{/Shift}{/Control}');
    expect(active()).toContain('List users');
    await user.keyboard('{Meta>}w{/Meta}');
    expect(tabNames()).toEqual(['Get invoices', 'Pay invoice']);
    await user.pointer({ keys: '[MouseMiddle]', target: screen.getAllByTestId('request-tab')[0]! });
    expect(tabNames()).toEqual(['Pay invoice']);
  });

  it('picks a body file from the project folder as a project-relative path', async () => {
    const transport = new MockTransport().on({ url: /invoices\/inv_1\/pay/ }, { body: 'ok' });
    const { fs, user } = await openFixture(transport);
    await fs.writeFileAtomic('fixtures/receipt.pdf', new Uint8Array([1, 2, 3]));
    await user.dblClick(screen.getByText('Pay invoice'));
    // Radix tabs activate on focus (jsdom's 0×0 layout lets the panel library swallow mousedown).
    await act(async () => {
      screen.getByTestId('body-tab').focus();
    });
    await user.click(screen.getByTestId('project-file-button'));
    const options = await screen.findAllByTestId('project-file-option');
    expect(options.map((o) => o.textContent)).toEqual([
      'collections/users-api/README.md',
      'fixtures/receipt.pdf',
    ]);
    await user.click(options[1]!);
    expect(screen.getByTestId('file-chip').getAttribute('title')).toBe(
      'fixtures/receipt.pdf (project file)',
    );
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    expect(transport.requests[0]!.body?.kind).toBe('file');
  });
});
