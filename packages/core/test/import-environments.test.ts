import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MemoryAppState, MemoryFs, MemorySecretStore } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import {
  applyImport,
  importContext,
  initializeProject,
  previewImportFiles,
  ProjectSession,
  withBaseUrlVariable,
} from '../src/index';

const postman = join(import.meta.dirname, '../../fixtures/postman');
const apidog = join(import.meta.dirname, '../../fixtures/apidog');
const file = (path: string) => ({
  name: path.split('/').at(-1)!,
  bytes: new Uint8Array(readFileSync(join(postman, path))),
});

async function emptySession() {
  const fs = new MemoryFs();
  await initializeProject(fs, 'Envs');
  const secrets = new MemorySecretStore();
  const session = await ProjectSession.fromFs(fs, { appState: new MemoryAppState(), secrets });
  return { fs, secrets, session };
}

describe('importing environments and globals (PIGN-030)', () => {
  it('previews a collection and two environments together and commits them', async () => {
    const { fs, secrets, session } = await emptySession();
    const items = previewImportFiles(
      [
        file('examples.v2.1.json'),
        file('environments/staging.postman_environment.json'),
        file('environments/local.postman_environment.json'),
        file('environments/workspace.postman_globals.json'),
      ],
      importContext(session.getWorkingModel()),
    );
    expect(items.map((item) => [item.kind, item.fileName])).toEqual([
      ['collection', 'examples.v2.1.json'],
      ['environment', 'staging.postman_environment.json'],
      ['environment', 'local.postman_environment.json'],
      ['globals', 'workspace.postman_globals.json'],
    ]);
    const ids = applyImport(session, items, { useAsCurrentValues: true });
    const { plan } = await session.saveForCommit(ids);
    expect(plan.writes.map((w) => w.path)).toEqual(
      expect.arrayContaining([
        'environments/staging.postman_environment.json',
        'environments/local.postman_environment.json',
        'environments/globals.postman_globals.json',
        'collections/examples/collection.json',
      ]),
    );
    const staging = JSON.parse(await fs.readText('environments/staging.postman_environment.json'));
    expect(staging).toEqual({
      id: '5c1a6f3e-staging',
      name: 'Staging',
      values: [
        { key: 'baseUrl', value: 'https://staging.example.test', type: 'default', enabled: true },
        { key: 'token', value: '', type: 'secret', enabled: true },
        { key: 'emptySecret', value: '', type: 'secret', enabled: true },
        { key: 'debug', value: 'true', type: 'default', enabled: false },
        { key: 'timeout', value: '30', type: 'text', enabled: true, description: 'seconds' },
        { key: 'x', value: '1', type: 'default', enabled: true, 'x-var': 'kept' },
      ],
      color: '#ff0000',
      _postman_variable_scope: 'environment',
    });
    // Secret values never reach a project file; they are this machine's current values.
    for (const entry of await fs.list('', { recursive: true })) {
      if (entry.kind !== 'file') continue;
      const text = await fs.readText(entry.path);
      for (const secret of ['staging-secret-token', 'local-key', 'g-secret']) {
        expect(text, entry.path).not.toContain(secret);
      }
    }
    expect(session.currentValues('env:5c1a6f3e-staging')['token']).toBe('staging-secret-token');
    expect(Object.values(await secrets.getAll(session.localKey))).toEqual(
      expect.arrayContaining(['staging-secret-token', 'local-key', 'g-secret']),
    );
    expect(session.getWorkingModel().globals?.values.map((v) => v.key)).toEqual([
      'userAgent',
      'globalSecret',
    ]);
  });

  it('without "use as current values", imported values stay shared only', async () => {
    const { session } = await emptySession();
    const items = previewImportFiles(
      [file('environments/staging.postman_environment.json')],
      importContext(session.getWorkingModel()),
    );
    applyImport(session, items);
    expect(session.currentValues('env:5c1a6f3e-staging')).toEqual({});
  });

  it('a name collision adds "Staging (2)" or replaces the existing variables', async () => {
    const { session } = await emptySession();
    session.apply({
      type: 'createEnvironment',
      id: 'mine',
      name: 'staging',
      values: [{ key: 'old', value: '1', type: 'default', enabled: true }],
    });
    const staging = file('environments/staging.postman_environment.json');
    const items = previewImportFiles([staging], importContext(session.getWorkingModel()));
    expect(items[0]).toMatchObject({ collidesWith: { id: 'mine', name: 'staging' } });
    applyImport(session, items, { onCollision: 'keep-both' });
    expect(session.getWorkingModel().environments.map((e) => e.name)).toEqual([
      'staging',
      'Staging (2)',
    ]);

    const again = previewImportFiles([staging], importContext(session.getWorkingModel()));
    applyImport(session, again, { onCollision: 'replace' });
    const environments = session.getWorkingModel().environments;
    expect(environments).toHaveLength(2);
    expect(environments.find((e) => e.id === 'mine')!.values.map((v) => v.key)).toContain('token');
  });

  it('lists unsupported files as rejected next to the importable ones', () => {
    const items = previewImportFiles([file('v1.json'), { name: 'notes.txt', bytes: 'hello' }], {
      usedIds: new Set(),
      environments: [],
    });
    expect(items).toEqual([
      expect.objectContaining({ kind: 'rejected', format: 'Postman Collection v1' }),
      expect.objectContaining({
        kind: 'rejected',
        message: 'The file is not valid JSON or a cURL command.',
      }),
    ]);
  });
});

describe('importing Apidog environments (PIGN-048)', () => {
  const apidogFile = (name: string) => ({
    name,
    bytes: new Uint8Array(readFileSync(join(apidog, name))),
  });

  it('previews, renames the base URL variable and writes the environment without secrets', async () => {
    const { fs, secrets, session } = await emptySession();
    const previewed = previewImportFiles(
      [apidogFile('project-export.apidog.json')],
      importContext(session.getWorkingModel()),
    );
    expect(previewed).toHaveLength(1);
    expect(previewed[0]).toMatchObject({
      kind: 'environment',
      format: 'Apidog project export (format 1.2.0)',
      fileWarnings: [expect.stringContaining('its APIs are not')],
    });
    const items = withBaseUrlVariable(previewed, 'host');
    const ids = applyImport(session, items, { useAsCurrentValues: true });
    await session.saveForCommit(ids);
    const written = JSON.parse(
      await fs.readText('environments/wallet-local.postman_environment.json'),
    );
    expect(written.name).toBe('Wallet Local');
    expect(written.values.slice(0, 3)).toEqual([
      {
        key: 'host',
        value: 'http://localhost:3000',
        type: 'default',
        enabled: true,
        description: 'Base URL from Apidog',
      },
      {
        key: 'host_1523599',
        value: 'http://localhost:3100',
        type: 'default',
        enabled: true,
        description: 'Base URL of the Apidog service “1523599”',
      },
      { key: 'apiKey', value: '', type: 'secret', enabled: true },
    ]);
    for (const entry of await fs.list('', { recursive: true })) {
      if (entry.kind !== 'file') continue;
      const text = await fs.readText(entry.path);
      for (const secret of ['example-api-key-1111', 'example-webhook-secret-3333']) {
        expect(text, entry.path).not.toContain(secret);
      }
    }
    const id = session.getWorkingModel().environments[0]!.id;
    expect(session.currentValues(`env:${id}`)).toMatchObject({
      host: 'http://localhost:3000',
      apiKey: 'example-api-key-1111',
    });
    expect(Object.values(await secrets.getAll(session.localKey))).toEqual(
      expect.arrayContaining(['example-api-key-1111', 'example-admin-key-2222']),
    );
  });

  it('flags a name collision with an existing environment', async () => {
    const { session } = await emptySession();
    session.apply({ type: 'createEnvironment', id: 'mine', name: 'Wallet Local', values: [] });
    const items = previewImportFiles(
      [apidogFile('environment-export.apidog.json')],
      importContext(session.getWorkingModel()),
    );
    expect(items[0]).toMatchObject({
      format: 'Apidog environment export',
      collidesWith: { id: 'mine', name: 'Wallet Local' },
    });
  });
});
