import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectFileSystem } from '@pigeon/platform';
import { MemoryAppState, MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { ProjectEnvVariable } from '../src/index';
import {
  buildScopes,
  describeVariable,
  GLOBALS_ENTITY_ID,
  ProjectSession,
  resolveString,
} from '../src/index';

const fixtureDirectory = join(import.meta.dirname, '../../fixtures/projects/basic');

async function copyInto(fs: ProjectFileSystem, local: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await copyInto(fs, join(local, entry.name), path);
    else await fs.writeFileAtomic(path, new Uint8Array(await readFile(join(local, entry.name))));
  }
}

const v = (
  key: string,
  value: string,
  extra: Partial<ProjectEnvVariable> = {},
): ProjectEnvVariable => ({
  key,
  value,
  type: '',
  enabled: true,
  ...extra,
});

async function open() {
  const fs = new MemoryFs();
  await copyInto(fs, fixtureDirectory);
  const session = await ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
  // Fixture: users-api has collection variable baseUrl = https://api.example.test.
  session.apply({
    type: 'setGlobals',
    values: [v('baseUrl', 'http://globals'), v('g', 'global-only', { type: 'default' })],
  });
  session.apply({ type: 'setContainerVariables', id: 'admin-folder', values: [v('who', 'admin')] });
  session.apply({
    type: 'setContainerVariables',
    id: 'nested-folder',
    values: [v('who', 'nested')],
  });
  session.apply({
    type: 'createEnvironment',
    id: 'env',
    name: 'Local',
    values: [v('baseUrl', 'http://env', { type: 'default' })],
  });
  return { fs, session };
}

const scopesFor = (session: ProjectSession, itemId: string, environmentId: string | null = 'env') =>
  buildScopes(session.getWorkingModel(), {
    environmentId,
    itemId,
    currentValues: (key) => session.currentValues(key),
  });

describe('scope precedence (PIGN-024)', () => {
  it('environment > folders (nearest first) > collection > globals', async () => {
    const { session } = await open();
    expect(resolveString('{{baseUrl}}', scopesFor(session, 'list-users')).value).toBe('http://env');
    expect(resolveString('{{baseUrl}}', scopesFor(session, 'list-users', null)).value).toBe(
      'https://api.example.test',
    );
    expect(resolveString('{{baseUrl}}', scopesFor(session, 'get-invoices', null)).value).toBe(
      'http://globals',
    );
    expect(resolveString('{{who}}', scopesFor(session, 'get-audit')).value).toBe('nested');
    expect(resolveString('{{who}}', scopesFor(session, 'delete-user')).value).toBe('admin');
    expect(resolveString('{{who}}', scopesFor(session, 'list-users')).unresolved).toEqual(['who']);
    expect(resolveString('{{g}}', scopesFor(session, 'get-audit')).value).toBe('global-only');

    session.setCurrentValue('collection:users-collection', 'baseUrl', 'http://current');
    expect(resolveString('{{baseUrl}}', scopesFor(session, 'list-users', null)).value).toBe(
      'http://current',
    );
    session.setCurrentValue('globals', 'g', 'local-g');
    expect(resolveString('{{g}}', scopesFor(session, 'list-users')).value).toBe('local-g');
  });

  it('reports shadowed scopes for tooltips', async () => {
    const { session } = await open();
    expect(describeVariable('baseUrl', scopesFor(session, 'list-users'))).toMatchObject({
      scopeName: 'Local',
      shadowed: ['collection Users API', 'globals Globals'],
    });
    expect(describeVariable('g', scopesFor(session, 'list-users')).shadowed).toBeUndefined();
  });

  it('commits collection variables to collection.json only, and creates the globals file', async () => {
    const fs = new MemoryFs();
    await copyInto(fs, fixtureDirectory);
    const session = await ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
    const collection = session.getWorkingModel().collections[0]!;
    session.apply({
      type: 'setContainerVariables',
      id: collection.id,
      values: [...collection.variables, v('version', '2')],
    });
    const first = await session.saveForCommit([collection.id]);
    expect(first.plan.writes.map((w) => w.path)).toEqual(['collections/users-api/collection.json']);
    expect(await fs.readText('collections/users-api/collection.json')).toContain(
      '"key": "version"',
    );

    session.apply({ type: 'setGlobals', values: [v('token', '', { type: 'secret' })] });
    expect(session.changeState(GLOBALS_ENTITY_ID)).toBe('unsaved');
    const { plan } = await session.saveForCommit();
    expect(plan.writes.map((w) => [w.path, w.kind])).toEqual([
      ['environments/globals.postman_globals.json', 'add'],
    ]);
    const globals = JSON.parse(await fs.readText('environments/globals.postman_globals.json'));
    expect(Object.keys(globals)).toEqual(['id', 'values', '_postman_variable_scope']);
    expect(globals._postman_variable_scope).toBe('globals');
    expect(globals.values).toEqual([{ key: 'token', value: '', type: 'secret', enabled: true }]);

    const reopened = await ProjectSession.fromFs(fs);
    expect(reopened.getWorkingModel().globals?.values.map((x) => x.key)).toEqual(['token']);
  });

  it('discards a globals draft', async () => {
    const { session } = await open();
    await session.save([GLOBALS_ENTITY_ID]);
    expect(session.changeState(GLOBALS_ENTITY_ID)).toBe('created');
    await session.discard(GLOBALS_ENTITY_ID);
    expect(session.getWorkingModel().globals).toBeUndefined();
  });
});
