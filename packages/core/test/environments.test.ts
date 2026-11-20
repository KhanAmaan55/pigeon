import { readProject, serializeProject } from '@pigeon/formats';
import { MemoryAppState, MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import { initializeProject, ProjectSession } from '../src/index';

const decoder = new TextDecoder();

async function emptyProject() {
  const fs = new MemoryFs();
  await initializeProject(fs, 'Env API');
  const appState = new MemoryAppState();
  return { fs, appState, session: await ProjectSession.fromFs(fs, { appState }) };
}

describe('environments (PIGN-022)', () => {
  it('writes a new environment exactly as file-format.md §2.5', async () => {
    const { fs, session } = await emptyProject();
    session.apply({
      type: 'createEnvironment',
      id: 'e3b1',
      name: 'Local',
      values: [
        { key: 'baseUrl', value: 'http://localhost:3000', type: 'default', enabled: true },
        { key: 'token', value: '', type: 'secret', enabled: true },
      ],
    });
    const { plan } = await session.saveForCommit();
    expect(plan.writes.map((w) => w.path)).toEqual(['environments/local.postman_environment.json']);
    expect(await fs.readText('environments/local.postman_environment.json')).toBe(`{
  "id": "e3b1",
  "name": "Local",
  "values": [
    {
      "key": "baseUrl",
      "value": "http://localhost:3000",
      "type": "default",
      "enabled": true
    },
    {
      "key": "token",
      "value": "",
      "type": "secret",
      "enabled": true
    }
  ],
  "_postman_variable_scope": "environment"
}
`);
  });

  it('reads hand-written Postman environments, drops volatile keys and keeps unknown ones', async () => {
    const { fs, session } = await emptyProject();
    await fs.writeFileAtomic(
      'environments/staging.postman_environment.json',
      JSON.stringify({
        id: 'stg',
        name: 'Staging',
        values: [
          { key: 'baseUrl', value: 'https://stg', enabled: false, extraKey: 1 },
          { key: 'n', value: 5 },
        ],
        _postman_variable_scope: 'environment',
        _postman_exported_at: '2026-01-01T00:00:00.000Z',
        _postman_exported_using: 'Postman/11',
        color: 'red',
      }),
    );
    await fs.writeFileAtomic('environments/globals.postman_globals.json', '{"id":"g","values":[]}');
    await fs.writeFileAtomic('environments/broken.postman_environment.json', '{"name": 1}');
    await session.checkForChanges();

    const [broken, staging] = session.getWorkingModel().environments;
    expect(broken).toMatchObject({ fileKey: 'broken', broken: true });
    expect(staging).toEqual({
      id: 'stg',
      fileKey: 'staging',
      name: 'Staging',
      values: [
        {
          key: 'baseUrl',
          value: 'https://stg',
          type: 'default',
          enabled: false,
          extra: { extraKey: 1 },
        },
        { key: 'n', value: '5', type: 'default', enabled: true },
      ],
      extra: { color: 'red' },
    });
    const written = JSON.parse(
      decoder.decode(
        serializeProject(session.getWorkingModel()).get(
          'environments/staging.postman_environment.json',
        ),
      ),
    );
    expect(written._postman_exported_at).toBeUndefined();
    expect(written.color).toBe('red');
    expect(
      serializeProject(session.getWorkingModel()).has(
        'environments/broken.postman_environment.json',
      ),
    ).toBe(false);
    expect((await readProject(fs)).problems.map((p) => p.path)).toEqual([
      'environments/broken.postman_environment.json',
    ]);
  });

  it('renames, duplicates and deletes environments as drafts', async () => {
    const { fs, session } = await emptyProject();
    session.apply({ type: 'createEnvironment', id: 'a', name: 'Local' });
    await session.saveForCommit();
    session.apply({ type: 'duplicateEnvironment', id: 'a', newId: 'b' });
    session.apply({ type: 'renameEnvironment', id: 'a', name: 'Dev' });
    expect(session.getWorkingModel().environments.map((e) => [e.name, e.fileKey])).toEqual([
      ['Dev', 'dev'],
      ['Local copy', 'local-copy'],
    ]);
    await session.save();
    session.apply({ type: 'deleteEnvironment', id: 'b' });
    await session.save();
    expect(session.changeState('b')).toBe('clean'); // created and deleted before commit: nothing left
    session.apply({ type: 'deleteEnvironment', id: 'a' });
    await session.save();
    expect(session.changeState('a')).toBe('deleted');
    expect(await fs.exists('environments/local.postman_environment.json')).toBe(true);
    const { plan } = await session.saveForCommit();
    expect(plan.deletes).toEqual(['environments/local.postman_environment.json']);
    expect(await fs.list('environments')).toEqual([]);
  });

  it('keeps current values and the selection in local state only, per project', async () => {
    const { fs, appState, session } = await emptyProject();
    session.apply({
      type: 'createEnvironment',
      id: 'env',
      name: 'Local',
      values: [{ key: 'token', value: 'shared', type: 'default', enabled: true }],
    });
    await session.saveForCommit();
    const filesBefore = await fs.readText('environments/local.postman_environment.json');

    session.selectEnvironment('env');
    session.setCurrentValue('env:env', 'token', 'mine');
    expect(session.drafts).toEqual([]);
    expect(session.unsavedIds()).toEqual([]);
    expect(await fs.readText('environments/local.postman_environment.json')).toBe(filesBefore);

    const restarted = await ProjectSession.fromFs(fs, { appState });
    expect(restarted.selectedEnvironmentId).toBe('env');
    expect(restarted.currentValues('env:env')).toEqual({ token: 'mine' });
    const other = await ProjectSession.fromFs(fs, { appState, localKey: (id) => `${id}@other` });
    expect(other.selectedEnvironmentId).toBeNull();
    expect(other.currentValues('env:env')).toEqual({});

    restarted.persistCurrentAsShared('env');
    expect(restarted.isUnsaved('env')).toBe(true);
    expect(restarted.currentValues('env:env')).toEqual({});
    expect(restarted.getWorkingModel().environments[0]!.values[0]!.value).toBe('mine');
    restarted.resetCurrentValues('env:env');
    restarted.selectEnvironment(null);
    expect(restarted.selectedEnvironmentId).toBeNull();
  });
});
