import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { MemoryPlatform } from '@pigeon/platform';
import { createMemoryPlatform, MemoryFs, MockTransport } from '@pigeon/platform';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAppCommand } from '../src/app/commands';
import { PigeonApp } from '../src/app/PigeonApp';
import { flattenTree, methodLabel } from '../src/features/explorer/tree';
import { setEditorText } from './code-editor';
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

/** Method + name of each explorer row (badges such as JS or example counts left out). */
const names = () =>
  screen
    .queryAllByTestId('explorer-item')
    .map((item) =>
      `${item.querySelector('[data-testid="explorer-method"]')?.textContent ?? ''}${item.querySelector('[data-testid="explorer-item-name"]')?.textContent ?? ''}`.trim(),
    );
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
    // Reopening a closed project moves it to the top; an open one is only focused.
    store.getState().closeProject('memory:' + (fss[3]!.root as { id: string }).id);
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

describe('explorer CRUD (PIGN-017)', () => {
  async function openFixture() {
    const { platform, fs } = await fixturePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    return { platform, fs, user };
  }
  const row = (name: string) =>
    screen.getAllByTestId('explorer-item').find((item) => item.textContent?.includes(name))!;
  const menu = async (name: string, action: string) => {
    fireEvent.contextMenu(row(name));
    fireEvent.click(await screen.findByTestId(action));
  };
  const renameTo = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    const input = await screen.findByTestId('explorer-rename-input');
    await act(async () => input.focus());
    await user.keyboard('{Control>}a{/Control}');
    await user.keyboard(`${name}{Enter}`);
  };

  it('creates collections, folders and requests from the menu and renames inline', async () => {
    const { user } = await openFixture();
    await user.click(screen.getByTestId('new-collection'));
    await renameTo(user, 'Orders');
    expect(names()).toContain('Orders');

    await menu('Orders', 'menu-new-folder');
    await renameTo(user, 'Ops');
    await menu('Ops', 'menu-new-request');
    // The new request opens pinned with the URL focused.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('url-input')));
    expect(tabNames()).toEqual(['New Request']);
    expect(names().slice(-3)).toEqual(['Orders', 'Ops', 'GETNew Request']);
    expect(row('New Request').getAttribute('data-unsaved')).toBe('true');

    await act(async () =>
      row('New Request').closest('[role="tree"]')!.dispatchEvent(new Event('focus')),
    );
    await menu('New Request', 'menu-rename');
    await renameTo(user, 'Create order');
    expect(names().slice(-1)).toEqual(['GETCreate order']);
    expect(tabNames()).toEqual(['Create order']);
  });

  it('creates a request with Cmd/Ctrl+N in the selected container', async () => {
    const { user } = await openFixture();
    await user.click(screen.getByText('Billing API')); // selects (and collapses) Billing
    await user.click(screen.getByText('Billing API'));
    await user.keyboard('{Meta>}n{/Meta}');
    await waitFor(() => expect(tabNames()).toEqual(['New Request']));
    expect(names().slice(-1)).toEqual(['GETNew Request']);
  });

  it('duplicates and deletes, closing the tabs of deleted requests', async () => {
    const { user } = await openFixture();
    await menu('Get invoices', 'menu-duplicate');
    expect(names()).toContain('GETGet invoices copy');

    await user.click(screen.getByText('Admin'));
    await user.click(screen.getByText('Nested'));
    await user.dblClick(screen.getByText('Get audit log'));
    expect(tabNames()).toEqual(['Get audit log']);
    await menu('Admin', 'menu-delete');
    expect((await screen.findByTestId('delete-dialog')).textContent).toContain(
      'folder and everything in it',
    );
    await user.click(screen.getByTestId('delete-confirm'));
    expect(names()).not.toContain('Admin');
    expect(tabNames()).toEqual([]);
  });

  it('moves items by drag and drop and refuses a folder into its own child', async () => {
    const { user } = await openFixture();
    await user.click(screen.getByText('Admin'));
    const transfer = {
      setData: () => undefined,
      getData: () => '',
      effectAllowed: '',
      dropEffect: '',
    };
    const drag = (from: string, to: string) => {
      fireEvent.dragStart(row(from), { dataTransfer: transfer });
      fireEvent.dragOver(row(to), { dataTransfer: transfer });
      fireEvent.drop(row(to), { dataTransfer: transfer });
      fireEvent.dragEnd(row(from), { dataTransfer: transfer });
    };
    // jsdom rows measure 0×0, so a drop lands in the middle: "inside" a folder, "after" a request.
    drag('Pay invoice', 'Admin');
    expect(names().slice(2, 7)).toEqual([
      'Admin',
      'DELDelete user',
      'Nested',
      'POSTPay invoice',
      'POSTCreate user',
    ]);
    drag('Admin', 'Nested');
    expect(names()[2]).toBe('Admin');
    expect(names()).toContain('Nested');
    drag('Create user', 'List users');
    expect(names().slice(0, 3)).toEqual(['Users API', 'GETList users', 'POSTCreate user']);
  });

  it('filters by name and URL', async () => {
    const { user } = await openFixture();
    await act(async () => screen.getByTestId('explorer-filter').focus());
    await user.keyboard('audit');
    expect(names()).toEqual(['Users API', 'Admin', 'Nested', 'GETGet audit log']);
    await user.keyboard('{Control>}a{/Control}{Backspace}/invoices/:id');
    expect(names()).toEqual(['Billing API', 'POSTPay invoice']);
    await user.keyboard('{Escape}');
    expect(names()).toHaveLength(7);
  });
});

describe('drop rules', () => {
  it('resolves drops into moves and rejects impossible ones', async () => {
    const { ProjectSession } = await import('@pigeon/core');
    const { resolveDrop, fuzzyMatch } = await import('../src/features/explorer/actions');
    const fs = new MemoryFs();
    await copyInto(fs, fixtureDirectory);
    const session = await ProjectSession.fromFs(fs);
    expect(
      resolveDrop(session, 'admin-folder', {
        kind: 'folder',
        id: 'nested-folder',
        position: 'inside',
      }),
    ).toBeNull();
    expect(
      resolveDrop(session, 'admin-folder', {
        kind: 'request',
        id: 'get-audit',
        position: 'before',
      }),
    ).toBeNull();
    expect(
      resolveDrop(session, 'list-users', {
        kind: 'collection',
        id: 'billing-collection',
        position: 'before',
      }),
    ).toBeNull();
    expect(
      resolveDrop(session, 'list-users', { kind: 'request', id: 'list-users', position: 'after' }),
    ).toBeNull();
    expect(
      resolveDrop(session, 'list-users', {
        kind: 'request',
        id: 'pay-invoice',
        position: 'before',
      }),
    ).toEqual({
      type: 'moveItem',
      id: 'list-users',
      parentId: 'billing-collection',
      index: 1,
    });
    expect(
      resolveDrop(session, 'billing-collection', {
        kind: 'collection',
        id: 'users-collection',
        position: 'before',
      }),
    ).toEqual({
      type: 'moveCollection',
      id: 'billing-collection',
      index: 0,
    });
    expect(
      resolveDrop(session, 'billing-collection', {
        kind: 'folder',
        id: 'admin-folder',
        position: 'inside',
      }),
    ).toBeNull();
    expect(fuzzyMatch('List users', 'lsu')).toBe(true);
    expect(fuzzyMatch('List users', 'xyz')).toBe(false);
  });
});

describe('Save to local state (PIGN-018)', () => {
  async function start(platform: MemoryPlatform) {
    const view = render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    return { view, user };
  }
  const row = (name: string) =>
    screen.getAllByTestId('explorer-item').find((item) => item.textContent?.includes(name))!;
  const badge = (name: string) => within(row(name)).queryByTestId('explorer-badge')?.textContent;
  const urlInput = () => screen.getByTestId('url-input') as HTMLInputElement;

  it('saves an edit, restores it with its tabs after a restart, and leaves files alone', async () => {
    const { platform, fs } = await fixturePlatform();
    const before = await fs.readText('collections/billing/get-invoices.request.json');
    const first = await start(platform);
    await first.user.click(screen.getByTestId('open-folder'));
    await first.user.dblClick(await screen.findByText('Get invoices'));
    await first.user.dblClick(screen.getByText('List users'));
    await first.user.click(screen.getAllByTestId('request-tab')[0]!);
    await act(async () => urlInput().focus());
    await first.user.keyboard('&saved=1');
    expect(screen.getByTestId('request-tab-unsaved')).toBeTruthy();

    await first.user.keyboard('{Meta>}s{/Meta}');
    await waitFor(() => expect(screen.queryByTestId('request-tab-unsaved')).toBeNull());
    expect(badge('Get invoices')).toBe('M');
    expect(await fs.readText('collections/billing/get-invoices.request.json')).toBe(before);
    await act(async () => {
      await useAppStoreFlush(platform);
    });
    first.view.unmount();

    // The project that was open at exit reopens by itself (PIGN-021).
    await start(platform);
    await waitFor(() => expect(tabNames()).toEqual(['Get invoices', 'List users']));
    expect(urlInput().value).toContain('&saved=1');
    expect(badge('Get invoices')).toBe('M');
  });

  it('marks new and deleted entities A and D; Discard brings a deleted request back', async () => {
    const { platform } = await fixturePlatform();
    const { user } = await start(platform);
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    fireEvent.contextMenu(row('Billing API'));
    fireEvent.click(await screen.findByTestId('menu-new-folder'));
    await act(async () => screen.getByTestId('explorer-rename-input').focus());
    await user.keyboard('Refunds{Enter}');
    fireEvent.contextMenu(row('Pay invoice'));
    fireEvent.click(await screen.findByTestId('menu-delete'));
    fireEvent.click(await screen.findByTestId('delete-confirm'));
    await waitFor(() => expect(row('Pay invoice')?.getAttribute('data-unsaved')).toBeUndefined());

    // Radix menus open on pointerdown, which jsdom's 0×0 layout routes to the panel library.
    await act(async () => screen.getByTestId('save-menu').focus());
    await user.keyboard('{Enter}');
    await user.click(await screen.findByTestId('save-all'));
    await waitFor(() => expect(badge('Refunds')).toBe('A'));
    expect(badge('Pay invoice')).toBe('D');
    expect(row('Pay invoice').getAttribute('data-change')).toBe('deleted');

    fireEvent.contextMenu(row('Pay invoice'));
    fireEvent.click(await screen.findByTestId('menu-discard'));
    await waitFor(() => expect(badge('Pay invoice')).toBeUndefined());
    expect(row('Pay invoice').getAttribute('data-change')).toBeNull();
  });

  it('offers Save when closing an unsaved tab', async () => {
    const { platform } = await fixturePlatform();
    const { user } = await start(platform);
    await user.click(screen.getByTestId('open-folder'));
    await user.dblClick(await screen.findByText('Get invoices'));
    await act(async () => urlInput().focus());
    await user.keyboard('&x');
    await user.click(screen.getByTestId('request-tab-close'));
    await user.click(await screen.findByTestId('close-tab-save'));
    await waitFor(() => expect(tabNames()).toEqual([]));
    expect(badge('Get invoices')).toBe('M');
  });

  it('remembers the theme, request defaults and the response dock', async () => {
    const { platform } = await fixturePlatform();
    const first = await start(platform);
    await first.user.click(screen.getByTestId('theme-toggle'));
    await first.user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    await first.user.keyboard('{Control>}{Alt>}l{/Alt}{/Control}');
    await waitFor(async () =>
      expect(await platform.appState.get('app', 'preferences')).toMatchObject({ theme: 'dark' }),
    );
    await act(async () => {
      await useAppStoreFlush(platform);
    });
    first.view.unmount();

    const second = await start(platform);
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBe('dark'));
    await screen.findByTestId('explorer');
    await second.user.dblClick(screen.getByText('Get invoices'));
    expect(screen.getByTestId('request-response-split').getAttribute('data-dock')).toBe('right');
  });
});

/** Writes pending debounced UI state of every project session (the app does this on close). */
async function useAppStoreFlush(platform: MemoryPlatform): Promise<void> {
  // UI state is debounced in core; waiting for the debounce is simpler than reaching the session.
  await new Promise((resolve) => setTimeout(resolve, 600));
  void platform;
}

describe('Save for Commit & Pending Changes (PIGN-019)', () => {
  async function openFixture() {
    const { platform, fs } = await fixturePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    return { platform, fs, user };
  }
  const urlInput = () => screen.getByTestId('url-input') as HTMLInputElement;

  it('lists changes, shows the file plan and diff, and writes the selected files', async () => {
    const { fs, user } = await openFixture();
    await user.dblClick(screen.getByText('Get invoices'));
    await act(async () => urlInput().focus());
    await user.keyboard('&commit=1');
    expect(screen.getByTestId('pending-count').textContent).toBe('1');

    await user.click(screen.getByTestId('activity-pending'));
    const item = await screen.findByTestId('pending-changes-item');
    expect(item.textContent).toContain('Get invoices');
    const file = await screen.findByTestId('pending-file');
    expect(file.textContent).toBe('Mcollections/billing/get-invoices.request.json');
    await user.click(file);
    const diff = await screen.findByTestId('diff-view');
    expect(within(diff).getAllByText(/status=open&archived&page=/).length).toBeGreaterThan(0);
    expect(diff.querySelectorAll('[data-kind="add"]').length).toBeGreaterThan(0);
    expect(diff.querySelectorAll('[data-kind="remove"]').length).toBeGreaterThan(0);

    await user.click(screen.getByTestId('commit-selected'));
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain('Wrote 1 file'));
    expect(await fs.readText('collections/billing/get-invoices.request.json')).toContain(
      '&commit=1',
    );
    expect(screen.getByTestId('pending-empty').textContent).toContain(
      'Everything is written to files',
    );
    expect(screen.queryByTestId('pending-count')).toBeNull();
  });

  it('shows renames as R and lets changes be discarded', async () => {
    const { fs, user } = await openFixture();
    fireEvent.contextMenu(screen.getByText('Pay invoice'));
    fireEvent.click(await screen.findByTestId('menu-rename'));
    await act(async () => screen.getByTestId('explorer-rename-input').focus());
    await user.keyboard('{Control>}a{/Control}Settle invoice{Enter}');
    await user.click(screen.getByTestId('activity-pending'));
    await waitFor(() =>
      expect(screen.getAllByTestId('pending-file').map((f) => f.textContent)).toContain(
        'Rcollections/billing/pay-invoice.request.json → collections/billing/settle-invoice.request.json',
      ),
    );
    await user.click(screen.getByTestId('discard-selected'));
    await screen.findByTestId('pending-empty');
    expect(await fs.exists('collections/billing/pay-invoice.request.json')).toBe(true);
  });

  it('commits the active request with Cmd/Ctrl+Shift+S', async () => {
    const { fs, user } = await openFixture();
    await user.dblClick(screen.getByText('List users'));
    await act(async () => urlInput().focus());
    await user.keyboard('&shortcut=1');
    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain('Wrote 1 file'));
    expect(await fs.readText('collections/users-api/list-users.request.json')).toContain(
      'shortcut=1',
    );
    expect(screen.queryByTestId('request-tab-unsaved')).toBeNull();
  });
});

describe('diffLines', () => {
  it('produces minimal unified diffs with context', async () => {
    const { diffLines, withContext } = await import('../src/components/DiffView/diff');
    const lines = diffLines('a\nb\nc\nd\ne\nf\ng\nh\n', 'a\nb\nc\nX\ne\nf\ng\nh\nI\n');
    expect(lines.filter((l) => l.kind !== 'same')).toEqual([
      { kind: 'remove', text: 'd', oldLine: 4 },
      { kind: 'add', text: 'X', newLine: 4 },
      { kind: 'add', text: 'I', newLine: 9 },
    ]);
    expect(withContext(lines, 1).map((l) => l?.text ?? '…')).toEqual([
      '…',
      'c',
      'd',
      'X',
      'e',
      '…',
      'h',
      'I',
    ]);
    expect(diffLines('', 'new\n')).toEqual([{ kind: 'add', text: 'new', newLine: 1 }]);
    expect(withContext(diffLines('same\n', 'same\n'))).toEqual([]);
  });
});

describe('external changes & conflicts (PIGN-020)', () => {
  async function openFixture() {
    const { platform, fs } = await fixturePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    return { platform, fs, user };
  }
  const PAY = 'collections/billing/pay-invoice.request.json';
  const urlInput = () => screen.getByTestId('url-input') as HTMLInputElement;
  const editFile = async (fs: MemoryFs, from: string, to: string) =>
    fs.writeFileAtomic(PAY, (await fs.readText(PAY)).replace(from, to));

  it('picks up external edits through the watcher and refreshes the open tab', async () => {
    const { fs, user } = await openFixture();
    expect(screen.getByTestId('status-change-detection').textContent).toBe('Watching files');
    await user.dblClick(screen.getByText('Pay invoice'));
    await editFile(fs, '/pay', '/settle');
    await waitFor(
      () => expect(urlInput().value).toBe('https://billing.example.test/invoices/:id/settle'),
      { timeout: 2000 },
    );
  });

  it('shows a conflict for a draft whose file changed; Compare, then Keep mine', async () => {
    const { fs, user } = await openFixture();
    await user.dblClick(screen.getByText('Pay invoice'));
    await act(async () => urlInput().focus());
    await user.keyboard('?mine=1');
    await user.keyboard('{Meta>}s{/Meta}');
    await editFile(fs, '"Pay invoice"', '"Pay theirs"');

    await screen.findByTestId('conflict-banner', {}, { timeout: 2000 });
    // The explorer shows mine (the draft) with a conflict mark.
    const row = screen
      .getAllByTestId('explorer-item')
      .find((r) => r.textContent?.includes('Pay invoice'))!;
    expect(within(row).getByTestId('explorer-conflict')).toBeTruthy();

    await user.click(screen.getByTestId('conflict-compare'));
    const diff = await screen.findByTestId('conflict-diff');
    expect(diff.querySelector('[data-kind="remove"]')?.textContent).toContain('Pay theirs');
    expect(diff.querySelector('[data-kind="add"]')?.textContent).toContain('Pay invoice');
    await user.keyboard('{Escape}');

    await user.click(screen.getByTestId('conflict-keep-mine'));
    await waitFor(() => expect(screen.queryByTestId('conflict-banner')).toBeNull());
    expect(urlInput().value).toContain('?mine=1');
  });

  it('Take theirs drops the draft', async () => {
    const { fs, user } = await openFixture();
    await user.dblClick(screen.getByText('Pay invoice'));
    await act(async () => urlInput().focus());
    await user.keyboard('?mine=1');
    await user.keyboard('{Meta>}s{/Meta}');
    await editFile(fs, '"Pay invoice"', '"Pay theirs"');
    await user.click(await screen.findByTestId('conflict-take-theirs', {}, { timeout: 2000 }));
    await waitFor(() => expect(urlInput().value).not.toContain('mine=1'));
    expect(screen.getByTestId('request-tab-name').textContent).toBe('Pay theirs');
  });

  it('asks to reload unsaved edits whose file changed', async () => {
    const { fs, user } = await openFixture();
    await user.dblClick(screen.getByText('Pay invoice'));
    await act(async () => urlInput().focus());
    await user.keyboard('?draft');
    await editFile(fs, '/pay', '/settle');
    await user.click(await screen.findByTestId('external-reload', {}, { timeout: 2000 }));
    expect(urlInput().value).toBe('https://billing.example.test/invoices/:id/settle');
    expect(screen.queryByTestId('request-tab-unsaved')).toBeNull();
  });
});

describe('multiple projects (PIGN-021)', () => {
  async function twoProjects() {
    const platform = createMemoryPlatform({ os: 'macos' });
    const basic = new MemoryFs();
    await copyInto(basic, fixtureDirectory);
    const other = new MemoryFs();
    await other.writeFileAtomic(
      'pigeon.json',
      '{"pigeon":{"formatVersion":1},"id":"other","name":"Other API","collections":["shop"]}',
    );
    await other.writeFileAtomic(
      'collections/shop/collection.json',
      '{"info":{"_postman_id":"shop","name":"Shop"}}',
    );
    await other.writeFileAtomic(
      'collections/shop/get-invoices.request.json',
      '{"id":"get-invoices","name":"Get invoices","request":{"method":"GET","url":"/other"}}',
    );
    const locations = [platform.projects.add(basic), platform.projects.add(other)];
    return { platform, basic, other, locations };
  }
  // Project switches use fireEvent: in jsdom every element is 0×0, so real pointer events also
  // land on the resize handles of the remounted panels.
  const urlInput = () => screen.getByTestId('url-input') as HTMLInputElement;
  const projectTabs = () =>
    screen
      .getAllByTestId('project-tab')
      .map((t) => [t.textContent, t.getAttribute('aria-selected')]);

  it('keeps two projects open with their own tabs and unsaved edits', async () => {
    const { platform, locations } = await twoProjects();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    platform.projects.pickResult = locations[0]!;
    await user.click(screen.getByTestId('open-folder'));
    await user.dblClick(await screen.findByText('Get invoices'));
    await act(async () => urlInput().focus());
    await user.keyboard('&a=1');

    fireEvent.click(screen.getByTestId('add-project'));
    platform.projects.pickResult = locations[1]!;
    await user.click(await screen.findByTestId('open-folder'));
    await user.dblClick(await screen.findByText('Get invoices'));
    expect(urlInput().value).toBe('/other');
    expect(projectTabs()).toEqual([
      ['Basic project', 'false'],
      ['Other API', 'true'],
    ]);

    // From the URL field (jsdom may leave focus on a resize handle, which handles arrows itself).
    await act(async () => urlInput().focus());
    await user.keyboard('{Meta>}{Alt>}{ArrowLeft}{/Alt}{/Meta}');
    expect(urlInput().value).toContain('&a=1');
    expect(screen.getByTestId('request-tab-unsaved')).toBeTruthy();
    fireEvent.click(screen.getAllByTestId('project-tab')[1]!);
    expect(urlInput().value).toBe('/other');
    expect(screen.queryByTestId('request-tab-unsaved')).toBeNull();

    // Opening an already-open project only focuses its tab.
    fireEvent.click(screen.getByTestId('add-project'));
    platform.projects.pickResult = locations[0]!;
    await user.click(await screen.findByTestId('open-folder'));
    await waitFor(() =>
      expect(projectTabs()).toEqual([
        ['Basic project', 'true'],
        ['Other API', 'false'],
      ]),
    );
  });

  it('restores the open projects and the active one after a restart', async () => {
    const { platform, locations } = await twoProjects();
    const first = render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    for (const location of locations) {
      platform.projects.pickResult = location;
      if (screen.queryByTestId('add-project')) fireEvent.click(screen.getByTestId('add-project'));
      await user.click(await screen.findByTestId('open-folder'));
      await screen.findByTestId('explorer');
    }
    fireEvent.click(screen.getAllByTestId('project-tab')[0]!);
    await waitFor(async () =>
      expect(await platform.appState.get('app', 'activeProject')).toBe(
        `memory:${(locations[0] as { id: string }).id}`,
      ),
    );
    first.unmount();

    render(<PigeonApp platform={platform} />);
    await waitFor(() =>
      expect(projectTabs()).toEqual([
        ['Basic project', 'true'],
        ['Other API', 'false'],
      ]),
    );
  });

  it('opens a copied folder with the same id with separate local state and a banner', async () => {
    const platform = createMemoryPlatform();
    const original = new MemoryFs();
    await copyInto(original, fixtureDirectory);
    const copy = new MemoryFs();
    await copyInto(copy, fixtureDirectory);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    platform.projects.pickResult = platform.projects.add(original);
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    expect(screen.queryByTestId('duplicate-project-banner')).toBeNull();

    fireEvent.click(screen.getByTestId('add-project'));
    platform.projects.pickResult = platform.projects.add(copy);
    await user.click(await screen.findByTestId('open-folder'));
    expect(await screen.findByTestId('duplicate-project-banner')).toBeTruthy();
    await user.dblClick(screen.getByText('Get invoices'));
    await act(async () => urlInput().focus());
    await user.keyboard('&copy{Meta>}s{/Meta}');
    await waitFor(async () => {
      const keys = (
        await Promise.all(
          ['project-basic', 'project-basic@'].map((k) =>
            platform.appState.get(`project:${k}`, 'state'),
          ),
        )
      ).map(Boolean);
      expect(keys[0]).toBe(false);
    });

    await user.click(screen.getByTestId('regenerate-project-id'));
    expect(screen.getByTestId('pending-count').textContent).toBe('2');
  });

  it('asks before closing a project with unsaved changes', async () => {
    const { platform, locations } = await twoProjects();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    platform.projects.pickResult = locations[1]!;
    await user.click(screen.getByTestId('open-folder'));
    await user.dblClick(await screen.findByText('Get invoices'));
    await act(async () => urlInput().focus());
    await user.keyboard('?x');
    await user.click(screen.getByTestId('close-project'));
    await user.click(await screen.findByTestId('close-project-confirm'));
    expect(screen.queryAllByTestId('project-tab')).toEqual([]);
    expect(screen.getByTestId('welcome')).toBeTruthy();
  });
});

describe('environments (PIGN-022)', () => {
  async function openFixture() {
    const { platform, fs } = await fixturePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    fireEvent.click(screen.getByTestId('activity-environments'));
    await screen.findByTestId('environments-view');
    return { platform, fs, user };
  }
  const typeInto = async (
    user: ReturnType<typeof userEvent.setup>,
    element: HTMLElement,
    text: string,
  ) => {
    await act(async () => element.focus());
    await user.keyboard(text);
  };

  it('creates an environment, edits shared and current values, and commits only shared ones', async () => {
    const { fs, user } = await openFixture();
    fireEvent.click(screen.getByTestId('new-environment'));
    await typeInto(
      user,
      await screen.findByTestId('environment-rename-input'),
      '{Control>}a{/Control}Local{Enter}',
    );
    expect(screen.getByTestId('request-tab-name').textContent).toBe('Local');

    const table = await screen.findByTestId('env-variables');
    await typeInto(user, within(table).getAllByLabelText('Key').at(-1)!, 'baseUrl');
    await typeInto(
      user,
      within(table).getAllByLabelText('Shared value')[0]!,
      'http://localhost:3000',
    );
    await typeInto(user, screen.getAllByTestId('env-current-value')[0]!, 'http://localhost:4010');
    expect(screen.getByTestId('request-tab-unsaved')).toBeTruthy();

    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain('Wrote 1 file'));
    const file = await fs.readText('environments/local.postman_environment.json');
    expect(file).toContain('"value": "http://localhost:3000"');
    expect(file).not.toContain('4010');
  });

  it('selects an environment from the top bar, remembered per project', async () => {
    const { platform, fs, user } = await openFixture();
    await fs.writeFileAtomic(
      'environments/staging.postman_environment.json',
      '{"id":"stg","name":"Staging","values":[]}',
    );
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    await waitFor(() =>
      expect(screen.getAllByTestId('environment-item').map((e) => e.textContent)).toContain(
        'Staging',
      ),
    );
    expect(screen.getByTestId('environment-selector').textContent).toBe('No environment');

    await user.keyboard('{Meta>}e{/Meta}');
    await user.click(
      (await screen.findAllByTestId('environment-option')).find(
        (o) => o.textContent === 'Staging',
      )!,
    );
    expect(screen.getByTestId('environment-selector').textContent).toBe('Staging');
    expect(
      (
        await platform.appState.get<{ selectedEnvironmentId: string }>(
          'project:project-basic',
          'state',
        )
      )?.selectedEnvironmentId,
    ).toBe('stg');
  });

  it('shows a deleted environment as D until committed', async () => {
    const { fs, user } = await openFixture();
    await fs.writeFileAtomic(
      'environments/dev.postman_environment.json',
      '{"id":"dev","name":"Dev","values":[]}',
    );
    await act(async () => window.dispatchEvent(new Event('focus')));
    const item = await screen.findByText('Dev', {}, { timeout: 2000 });
    fireEvent.contextMenu(item);
    fireEvent.click(await screen.findByTestId('env-menu-delete'));
    await act(async () => screen.getByTestId('save-menu').focus());
    await user.keyboard('{Enter}');
    await user.click(await screen.findByTestId('save-all'));
    await waitFor(() => expect(screen.getByTestId('environment-badge').textContent).toBe('D'));
    expect(await fs.exists('environments/dev.postman_environment.json')).toBe(true);
  });
});

describe('variable resolution & highlighting (PIGN-023)', () => {
  async function openWithEnvironments(transport = new MockTransport()) {
    const { platform, fs } = await fixturePlatform(transport);
    await fs.writeFileAtomic(
      'environments/local.postman_environment.json',
      JSON.stringify({
        id: 'local',
        name: 'Local',
        values: [
          { key: 'baseUrl', value: 'http://local.test', enabled: true },
          { key: 'token', value: 'abc', type: 'secret', enabled: true },
        ],
      }),
    );
    await fs.writeFileAtomic(
      'environments/staging.postman_environment.json',
      JSON.stringify({
        id: 'staging',
        name: 'Staging',
        values: [{ key: 'baseUrl', value: 'https://staging.test', enabled: true }],
      }),
    );
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    return { platform, fs, user };
  }
  const urlInput = () => screen.getByTestId('url-input') as HTMLInputElement;
  const selectEnvironment = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await act(async () => screen.getByTestId('environment-selector').focus());
    await user.keyboard('{Enter}');
    await user.click(
      (await screen.findAllByTestId('environment-option')).find((o) => o.textContent === name)!,
    );
  };
  // Highlights drawn behind the URL input (the params table below has its own).
  const states = () =>
    [...urlInput().parentElement!.querySelectorAll('[data-variable-state]')].map((e) => [
      e.textContent,
      e.getAttribute('data-variable-state'),
    ]);

  it('highlights variables against the selected environment and explains them on hover', async () => {
    const { user } = await openWithEnvironments();
    await user.dblClick(screen.getByText('List users'));
    // Without an environment, the Users API collection variable applies (PIGN-024).
    expect(states()).toEqual([['{{baseUrl}}', 'resolved']]);
    expect(urlInput().title).toBe('baseUrl = https://api.example.test (Users API)');

    await selectEnvironment(user, 'Local');
    await waitFor(() =>
      expect(urlInput().title).toBe(
        'baseUrl = http://local.test (Local) — also defined in collection Users API',
      ),
    );
    await act(async () => urlInput().focus());
    await user.keyboard('{End}/{{{{nope}}');
    expect(states()).toEqual([
      ['{{baseUrl}}', 'resolved'],
      ['{{nope}}', 'unresolved'],
    ]);
    expect(urlInput().title).toContain('nope: not defined in the selected environment');
    await user.keyboard('{Backspace>9/}');

    await act(async () => urlInput().focus());
    await user.keyboard('{End}?t={{{{$guid}}&a={{{{token}}'); // `{{` types one `{`
    expect(states()).toEqual([
      ['{{baseUrl}}', 'resolved'],
      ['{{$guid}}', 'dynamic'],
      ['{{token}}', 'resolved'],
    ]);
    expect(urlInput().title).toContain('token = •••• (Local)');
  });

  it('autocompletes variable names after {{', async () => {
    const { user } = await openWithEnvironments();
    await selectEnvironment(user, 'Local');
    await user.dblClick(screen.getByText('Get invoices'));
    await act(async () => urlInput().focus());
    await user.keyboard('{Control>}a{/Control}{{{{to');
    const options = await screen.findAllByTestId('variable-suggestion');
    expect(options.map((o) => o.textContent)).toEqual(['token•••• · Local']);
    await user.keyboard('{Enter}');
    expect(urlInput().value).toBe('{{token}}');
  });

  it('sends to the selected environment and warns about unresolved variables', async () => {
    const transport = new MockTransport().on({ url: /./ }, { body: 'ok' });
    const { user } = await openWithEnvironments(transport);
    await user.dblClick(screen.getByText('List users'));
    await selectEnvironment(user, 'Local');
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    expect(transport.requests[0]!.url).toBe('http://local.test/users?limit=20');

    await selectEnvironment(user, 'Staging');
    await act(async () => urlInput().focus());
    await user.keyboard('{End}&x={{{{nope}}');
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(2));
    expect(transport.requests[1]!.url).toBe(
      'https://staging.test/users?limit=20&x=%7B%7Bnope%7D%7D',
    );
    // `token` comes from the bearer auth the request inherits from its collection (PIGN-026).
    expect(transport.requests[1]!.meta.unresolved).toEqual(['nope', 'token']);
    expect((await screen.findByTestId('response-panel')).textContent).toContain(
      'Unresolved variables: nope, token',
    );
  });
});

describe('collection variables & globals (PIGN-024)', () => {
  async function openFixture() {
    const transport = new MockTransport().on({ url: /./ }, { body: 'ok' });
    const { platform, fs } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    return { platform, fs, user, transport };
  }
  const typeInto = async (
    user: ReturnType<typeof userEvent.setup>,
    element: HTMLElement,
    text: string,
  ) => {
    await act(async () => element.focus());
    await user.keyboard(text);
  };
  const urlInput = () => screen.getByTestId('url-input') as HTMLInputElement;

  it('uses collection variables, shows shadowing, and commits only collection.json', async () => {
    const { fs, user, transport } = await openFixture();
    await user.dblClick(screen.getByText('List users'));
    // The fixture's Users API collection defines baseUrl.
    await waitFor(() =>
      expect(urlInput().title).toBe('baseUrl = https://api.example.test (Users API)'),
    );
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() =>
      expect(transport.requests[0]?.url).toBe('https://api.example.test/users?limit=20'),
    );

    fireEvent.contextMenu(screen.getByText('Users API'));
    fireEvent.click(await screen.findByTestId('menu-variables'));
    const table = await screen.findByTestId('env-variables');
    await typeInto(user, within(table).getAllByLabelText('Key').at(-1)!, 'version');
    await typeInto(user, within(table).getAllByLabelText('Shared value')[1]!, '2');
    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain('Wrote 1 file'));
    expect(await fs.readText('collections/users-api/collection.json')).toContain(
      '"key": "version"',
    );

    // Globals: lowest precedence; the env-less request still uses the collection value.
    fireEvent.click(screen.getByTestId('activity-environments'));
    fireEvent.click(await screen.findByTestId('globals-item'));
    const globals = await screen.findByTestId('env-variables');
    await typeInto(user, within(globals).getAllByLabelText('Key').at(-1)!, 'baseUrl');
    await typeInto(
      user,
      within(globals).getAllByLabelText('Shared value')[0]!,
      'http://globals.test',
    );
    fireEvent.click(screen.getAllByTestId('request-tab')[0]!);
    await waitFor(() =>
      expect(urlInput().title).toBe(
        'baseUrl = https://api.example.test (Users API) — also defined in globals Globals',
      ),
    );
  });

  it('creates the globals file on the first commit of a global variable', async () => {
    const { fs, user } = await openFixture();
    fireEvent.click(screen.getByTestId('activity-environments'));
    fireEvent.click(await screen.findByTestId('globals-item'));
    const table = await screen.findByTestId('env-variables');
    await typeInto(user, within(table).getAllByLabelText('Key').at(-1)!, 'token');
    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain('Wrote 1 file'));
    expect(
      JSON.parse(await fs.readText('environments/globals.postman_globals.json')),
    ).toMatchObject({
      values: [{ key: 'token', value: '', type: 'default', enabled: true }],
      _postman_variable_scope: 'globals',
    });
  });
});

describe('secret variables (PIGN-025)', () => {
  async function openFixture(transport = new MockTransport().on({ url: /./ }, { body: 'ok' })) {
    const { platform, fs } = await fixturePlatform(transport);
    await fs.writeFileAtomic(
      'environments/local.postman_environment.json',
      JSON.stringify({
        id: 'local',
        name: 'Local',
        values: [{ key: 'baseUrl', value: 'http://local.test', enabled: true }],
      }),
    );
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    await act(async () => screen.getByTestId('environment-selector').focus());
    await user.keyboard('{Enter}');
    await user.click(
      (await screen.findAllByTestId('environment-option')).find((o) => o.textContent === 'Local')!,
    );
    return { platform, fs, user, transport };
  }

  it('moves a literal Authorization value into a secret variable and masks it in the timeline', async () => {
    const { platform, fs, user, transport } = await openFixture();
    await user.dblClick(screen.getByText('List users'));
    await act(async () => screen.getByTestId('headers-tab').focus());
    const table = screen.getByTestId('headers-table');
    await act(async () => within(table).getAllByLabelText('Key').at(-1)!.focus());
    await user.keyboard('Authorization');
    await act(async () => within(table).getAllByLabelText('Value').at(-2)!.focus());
    await user.keyboard('Bearer live-token-123');
    await user.click(await screen.findByTestId('move-to-secret'));

    expect((within(table).getAllByLabelText('Value').at(-2) as HTMLInputElement).value).toBe(
      'Bearer {{token}}',
    );
    expect(screen.queryByTestId('literal-secret-hint')).toBeNull();
    expect(await platform.secrets.getAll('project-basic')).toEqual({
      'env:local\u0000token': 'live-token-123',
    });

    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    expect(transport.requests[0]!.headers).toContainEqual([
      'Authorization',
      'Bearer live-token-123',
    ]);
    await act(async () => screen.getByTestId('response-timeline-tab').focus());
    const timeline = await screen.findByTestId('response-timeline');
    expect(timeline.textContent).not.toContain('live-token-123');
    expect(timeline.textContent).toContain('Bearer ••••••');

    // Nothing secret reaches the files.
    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await waitFor(() => expect(screen.getByTestId('toast')).toBeTruthy());
    for (const entry of await fs.list('', { recursive: true })) {
      if (entry.kind === 'file')
        expect(await fs.readText(entry.path)).not.toContain('live-token-123');
    }
  });

  it('masks secret current values, reveals them while held, and confirms leaving secret', async () => {
    const { user } = await openFixture();
    fireEvent.click(screen.getByTestId('activity-environments'));
    fireEvent.click(
      (await screen.findAllByTestId('environment-item')).find((e) =>
        e.textContent?.includes('Local'),
      )!,
    );
    const table = await screen.findByTestId('env-variables');
    await act(async () => within(table).getAllByLabelText('Key').at(-1)!.focus());
    await user.keyboard('apiKey');
    fireEvent.change(within(table).getAllByTestId('env-variable-type')[1]!, {
      target: { value: 'secret' },
    });
    const current = within(table).getAllByTestId('env-current-value')[1] as HTMLInputElement;
    await act(async () => current.focus());
    await user.keyboard('k-123456');
    expect(current.type).toBe('password');
    const reveal = within(table).getByTestId('secret-reveal');
    fireEvent.pointerDown(reveal);
    expect(current.type).toBe('text');
    fireEvent.pointerUp(reveal);
    expect(current.type).toBe('password');

    fireEvent.change(within(table).getAllByTestId('env-variable-type')[1]!, {
      target: { value: 'default' },
    });
    await user.click(await screen.findByTestId('unsecure-confirm'));
    expect((within(table).getAllByTestId('env-current-value')[1] as HTMLInputElement).type).toBe(
      'text',
    );
  });
});

describe('auth with inheritance (PIGN-026)', () => {
  async function openFixture() {
    const transport = new MockTransport().on({ url: /./ }, { body: 'ok' });
    const { platform, fs } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    return { platform, fs, user, transport };
  }
  const typeInto = async (
    user: ReturnType<typeof userEvent.setup>,
    element: HTMLElement,
    text: string,
  ) => {
    await act(async () => element.focus());
    await user.keyboard(text);
  };
  const authHeader = (transport: MockTransport, index: number) =>
    transport.requests[index]!.headers.filter(([k]) => k === 'Authorization').map(([, v]) => v);

  it('inherits the collection bearer, switches to Basic and back to Inherit', async () => {
    const { user, transport } = await openFixture();
    await user.dblClick(screen.getByText('List users'));
    await act(async () => screen.getByTestId('auth-tab').focus());
    expect((await screen.findByTestId('auth-inherited')).textContent).toBe(
      'Inherited from collection Users API: Bearer',
    );
    expect((screen.getByTestId('auth-type') as HTMLSelectElement).value).toBe('inherit');
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    expect(authHeader(transport, 0)).toEqual(['Bearer {{token}}']);

    fireEvent.change(screen.getByTestId('auth-type'), { target: { value: 'basic' } });
    await typeInto(user, screen.getByTestId('auth-username'), 'ünï');
    await typeInto(user, screen.getByTestId('auth-password'), 'pä ss');
    // A literal password would be committed: the hint offers a secret variable.
    expect(screen.getByTestId('literal-secret-hint').textContent).toContain('password');
    expect(screen.getByTestId('auth-tab-indicator')).toBeTruthy();
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(2));
    expect(authHeader(transport, 1)).toEqual(['Basic w7xuw686cMOkIHNz']);
    // The timeline shows the generated header masked.
    await act(async () => screen.getByTestId('response-timeline-tab').focus());
    const timeline = await screen.findByTestId('response-timeline');
    expect(timeline.textContent).toContain('Basic ••••••');
    expect(timeline.textContent).not.toContain('w7xuw686cMOkIHNz');

    await act(async () => screen.getByTestId('auth-tab').focus());
    fireEvent.change(screen.getByTestId('auth-type'), { target: { value: 'inherit' } });
    expect((await screen.findByTestId('auth-inherited')).textContent).toContain('Bearer');
    // Switching back to Basic restores what was typed.
    fireEvent.change(screen.getByTestId('auth-type'), { target: { value: 'basic' } });
    expect((screen.getByTestId('auth-username') as HTMLInputElement).value).toBe('ünï');
  });

  it('a folder set to No auth stops inheritance for its children and is committed', async () => {
    const { fs, user, transport } = await openFixture();
    fireEvent.contextMenu(screen.getByText('Admin'));
    fireEvent.click(await screen.findByTestId('menu-variables'));
    const section = await screen.findByTestId('container-auth');
    expect(within(section).getByTestId('auth-inherited').textContent).toBe(
      'Inherited from collection Users API: Bearer',
    );
    fireEvent.change(within(section).getByTestId('auth-type'), { target: { value: 'noauth' } });
    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain('Wrote 1 file'));
    expect(JSON.parse(await fs.readText('collections/users-api/admin/folder.json'))).toMatchObject({
      auth: { type: 'noauth' },
    });

    const explorer = screen.getByTestId('explorer');
    await user.click(within(explorer).getByText('Admin'));
    await user.click(await within(explorer).findByText('Nested'));
    await user.dblClick(await within(explorer).findByText('Get audit log'));
    await act(async () => screen.getByTestId('auth-tab').focus());
    expect((await screen.findByTestId('auth-inherited')).textContent).toBe(
      'Inherited from folder Admin: No auth',
    );
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    expect(authHeader(transport, 0)).toEqual([]);
  });
});

describe('response examples (PIGN-027)', () => {
  async function openFixture() {
    const transport = new MockTransport().on(
      { url: /./ },
      {
        headers: [
          ['Content-Type', 'application/json'],
          ['Date', 'Fri, 20 Nov 2026 10:00:00 GMT'],
          ['ETag', '"v1"'],
        ],
        body: '{"users":[{"id":1}]}',
      },
    );
    const { platform, fs } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    return { platform, fs, user, transport };
  }

  it('saves a response as an example, lists it, edits it and commits the files', async () => {
    const { fs, user } = await openFixture();
    await user.dblClick(screen.getByText('List users'));
    await user.click(screen.getByTestId('send-button'));
    await user.click(await screen.findByTestId('save-as-example'));
    expect(screen.getByTestId('example-saved').textContent).toContain('200 OK');

    // Response panel → Examples lists it; the explorer shows a count on the request.
    await act(async () => screen.getByTestId('response-examples-tab').focus());
    expect(screen.getByTestId('response-examples-count').textContent).toBe('1');
    // ★: the only example is the baseline (PIGN-034).
    expect(screen.getAllByTestId('examples-list-item').map((li) => li.textContent)).toEqual([
      '★200200 OK',
    ]);
    const toggle = screen.getByTestId('explorer-examples-toggle');
    expect(toggle.textContent).toBe('1');
    fireEvent.click(toggle);
    const row = screen
      .getAllByTestId('explorer-item')
      .find((item) => item.getAttribute('data-kind') === 'example')!;
    expect(row.textContent).toContain('200 OK');

    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain('Wrote'));
    const metadata = JSON.parse(
      await fs.readText('examples/users-api/list-users/200-ok.example.json'),
    ) as { header: Array<{ key: string }>; originalRequest: { url: { raw: string } } };
    expect(metadata.header.map((h) => h.key)).toEqual(['Content-Type']);
    expect(metadata.originalRequest.url.raw).toBe('{{baseUrl}}/users?limit=20');
    expect(await fs.readText('examples/users-api/list-users/200-ok.body.json')).toBe(
      '{\n  "users": [\n    {\n      "id": 1\n    }\n  ]\n}\n',
    );

    // Open it: read-only until Edit.
    fireEvent.click(row);
    const view = await screen.findByTestId('example-view');
    expect(within(view).getByTestId('example-status-line').textContent).toBe('200 OK');
    expect(within(view).getByTestId('example-file').textContent).toContain(
      'examples/users-api/list-users/200-ok.example.json',
    );
    expect(within(view).queryByTestId('example-status')).toBeNull();
    fireEvent.click(within(view).getByTestId('example-edit-toggle'));
    const status = within(view).getByTestId('example-status');
    await act(async () => status.focus());
    await user.keyboard('{Backspace}{Backspace}Fine');
    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await waitFor(async () =>
      expect(
        JSON.parse(await fs.readText('examples/users-api/list-users/200-ok.example.json')),
      ).toMatchObject({ status: 'Fine' }),
    );

    // Delete from the view: the tab closes, the commit removes both files.
    fireEvent.click(within(screen.getByTestId('example-view')).getByTestId('example-delete'));
    expect(screen.queryByTestId('example-view')).toBeNull();
    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await waitFor(async () =>
      expect(await fs.exists('examples/users-api/list-users/200-ok.example.json')).toBe(false),
    );
    expect(await fs.exists('examples/users-api/list-users/200-ok.body.json')).toBe(false);
  });

  it('keeps the volatile header list editable in Settings', async () => {
    const { user } = await openFixture();
    fireEvent.click(screen.getByTestId('activity-settings'));
    const list = (await screen.findByTestId('preference-volatile-headers')) as HTMLTextAreaElement;
    expect(list.value.split('\n')).toContain('ETag');
    await act(async () => list.focus());
    await user.clear(list);
    await user.keyboard('Date');
    fireEvent.click(screen.getByTestId('activity-collections'));
    await user.dblClick(await screen.findByText('List users'));
    await user.click(screen.getByTestId('send-button'));
    await user.click(await screen.findByTestId('save-as-example'));
    const project = screen.getByTestId('explorer');
    expect(project).toBeTruthy();
    // ETag is kept now that it is no longer listed.
    await act(async () => screen.getByTestId('response-examples-tab').focus());
    fireEvent.click(screen.getByTestId('examples-open'));
    const view = await screen.findByTestId('example-view');
    expect(within(view).getByTestId('example-headers').textContent).toContain('ETag');
    expect(within(view).getByTestId('example-headers').textContent).not.toContain('Date');
  });
});

describe('Postman collection import (PIGN-028)', () => {
  const postman = (name: string) =>
    readFile(join(import.meta.dirname, '../../fixtures/postman', name)).then(
      (buffer) => new Uint8Array(buffer),
    );

  it('previews a collection, renames it, imports it and writes its files', async () => {
    const { platform, fs } = await fixturePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');

    platform.files.queuePick([
      { name: 'examples.v2.1.json', bytes: await postman('examples.v2.1.json') },
    ]);
    await user.click(screen.getByTestId('explorer-import'));
    const dialog = await screen.findByTestId('import-dialog');
    await within(dialog).findByTestId('import-counts');
    expect(within(dialog).getByTestId('import-format').textContent).toBe(
      'Detected: Postman Collection v2.1',
    );
    expect(within(dialog).getByTestId('import-count-requests').textContent).toBe('1');
    expect(within(dialog).getByTestId('import-count-examples').textContent).toBe('5');
    expect(within(dialog).getByTestId('import-warnings').textContent).toContain(
      '1 item without an id got one.',
    );
    const name = within(dialog).getByTestId('import-name') as HTMLInputElement;
    expect(name.value).toBe('Examples');
    await user.clear(name);
    await user.type(name, 'Imported examples');
    await user.click(within(dialog).getByTestId('import-write'));

    await waitFor(() => expect(screen.queryByTestId('import-dialog')).toBeNull());
    expect(screen.getByTestId('toast').textContent).toMatch(
      /Imported 1 request; wrote \d+ files\./,
    );
    expect(names()).toContain('Imported examples');
    expect(JSON.parse(await fs.readText('pigeon.json')).collections).toEqual([
      'users-api',
      'billing',
      'imported-examples',
    ]);
    expect(await fs.exists('collections/imported-examples/list-users.request.json')).toBe(true);
    expect(await fs.exists('examples/imported-examples/list-users/200-ok.body.json')).toBe(true);
  });

  it('imports as local drafts and rejects v1 files with a clear message', async () => {
    const { platform, fs } = await fixturePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');

    platform.files.queuePick([{ name: 'v1.json', bytes: await postman('v1.json') }]);
    await user.keyboard('{Meta>}o{/Meta}');
    expect((await screen.findByTestId('import-rejected')).textContent).toMatch(
      /Re-export it from Postman as Collection v2\.1/,
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('import-dialog')).toBeNull());

    platform.files.queuePick([{ name: 'auth.v2.1.json', bytes: await postman('auth.v2.1.json') }]);
    await user.click(screen.getByTestId('explorer-import'));
    await user.click(await screen.findByTestId('import-as-drafts'));
    await waitFor(() => expect(screen.queryByTestId('import-dialog')).toBeNull());
    expect(screen.getByTestId('toast').textContent).toBe('Imported 9 requests as local drafts.');
    const row = screen
      .getAllByTestId('explorer-item')
      .find((r) => r.textContent?.includes('Auth types'))!;
    expect(row.getAttribute('data-change')).toBe('created');
    expect(await fs.exists('collections/auth-types/collection.json')).toBe(false);
  });

  it('Welcome → Import Postman file creates a project named after the collection', async () => {
    const platform = createMemoryPlatform({ os: 'macos' });
    platform.files.queuePick([
      { name: 'legacy.v2.0.json', bytes: await postman('legacy.v2.0.json') },
    ]);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('import-postman-file'));
    const dialog = await screen.findByTestId('import-dialog');
    expect(screen.getByTestId('project-tab').textContent).toContain('Legacy v2.0');
    expect((await within(dialog).findByTestId('import-format')).textContent).toBe(
      'Detected: Postman Collection v2.0',
    );
    await user.click(within(dialog).getByTestId('import-write'));
    await waitFor(() => expect(names()).toContain('Legacy v2.0'));
  });
});

describe('Postman collection export (PIGN-029)', () => {
  it('exports a collection and a folder with the chosen options', async () => {
    const { platform } = await fixturePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');

    fireEvent.contextMenu(screen.getByText('Users API'));
    fireEvent.click(await screen.findByTestId('menu-export'));
    const dialog = await screen.findByTestId('export-dialog');
    expect(within(dialog).getByTestId('export-file-name').textContent).toBe(
      'Users API.postman_collection.json',
    );
    fireEvent.click(within(dialog).getByTestId('export-include-metadata'));
    await user.click(within(dialog).getByTestId('export-save'));
    await waitFor(() => expect(screen.queryByTestId('export-dialog')).toBeNull());
    expect(screen.getByTestId('toast').textContent).toBe(
      'Exported Users API.postman_collection.json.',
    );
    const [saved] = platform.files.saved;
    expect(saved).toMatchObject({
      name: 'Users API.postman_collection.json',
      mime: 'application/json',
    });
    const data = JSON.parse(
      typeof saved!.data === 'string' ? saved!.data : new TextDecoder().decode(saved!.data),
    ) as {
      info: { schema: string; name: string };
      item: Array<{ name: string }>;
      _pigeon?: unknown;
    };
    expect(data.info).toMatchObject({
      name: 'Users API',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    });
    expect(data.item.map((item) => item.name)).toEqual(['List users', 'Admin', 'Create user']);
    expect(data._pigeon).toEqual({ 'x-pigeon': 'kept' });

    fireEvent.contextMenu(screen.getByText('Admin'));
    fireEvent.click(await screen.findByTestId('menu-export'));
    await user.click(await screen.findByTestId('export-save'));
    await waitFor(() => expect(platform.files.saved).toHaveLength(2));
    expect(platform.files.saved[1]!.name).toBe('Admin.postman_collection.json');
  });
});

describe('Postman environments import/export (PIGN-030)', () => {
  const postman = (name: string) =>
    readFile(join(import.meta.dirname, '../../fixtures/postman', name)).then(
      (buffer) => new Uint8Array(buffer),
    );

  it('imports a collection and two environments in one confirmation, then exports one', async () => {
    const { platform, fs } = await fixturePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');

    platform.files.queuePick([
      { name: 'auth.v2.1.json', bytes: await postman('auth.v2.1.json') },
      {
        name: 'staging.postman_environment.json',
        bytes: await postman('environments/staging.postman_environment.json'),
      },
      {
        name: 'local.postman_environment.json',
        bytes: await postman('environments/local.postman_environment.json'),
      },
    ]);
    await user.click(screen.getByTestId('explorer-import'));
    const dialog = await screen.findByTestId('import-dialog');
    await within(dialog).findAllByTestId('import-item');
    expect(
      within(dialog)
        .getAllByTestId('import-item')
        .map((item) => item.getAttribute('data-kind')),
    ).toEqual(['collection', 'environment', 'environment']);
    expect(
      within(dialog)
        .getAllByTestId('import-count-secrets')
        .map((c) => c.textContent),
    ).toEqual(['2', '1']);
    fireEvent.click(within(dialog).getByTestId('import-use-current'));
    await user.click(within(dialog).getByTestId('import-write'));
    await waitFor(() => expect(screen.queryByTestId('import-dialog')).toBeNull());
    expect(screen.getByTestId('toast').textContent).toMatch(
      /^Imported 9 requests, 2 environments; wrote \d+ files\.$/,
    );
    const staging = JSON.parse(await fs.readText('environments/staging.postman_environment.json'));
    expect(staging.values.find((v: { key: string }) => v.key === 'token')).toMatchObject({
      value: '',
    });
    expect(await platform.secrets.getAll('project-basic')).toMatchObject({
      'env:5c1a6f3e-staging\u0000token': 'staging-secret-token',
    });

    fireEvent.click(screen.getByTestId('activity-environments'));
    const item = (await screen.findAllByTestId('environment-item')).find((i) =>
      i.textContent?.includes('Staging'),
    )!;
    fireEvent.contextMenu(item);
    fireEvent.click(await screen.findByTestId('env-menu-export'));
    await waitFor(() => expect(platform.files.saved).toHaveLength(1));
    const saved = platform.files.saved[0]!;
    expect(saved.name).toBe('Staging.postman_environment.json');
    const data = JSON.parse(String(saved.data));
    expect(data).toMatchObject({
      name: 'Staging',
      _postman_variable_scope: 'environment',
      _postman_exported_using: expect.stringMatching(/^Pigeon\//),
    });
    expect(JSON.stringify(data)).not.toContain('staging-secret-token');
  });
});

describe('scripts tab (PIGN-031)', () => {
  it('shows, toggles and keeps scripts, and warns on send that they did not run', async () => {
    const transport = new MockTransport().on({ url: /./ }, { body: 'ok' });
    const { platform, fs } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    const listUsers = screen
      .getAllByTestId('explorer-item')
      .find((row) => row.textContent?.includes('List users'))!;
    expect(within(listUsers).getByTestId('explorer-scripts').textContent).toBe('JS');

    await user.dblClick(screen.getByText('List users'));
    expect(screen.getByTestId('scripts-tab-indicator')).toBeTruthy();
    await act(async () => screen.getByTestId('scripts-tab').focus());
    const pre = await screen.findByTestId('script-prerequest');
    expect(screen.getByTestId('scripts-not-run').textContent).toContain(
      'pre-request before each send',
    );
    expect(within(pre).getByTestId('script-prerequest-lines').textContent).toBe('1 line');
    expect((await within(pre).findByTestId('script-prerequest-editor')).textContent).toContain(
      "pm.variables.set('run', 'yes');",
    );
    fireEvent.click(within(pre).getByTestId('script-prerequest-enabled'));
    expect((within(pre).getByTestId('script-prerequest-enabled') as HTMLInputElement).checked).toBe(
      false,
    );

    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    // The collection's test script runs (PIGN-044): nothing is skipped.
    expect((await screen.findByTestId('tests-badge')).textContent).toBe('Tests 1/1');
    expect(screen.getByTestId('response-panel').textContent).not.toContain('were not run');

    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await waitFor(async () =>
      expect(
        JSON.parse(await fs.readText('collections/users-api/list-users.request.json')).event[0],
      ).toMatchObject({ listen: 'prerequest', disabled: true }),
    );
  });

  it('edits collection scripts from the collection settings', async () => {
    const { platform } = await fixturePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    fireEvent.contextMenu(screen.getByText('Billing API'));
    fireEvent.click(await screen.findByTestId('menu-variables'));
    const section = await screen.findByTestId('container-scripts');
    expect(within(section).getByTestId('script-prerequest-lines').textContent).toBe('0 lines');
    expect(
      (within(section).getByTestId('script-prerequest-enabled') as HTMLInputElement).disabled,
    ).toBe(true);
  });
});

describe('GraphQL requests (PIGN-032)', () => {
  it('creates a GraphQL request, validates variables and shows GraphQL errors', async () => {
    const transport = new MockTransport().on(
      { url: /./ },
      {
        headers: [['Content-Type', 'application/json']],
        body: JSON.stringify({
          data: { fail: null },
          errors: [
            { message: 'Intentional failure', path: ['fail'], locations: [{ line: 1, column: 3 }] },
          ],
        }),
      },
    );
    const { platform } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');

    fireEvent.contextMenu(screen.getByText('Billing API'));
    fireEvent.click(await screen.findByTestId('menu-new-graphql'));
    const row = (await screen.findAllByTestId('explorer-item')).find((r) =>
      r.textContent?.includes('New GraphQL Request'),
    )!;
    expect(within(row).getByTestId('explorer-method').textContent).toBe('GQL');
    await act(async () => screen.getByTestId('url-input').focus());
    await user.keyboard('http://localhost:4010/graphql');
    await act(async () => screen.getByTestId('body-tab').focus());
    expect((screen.getByTestId('body-mode-graphql') as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByTestId('graphql-query')).toBeTruthy();

    // Invalid variables: inline error, and sending is blocked.
    fireEvent.change(screen.getByTestId('graphql-operation'), { target: { value: '' } });
    const editor = await screen.findByTestId('graphql-variables');
    setEditorText(editor, '{ broken');
    expect((await screen.findByTestId('graphql-variables-error')).textContent).toMatch(
      /not valid JSON/,
    );
    await user.click(screen.getByTestId('send-button'));
    expect((await screen.findByTestId('response-panel')).textContent).toMatch(/not valid JSON/);
    expect(transport.requests).toHaveLength(0);

    setEditorText(editor, '');
    await waitFor(() => expect(screen.queryByTestId('graphql-variables-error')).toBeNull());
    setEditorText(screen.getByTestId('graphql-query'), '{ fail }');
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    expect(transport.requests[0]!.method).toBe('POST');
    expect(transport.requests[0]!.meta.protocol).toBe('graphql');
    expect((await screen.findByTestId('graphql-errors-chip')).textContent).toBe('errors: 1');
    expect(screen.getByTestId('graphql-errors').textContent).toContain('Intentional failure');
    expect(screen.getByTestId('graphql-errors').textContent).toContain('path: fail · at 1:3');
  });
});

describe('comparison with the baseline (PIGN-034)', () => {
  const USER = { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', active: true };
  const USER_V2 = { id: '1', name: 'Ada Lovelace', active: true, nickname: 'ada' };

  it('compares each response with the saved example and lists the findings', async () => {
    let body = USER;
    const transport = new MockTransport().on({ url: /./ }, () => ({
      headers: [['Content-Type', 'application/json']],
      body: JSON.stringify(body),
    }));
    const { platform } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    await user.dblClick(screen.getByText('List users'));

    await user.click(screen.getByTestId('send-button'));
    await waitFor(() =>
      expect(screen.getByTestId('comparison-badge').getAttribute('data-outcome')).toBe('none'),
    );
    fireEvent.click(screen.getByTestId('comparison-badge'));
    expect((await screen.findByTestId('compare-no-baseline')).textContent).toBe(
      'No baseline — Save as example to start tracking.',
    );

    await user.click(screen.getByTestId('save-as-example'));
    await waitFor(() =>
      expect(screen.getByTestId('comparison-badge').getAttribute('data-outcome')).toBe('pass'),
    );

    body = USER_V2 as never;
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() =>
      expect(screen.getByTestId('comparison-badge').getAttribute('data-outcome')).toBe('fail'),
    );
    fireEvent.click(screen.getByTestId('comparison-badge'));
    expect(screen.getByTestId('compare-outcome').textContent).toBe('Fail');
    expect(screen.getByTestId('compare-counts').textContent).toBe('2 fail · 1 warn · 0 info');
    expect(screen.getByTestId('compare-baseline').textContent).toBe('200 OK');
    const findings = screen.getAllByTestId('compare-finding');
    expect(
      findings.map((f) => [f.getAttribute('data-severity'), f.getAttribute('data-kind')]),
    ).toEqual([
      ['fail', 'body.field.removed'],
      ['fail', 'body.type.changed'],
      ['warn', 'body.field.added'],
    ]);
    expect(findings.map((f) => within(f).getByTestId('compare-finding-path').textContent)).toEqual([
      '$.email',
      '$.id',
      '$.nickname',
    ]);

    // Side by side: − on the baseline, + on the actual, ~ on both.
    fireEvent.click(within(findings[1]!).getByTestId('compare-show-side-by-side'));
    const markers = (pane: string) =>
      within(screen.getByTestId(pane))
        .getAllByTestId('compare-marked-line')
        .map((line) => line.getAttribute('data-marker'));
    expect(markers('compare-baseline-pane').sort()).toEqual(['~', '−']);
    expect(markers('compare-actual-pane').sort()).toEqual(['+', '~']);

    // Show in body: back on the Body tab, Pretty view.
    fireEvent.click(screen.getByTestId('compare-view-findings'));
    fireEvent.click(
      within(screen.getAllByTestId('compare-finding')[2]!).getByTestId('compare-show-in-body'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('response-body-tab').getAttribute('data-state')).toBe('active'),
    );
    expect(screen.getByTestId('response-body-mode').getAttribute('data-mode')).toBe('pretty');

    // The example used is the ★ baseline in the explorer.
    fireEvent.click(screen.getByTestId('explorer-examples-toggle'));
    expect(await screen.findByTestId('explorer-baseline')).toBeTruthy();
  });

  it('can be turned off in Settings', async () => {
    const transport = new MockTransport().on({ url: /./ }, { body: '{}' });
    const { platform } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    fireEvent.click(screen.getByTestId('activity-settings'));
    fireEvent.click(await screen.findByTestId('preference-auto-compare'));
    fireEvent.click(screen.getByTestId('activity-collections'));
    await user.dblClick(await screen.findByText('List users'));
    await user.click(screen.getByTestId('send-button'));
    await screen.findByTestId('response-status');
    expect(screen.queryByTestId('comparison-badge')).toBeNull();
  });
});

describe('field rules (PIGN-035)', () => {
  async function setup() {
    let body: unknown = { id: 1, name: 'Ada', email: 'ada@example.com', meta: { at: 1 } };
    const transport = new MockTransport().on({ url: /./ }, () => ({
      headers: [['Content-Type', 'application/json']],
      body: JSON.stringify(body),
    }));
    const { platform, fs } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    await user.dblClick(screen.getByText('List users'));
    await user.click(screen.getByTestId('send-button'));
    await user.click(await screen.findByTestId('save-as-example'));
    await waitFor(() =>
      expect(screen.getByTestId('comparison-badge').getAttribute('data-outcome')).toBe('pass'),
    );
    const send = async (next: unknown, outcome: string) => {
      body = next;
      await user.click(screen.getByTestId('send-button'));
      await waitFor(() =>
        expect(screen.getByTestId('comparison-badge').getAttribute('data-outcome')).toBe(outcome),
      );
      fireEvent.click(screen.getByTestId('comparison-badge'));
    };
    return { fs, user, send };
  }

  it('Mark optional turns a removed field into a warning and is committed to compare.json', async () => {
    const { fs, user, send } = await setup();
    await send({ id: 1, name: 'Ada', meta: { at: 1 } }, 'fail');
    fireEvent.click(screen.getByTestId('finding-mark-optional'));
    await waitFor(() =>
      expect(screen.getByTestId('comparison-badge').getAttribute('data-outcome')).toBe('warn'),
    );
    expect(screen.getByTestId('compare-finding-message').textContent).toContain('relaxed by rule');
    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await waitFor(async () =>
      expect(JSON.parse(await fs.readText('examples/users-api/list-users/compare.json'))).toEqual({
        pigeonCompare: 1,
        requestId: 'list-users',
        rules: [{ path: '$.email', optional: true }],
      }),
    );
  });

  it('Ignore hides findings below the path until "Show ignored"', async () => {
    const { send } = await setup();
    await send({ id: 1, name: 'Ada', email: 'x', meta: { at: 'now', extra: 1 } }, 'fail');
    fireEvent.click(screen.getAllByTestId('finding-ignore')[0]!);
    await waitFor(() =>
      expect(screen.getByTestId('comparison-badge').getAttribute('data-outcome')).not.toBe('fail'),
    );
    const toggle = await screen.findByTestId('compare-show-ignored');
    expect(toggle.parentElement?.textContent).toMatch(/Show ignored \(\d\)/);
    const before = screen.queryAllByTestId('compare-finding').length;
    fireEvent.click(toggle);
    expect(screen.getAllByTestId('compare-finding').length).toBeGreaterThan(before);
  });

  it('rejects invalid rule paths inline and applies project rules from Settings', async () => {
    const { user, send } = await setup();
    await send({ id: 1, name: 'Ada', meta: { at: 1 } }, 'fail');
    const panel = screen.getByTestId('compare-rules');
    fireEvent.click(within(panel).getByText(/Rules \(/));
    const path = within(panel).getByTestId('rule-new-path');
    await act(async () => path.focus());
    await user.keyboard('email');
    expect(within(panel).getByTestId('rule-new-path-error').textContent).toMatch(/starts with \$/);
    expect((within(panel).getByTestId('rule-add') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(panel).getByTestId('edit-project-rules'));
    const settings = await screen.findByTestId('project-comparison-settings');
    const newPath = within(settings).getByTestId('rule-new-path');
    await act(async () => newPath.focus());
    await user.keyboard('$..email');
    fireEvent.click(within(settings).getByTestId('rule-add'));
    fireEvent.click(within(settings).getByTestId('rule-optional'));
    fireEvent.click(within(settings).getByTestId('rule-ignore'));
    fireEvent.click(screen.getByTestId('activity-collections'));
    await send({ id: 1, name: 'Ada', meta: { at: 1 } }, 'pass');
  });
});

describe('status, headers and values comparison (PIGN-036)', () => {
  it('shows status and header findings and switches a request to values mode', async () => {
    let reply = { status: 200, body: { name: 'Ada', updatedAt: '2026-01-01T00:00:00Z' } };
    const transport = new MockTransport().on({ url: /./ }, () => ({
      status: reply.status,
      headers: [['Content-Type', 'application/json']],
      body: JSON.stringify(reply.body),
    }));
    const { platform, fs } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    await user.dblClick(screen.getByText('List users'));
    await user.click(screen.getByTestId('send-button'));
    await user.click(await screen.findByTestId('save-as-example'));
    const badge = () => screen.getByTestId('comparison-badge').getAttribute('data-outcome');
    await waitFor(() => expect(badge()).toBe('pass'));

    reply = { status: 201, body: { name: 'Grace', updatedAt: '2026-11-20T00:00:00Z' } };
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(badge()).toBe('fail'));
    fireEvent.click(screen.getByTestId('comparison-badge'));
    expect(screen.getByRole('region', { name: 'Status' }).textContent).toContain(
      'Status changed: 200 → 201',
    );

    // Per-request overrides: status by class, body by values.
    const panel = screen.getByTestId('compare-rules');
    fireEvent.click(within(panel).getByText(/Rules \(/));
    fireEvent.change(within(panel).getByTestId('override-status'), { target: { value: 'class' } });
    fireEvent.change(within(panel).getByTestId('override-body-mode'), {
      target: { value: 'values' },
    });
    await waitFor(() =>
      expect(
        screen.getAllByTestId('compare-finding').map((f) => f.getAttribute('data-kind')),
      ).toEqual(['body.value.changed', 'body.value.changed']),
    );
    expect(screen.getAllByTestId('finding-mark-dynamic').map((b) => b.textContent)).toEqual([
      'Mark as dynamic?',
      'Mark dynamic',
    ]);
    fireEvent.click(screen.getAllByTestId('finding-mark-dynamic')[0]!);
    await waitFor(() => expect(screen.getAllByTestId('compare-finding')).toHaveLength(1));
    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await waitFor(async () =>
      expect(JSON.parse(await fs.readText('examples/users-api/list-users/compare.json'))).toEqual({
        pigeonCompare: 1,
        requestId: 'list-users',
        status: 'class',
        body: { mode: 'values' },
        rules: [{ path: '$.updatedAt', dynamic: true }],
      }),
    );
  });
});

describe('accepting baselines (PIGN-037)', () => {
  async function setup() {
    let reply = { status: 200, body: { id: 1, name: 'Ada' } as unknown };
    const transport = new MockTransport().on({ url: /./ }, () => ({
      status: reply.status,
      headers: [['Content-Type', 'application/json']],
      body: JSON.stringify(reply.body),
    }));
    const { platform, fs } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    await user.dblClick(screen.getByText('List users'));
    await user.click(screen.getByTestId('send-button'));
    await user.click(await screen.findByTestId('save-as-example'));
    const badge = () => screen.getByTestId('comparison-badge').getAttribute('data-outcome');
    await waitFor(() => expect(badge()).toBe('pass'));
    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain('Wrote'));
    const send = async (status: number, body: unknown, outcome: string) => {
      reply = { status, body };
      await user.click(screen.getByTestId('send-button'));
      await waitFor(() => expect(badge()).toBe(outcome));
    };
    return { fs, user, send, badge };
  }

  it('accepts the response as the new baseline after confirmation; discard brings the old one back', async () => {
    const { fs, user, send, badge } = await setup();
    await send(200, { id: 1, fullName: 'Ada' }, 'fail');
    fireEvent.click(screen.getByTestId('comparison-badge'));
    fireEvent.click(screen.getByTestId('compare-accept'));
    const dialog = await screen.findByTestId('accept-dialog');
    expect(within(dialog).getByTestId('accept-findings').textContent).toContain('$.name');
    fireEvent.click(within(dialog).getByTestId('accept-confirm'));
    await waitFor(() => expect(badge()).toBe('pass'));

    // Discard the request's changes (the accepted example): the old baseline fails again.
    fireEvent.contextMenu(screen.getAllByText('List users')[0]!);
    fireEvent.click(await screen.findByTestId('menu-discard'));
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(badge()).toBe('fail'));
    expect(await fs.readText('examples/users-api/list-users/200-ok.body.json')).toContain('"name"');
  });

  it('pins, disables and re-enables the baseline; saves a new example with a unique name', async () => {
    const { send, badge } = await setup();
    await send(404, { error: 'nope' }, 'fail');
    fireEvent.click(screen.getByTestId('comparison-badge'));
    fireEvent.click(screen.getByTestId('compare-save-example'));
    await waitFor(() => expect(badge()).toBe('pass')); // auto picks the new 404 example
    expect(screen.getByTestId('compare-baseline').textContent).toBe('404 Not Found');

    await send(200, { id: 1, name: 'Ada' }, 'pass'); // auto: the 200 example
    fireEvent.click(screen.getByTestId('comparison-badge'));
    const select = screen.getByTestId('compare-baseline-mode') as HTMLSelectElement;
    const pin404 = [...select.options].find((o) => o.textContent === 'Pin: 404 Not Found')!;
    fireEvent.change(select, { target: { value: pin404.value } });
    await waitFor(() => expect(badge()).toBe('fail'));
    expect(screen.getAllByTestId('compare-finding')[0]!.getAttribute('data-kind')).toBe(
      'status.changed',
    );

    fireEvent.change(screen.getByTestId('compare-baseline-mode'), { target: { value: 'none' } });
    await waitFor(() => expect(badge()).toBe('disabled'));
    fireEvent.click(await screen.findByTestId('compare-enable'));
    await waitFor(() => expect(badge()).toBe('pass'));

    // A second "200 OK" example gets a unique name.
    fireEvent.click(screen.getByTestId('compare-save-example'));
    await act(async () => screen.getByTestId('response-examples-tab').focus());
    const names = () =>
      screen.getAllByTestId('examples-list-item').map((li) => li.textContent?.replace('★', ''));
    await waitFor(() => expect(names()).toContain('200200 OK (2)'));
  });

  it('pins an example from the explorer menu and marks it with ★', async () => {
    const { send } = await setup();
    await send(404, { error: 'nope' }, 'fail');
    fireEvent.click(screen.getByTestId('comparison-badge'));
    fireEvent.click(screen.getByTestId('compare-save-example'));
    fireEvent.click(screen.getByTestId('explorer-examples-toggle'));
    const row = (name: string) =>
      screen.getAllByTestId('explorer-item').find((r) => r.textContent?.includes(name))!;
    await waitFor(() => expect(row('404 Not Found')).toBeTruthy());
    fireEvent.contextMenu(row('404 Not Found'));
    fireEvent.click(await screen.findByTestId('menu-pin-baseline'));
    await waitFor(() =>
      expect(within(row('404 Not Found')).queryByTestId('explorer-baseline')).not.toBeNull(),
    );
    expect(within(row('200 OK')).queryByTestId('explorer-baseline')).toBeNull();
  });
});

describe('regression runs (PIGN-038)', () => {
  it('runs a collection, opens a row, accepts selected baselines, re-runs and exports', async () => {
    let reply: unknown = { id: 1, name: 'Ada' };
    const transport = new MockTransport().on({ url: /./ }, () => ({
      headers: [['Content-Type', 'application/json']],
      body: JSON.stringify(reply),
    }));
    const { platform } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    await user.dblClick(screen.getByText('List users'));
    await user.click(screen.getByTestId('send-button'));
    await user.click(await screen.findByTestId('save-as-example'));
    await waitFor(() =>
      expect(screen.getByTestId('comparison-badge').getAttribute('data-outcome')).toBe('pass'),
    );

    reply = { id: 1, fullName: 'Ada' };
    fireEvent.contextMenu(screen.getByText('Users API'));
    fireEvent.click(await screen.findByTestId('menu-run'));
    const dialog = await screen.findByTestId('run-dialog');
    expect((within(dialog).getByTestId('run-scope') as HTMLSelectElement).value).toBe(
      'users-collection',
    );
    fireEvent.click(within(dialog).getByTestId('run-start'));

    const rows = () => screen.getAllByTestId('run-row');
    await waitFor(() =>
      expect(screen.getByTestId('run-status').getAttribute('data-status')).toBe('done'),
    );
    expect(tabNames()).toContain('Runner');
    expect(rows().map((row) => within(row).getByTestId('run-row-name').textContent)).toEqual([
      'List users',
      'Admin / Delete user',
      'Admin / Nested / Get audit log',
      'Create user',
    ]);
    expect(rows().map((row) => row.getAttribute('data-outcome'))).toEqual([
      'fail',
      // The collection's test script ("users") runs and passes (PIGN-044).
      'pass',
      'pass',
      'error',
    ]);
    // Create user posts a body file that isn't in the project.
    expect(rows()[3]!.querySelector('[title]')?.getAttribute('title')).toBe(
      'The project file "fixtures/avatar.png" cannot be read.',
    );
    expect(screen.getByTestId('run-total-fail').textContent).toBe('1 fail');
    expect(screen.getByTestId('run-total-error').textContent).toBe('1 error');
    expect(transport.requests).toHaveLength(4);

    // A row opens the request with the run's result and comparison.
    fireEvent.click(within(rows()[0]!).getByTestId('run-row-name'));
    await waitFor(() =>
      expect(screen.getByTestId('comparison-badge').getAttribute('data-outcome')).toBe('fail'),
    );
    expect(transport.requests).toHaveLength(4);

    // Accept selected as baselines, then the re-run passes.
    fireEvent.click(screen.getByText('Runner'));
    fireEvent.click(await screen.findByTestId('run-row-select'));
    fireEvent.click(screen.getByTestId('run-accept'));
    expect(await screen.findByTestId('run-accepted')).toBeTruthy();
    fireEvent.click(screen.getByTestId('run-again'));
    await waitFor(() => expect(transport.requests).toHaveLength(7));
    await waitFor(() =>
      expect(screen.getByTestId('run-status').getAttribute('data-status')).toBe('done'),
    );
    expect(rows()[0]!.getAttribute('data-outcome')).toBe('pass');

    fireEvent.click(screen.getByTestId('run-export'));
    await waitFor(() => expect(platform.files.saved).toHaveLength(1));
    const saved = platform.files.saved[0]!;
    expect(saved.name).toMatch(/^run-Users-API-.*\.json$/);
    const report = JSON.parse(saved.data as string);
    expect(report).toMatchObject({
      pigeonRunReport: 1,
      scope: { kind: 'collection', id: 'users-collection', name: 'Users API' },
      totals: { pass: 3, error: 1 },
    });

    // Both runs are listed in the Runner view; the older one opens as a stored report.
    await user.click(screen.getByTestId('activity-runner'));
    const reports = await screen.findAllByTestId('runner-report');
    expect(reports).toHaveLength(2);
    fireEvent.click(reports[1]!);
    await waitFor(() => expect(rows()[0]!.getAttribute('data-outcome')).toBe('fail'));
    expect(screen.queryByTestId('run-accept')).toBeNull();
  });
});

describe('long regression runs (PIGN-038)', () => {
  it('runs 200 requests while the event loop keeps running', async () => {
    const transport = new MockTransport().on({ url: /./ }, () => ({
      headers: [['Content-Type', 'application/json']],
      body: '{"ok":true}',
    }));
    const { platform } = await fixturePlatform(transport);
    const appStore = createAppStore(platform);
    render(<PigeonApp platform={platform} appStore={appStore} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    const session = appStore.getState().project!.session;
    act(() => {
      session.apply({ type: 'createCollection', id: 'many', name: 'Many' });
      for (let i = 0; i < 200; i++) {
        session.apply({
          type: 'createRequest',
          id: `many-${i}`,
          parentId: 'many',
          name: `Request ${i}`,
          request: {
            url: { raw: `http://api.test/${i}`, query: [], pathVariables: [], extra: {} },
          },
        });
      }
    });

    // Timer ticks keep arriving during the run (the run yields between requests).
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 0);
    fireEvent.contextMenu(await screen.findByText('Many'));
    fireEvent.click(await screen.findByTestId('menu-run'));
    fireEvent.click(await screen.findByTestId('run-start'));
    await waitFor(
      () => expect(screen.getByTestId('run-status').getAttribute('data-status')).toBe('done'),
      { timeout: 30_000 },
    );
    clearInterval(timer);
    expect(screen.getAllByTestId('run-row')).toHaveLength(200);
    expect(screen.getByTestId('run-total-no-baseline').textContent).toBe('200 no baseline');
    expect(ticks).toBeGreaterThan(50);
  }, 60_000);
});

describe('app commands from the desktop menus (PIGN-041)', () => {
  it('toggles the sidebar and the response layout, opens help, adds and closes', async () => {
    const { platform } = await fixturePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    act(() => runAppCommand('new-request'));
    expect((await screen.findByTestId('toast')).textContent).toContain('Open or create a project');

    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    act(() => runAppCommand('toggle-sidebar'));
    expect(screen.queryByTestId('sidebar')).toBeNull();
    act(() => runAppCommand('toggle-sidebar'));
    expect(screen.getByTestId('sidebar')).toBeTruthy();

    act(() => runAppCommand('new-request'));
    await waitFor(() => expect(tabNames()).toEqual(['New Request']));
    const split = () => screen.getByTestId('request-response-split').getAttribute('data-dock');
    expect(split()).toBe('bottom');
    act(() => runAppCommand('toggle-response-layout'));
    expect(split()).toBe('right');

    act(() => runAppCommand('web-limitations'));
    expect(await screen.findByTestId('web-limitations')).toBeTruthy();
    fireEvent.click(screen.getByTestId('web-limitations-close'));

    act(() => runAppCommand('close-project'));
    expect(await screen.findByTestId('welcome')).toBeTruthy();
  });
});

describe('command palette and quick open (PIGN-042)', () => {
  it('lists available commands, runs one, and quick-opens a request', async () => {
    const { platform } = await fixturePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');

    await user.keyboard('{Meta>}k{/Meta}');
    const palette = await screen.findByTestId('command-palette');
    expect(palette.getAttribute('data-mode')).toBe('commands');
    const titles = () =>
      within(palette)
        .getAllByTestId('palette-command')
        .map((row) => row.textContent);
    expect(titles().some((t) => t?.includes('Save for Commit'))).toBe(true);
    expect(titles().some((t) => t?.includes('Command palette'))).toBe(false);
    await user.type(within(palette).getByTestId('palette-input'), 'togglelayout');
    expect(titles()[0]).toContain('Toggle response layout');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByTestId('command-palette')).toBeNull());

    await user.keyboard('{Meta>}p{/Meta}');
    const quick = await screen.findByTestId('command-palette');
    expect(quick.getAttribute('data-mode')).toBe('files');
    await user.type(within(quick).getByTestId('palette-input'), 'audit');
    const first = within(quick).getAllByTestId('quick-open-item')[0]!;
    expect(first.textContent).toContain('Get audit log');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(tabNames()).toContain('Get audit log'));
    expect(screen.getByTestId('request-response-split').getAttribute('data-dock')).toBe('right');

    // Settings → Keyboard lists the bindings for this platform (macOS here).
    await user.click(screen.getByTestId('activity-settings'));
    const rows = await screen.findAllByTestId('keyboard-binding');
    const save = rows.find((row) => row.getAttribute('data-command') === 'file.saveForCommit');
    expect(save?.textContent).toContain('⇧⌘S');
  });
});

describe('accessibility (PIGN-042)', () => {
  it('the tree announces the current row and request tabs work from the keyboard', async () => {
    const { platform } = await fixturePlatform();
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    await user.dblClick(screen.getByText('List users'));
    await user.dblClick(screen.getByText('Pay invoice'));

    const tree = screen.getByRole('tree', { name: 'Collections' });
    const current = tree.getAttribute('aria-activedescendant');
    expect(current && document.getElementById(current)?.textContent).toContain('Pay invoice');

    const tabs = screen.getAllByTestId('request-tab');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    act(() => tabs[1]!.focus());
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(tabs[0]!.getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(tabs[0]);
  });
});

describe('pre-request scripts (PIGN-043)', () => {
  it('runs them on send, shows console output, stops on errors and can be turned off', async () => {
    const transport = new MockTransport().on({ url: /./ }, { body: 'ok' });
    const { platform } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    await user.dblClick(screen.getByText('List users'));
    await act(async () => screen.getByTestId('scripts-tab').focus());
    const editor = await within(await screen.findByTestId('script-prerequest')).findByTestId(
      'script-prerequest-editor',
    );
    setEditorText(
      editor,
      "pm.variables.set('run', 'yes');\npm.request.headers.add({ key: 'X-Script', value: pm.variables.get('run') });\nconsole.log('signed', pm.info.requestName);",
    );

    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(1), { timeout: 10_000 });
    expect(transport.requests[0]!.headers).toContainEqual(['X-Script', 'yes']);
    expect(await screen.findByTestId('response-console-count')).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId('response-console-tab'));
    await act(async () => screen.getByTestId('response-console-tab').focus());
    const entry = await screen.findByTestId('console-entry');
    expect(entry.textContent).toContain('signed List users');
    expect(entry.textContent).toContain('this request');

    setEditorText(editor, "throw new Error('boom');");
    await user.click(screen.getByTestId('send-button'));
    const error = await screen.findByTestId('response-error', {}, { timeout: 10_000 });
    expect(error.getAttribute('data-kind')).toBe('script');
    expect(error.textContent).toContain('Pre-request script error in this request: boom');
    expect(transport.requests).toHaveLength(1);

    await user.click(screen.getByTestId('activity-settings'));
    await user.click(await screen.findByTestId('preference-run-scripts'));
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(2));
    expect(transport.requests[1]!.headers.some(([name]) => name === 'X-Script')).toBe(false);
    expect((await screen.findByTestId('response-panel')).textContent).toContain(
      'Scripts were not run (script execution is off for this project)',
    );
  }, 30_000);
});

describe('test scripts (PIGN-044)', () => {
  it('shows results in the Tests tab and badge, and per request in runs', async () => {
    const transport = new MockTransport().on(
      { url: /./ },
      { headers: [['Content-Type', 'application/json']], body: '{"id":1}' },
    );
    const { platform } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    await user.dblClick(screen.getByText('List users'));
    await act(async () => screen.getByTestId('scripts-tab').focus());
    const editor = await within(await screen.findByTestId('script-test')).findByTestId(
      'script-test-editor',
    );
    setEditorText(
      editor,
      "pm.test('has id', () => pm.expect(pm.response.json()).to.have.property('id', 1));\npm.test('is 201', () => pm.response.to.have.status(201));",
    );
    await user.click(screen.getByTestId('send-button'));
    const badge = await screen.findByTestId('tests-badge', {}, { timeout: 10_000 });
    // The collection's test ("users") plus the two of the request.
    expect(badge.textContent).toBe('Tests 2/3');
    expect(badge.getAttribute('data-outcome')).toBe('fail');
    fireEvent.click(badge);
    const results = await screen.findAllByTestId('test-result');
    expect(results.map((r) => r.getAttribute('data-outcome'))).toEqual(['pass', 'pass', 'fail']);
    expect(results[2]!.textContent).toContain('expected response to have status 201 but got 200');

    fireEvent.contextMenu(screen.getByText('Users API'));
    fireEvent.click(await screen.findByTestId('menu-run'));
    fireEvent.click(within(await screen.findByTestId('run-dialog')).getByTestId('run-start'));
    await waitFor(
      () => expect(screen.getByTestId('run-status').getAttribute('data-status')).toBe('done'),
      { timeout: 15_000 },
    );
    const row = screen.getAllByTestId('run-row')[0]!;
    expect(row.getAttribute('data-outcome')).toBe('fail');
    expect(within(row).getByTestId('run-row-tests').textContent).toBe('2/3 tests');
    expect(within(row).getByTestId('run-row-tests').getAttribute('title')).toContain('is 201');
  }, 30_000);
});

describe('cookie jar (PIGN-045)', () => {
  it('stores Set-Cookie, sends it next time, lists it, and the manager deletes it', async () => {
    const transport = new MockTransport().on({ url: /./ }, (req) =>
      req.url.includes('/login')
        ? { headers: [['Set-Cookie', 'session=abc; Path=/']], body: 'ok' }
        : { body: 'ok' },
    );
    const { platform } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    await user.dblClick(screen.getByText('Get invoices'));
    const url = await screen.findByTestId('url-input');
    fireEvent.change(url, { target: { value: 'https://billing.example.test/login' } });
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    fireEvent.mouseDown(await screen.findByTestId('response-cookies-tab'));
    await act(async () => screen.getByTestId('response-cookies-tab').focus());
    expect((await screen.findByTestId('response-cookie')).textContent).toContain('session');

    fireEvent.change(url, { target: { value: 'https://billing.example.test/invoices' } });
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(2));
    expect(transport.requests[1]!.headers).toContainEqual(['Cookie', 'session=abc']);

    await act(async () => screen.getByTestId('response-cookies-tab').focus());
    fireEvent.click(await screen.findByTestId('cookies-manage'));
    const manager = await screen.findByTestId('cookie-manager');
    const row = within(manager).getByTestId('cookie-row');
    expect(row.textContent).toContain('session');
    expect(within(manager).getByTestId('cookie-domain').textContent).toContain(
      'billing.example.test',
    );
    fireEvent.click(within(row).getByTestId('cookie-delete'));
    expect(within(manager).queryByTestId('cookie-row')).toBeNull();
    fireEvent.keyDown(manager, { key: 'Escape' });

    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(3));
    expect(transport.requests[2]!.headers.some(([name]) => name === 'Cookie')).toBe(false);
  });
});

describe('Digest and AWS Signature auth (PIGN-046)', () => {
  it('answers a Digest challenge and signs AWS requests from the Auth tab', async () => {
    const transport = new MockTransport().on({ url: /./ }, (req) => {
      const authorization = req.headers.find(([n]) => n === 'Authorization')?.[1];
      if (!authorization) {
        return {
          status: 401,
          headers: [['WWW-Authenticate', 'Digest realm="r", qop="auth", nonce="n1"']],
          body: '',
        };
      }
      return { body: 'ok' };
    });
    const { platform } = await fixturePlatform(transport);
    render(<PigeonApp platform={platform} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-folder'));
    await screen.findByTestId('explorer');
    await user.dblClick(screen.getByText('Get invoices'));
    await act(async () => screen.getByTestId('auth-tab').focus());
    fireEvent.change(await screen.findByTestId('auth-type'), { target: { value: 'digest' } });
    fireEvent.change(screen.getByTestId('auth-username'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByTestId('auth-password'), { target: { value: 'pw' } });
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(2));
    const digest = transport.requests[1]!.headers.find(([n]) => n === 'Authorization')![1];
    expect(digest).toMatch(/^Digest username="ada", realm="r", nonce="n1", uri="\/invoices/);
    expect(digest).toMatch(/qop=auth, nc=00000001, cnonce="[0-9a-f]+", response="[0-9a-f]{32}"/);

    fireEvent.change(screen.getByTestId('auth-type'), { target: { value: 'awsv4' } });
    fireEvent.change(screen.getByTestId('auth-access-key'), { target: { value: 'AKID' } });
    fireEvent.change(screen.getByTestId('auth-secret-key'), { target: { value: 'secret' } });
    fireEvent.change(screen.getByTestId('auth-region'), { target: { value: 'eu-west-1' } });
    fireEvent.change(screen.getByTestId('auth-service'), { target: { value: 'execute-api' } });
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(transport.requests).toHaveLength(3));
    const headers = transport.requests[2]!.headers;
    expect(headers.find(([n]) => n === 'Authorization')![1]).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/eu-west-1\/execute-api\/aws4_request, SignedHeaders=host;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(headers.some(([n]) => n === 'X-Amz-Date')).toBe(true);
  });
});
