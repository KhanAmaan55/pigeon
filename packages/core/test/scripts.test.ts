import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { serializeProject } from '@pigeon/formats';
import type { ProjectFileSystem } from '@pigeon/platform';
import { MEMORY_CAPABILITIES, MemoryAppState, MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import {
  createExecutionContext,
  prepareRequest,
  ProjectSession,
  readScript,
  scriptsNotRun,
  writeScript,
} from '../src/index';

const fixtureDirectory = join(import.meta.dirname, '../../fixtures/projects/basic');

async function copyInto(fs: ProjectFileSystem, local: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await copyInto(fs, join(local, entry.name), path);
    else await fs.writeFileAtomic(path, new Uint8Array(await readFile(join(local, entry.name))));
  }
}

async function open() {
  const fs = new MemoryFs();
  await copyInto(fs, fixtureDirectory);
  return { fs, session: await ProjectSession.fromFs(fs, { appState: new MemoryAppState() }) };
}

describe('scripts (PIGN-031)', () => {
  it('editing one line of a script changes one line of the file', async () => {
    const { fs, session } = await open();
    const collection = session.getWorkingModel().collections[0]!;
    const { text } = readScript(collection.events, 'test');
    expect(text).toBe("pm.test('users');");
    session.apply({
      type: 'setContainerEvents',
      id: collection.id,
      events: writeScript(collection.events, 'test', "pm.test('all users');", false),
    });
    const path = 'collections/users-api/collection.json';
    const before = (await fs.readText(path)).split('\n');
    const after = new TextDecoder()
      .decode(serializeProject(session.getWorkingModel()).get(path))
      .split('\n');
    expect(after).toHaveLength(before.length);
    const changed = before.flatMap((line, i) => (line === after[i] ? [] : [[line, after[i]]]));
    expect(changed).toEqual([
      [`          "pm.test('users');"`, `          "pm.test('all users');"`],
    ]);
  });

  it('toggling disabled persists through save for commit', async () => {
    const { fs, session } = await open();
    const collection = session.getWorkingModel().collections[0]!;
    session.apply({
      type: 'setContainerEvents',
      id: collection.id,
      events: writeScript(collection.events, 'test', "pm.test('users');", true),
    });
    await session.saveForCommit();
    const file = JSON.parse(await fs.readText('collections/users-api/collection.json'));
    expect(file.event[0]).toMatchObject({ listen: 'test', disabled: true });
    const reopened = await ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
    expect(readScript(reopened.getWorkingModel().collections[0]!.events, 'test').disabled).toBe(
      true,
    );
  });

  it('lists the scripts a send skips and warns about them', async () => {
    const { session } = await open();
    const model = session.getWorkingModel();
    expect(scriptsNotRun(model, 'list-users')).toEqual(['collection Users API', 'this request']);
    expect(scriptsNotRun(model, 'create-user')).toEqual(['collection Users API']);
    session.apply({
      type: 'updateRequest',
      id: 'create-user',
      patch: { events: writeScript([], 'prerequest', 'console.log(1)', false) },
    });
    const places = scriptsNotRun(session.getWorkingModel(), 'create-user');
    expect(places).toEqual(['collection Users API', 'this request']);
    const prepared = await prepareRequest(
      session.findRequest('create-user')!,
      createExecutionContext({ capabilities: MEMORY_CAPABILITIES, skippedScripts: places }),
    );
    expect(prepared.ok && prepared.value.meta.warnings?.[0]).toBe(
      'Scripts were not run (not supported yet): collection Users API, this request.',
    );
  });
});
