import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectFileSystem } from '@pigeon/platform';
import { MemoryAppState, MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import { PROJECT_ENTITY_ID, ProjectSession } from '../src/index';

const fixtureDirectory = join(import.meta.dirname, '../../fixtures/projects/basic');

async function copyInto(fs: ProjectFileSystem, local: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await copyInto(fs, join(local, entry.name), path);
    else await fs.writeFileAtomic(path, new Uint8Array(await readFile(join(local, entry.name))));
  }
}

async function fixtureFs(): Promise<MemoryFs> {
  const fs = new MemoryFs();
  await copyInto(fs, fixtureDirectory);
  return fs;
}

describe('multiple projects (PIGN-021)', () => {
  it('keeps two copies of the same project apart in local state', async () => {
    const appState = new MemoryAppState();
    const a = await ProjectSession.fromFs(await fixtureFs(), { appState });
    const b = await ProjectSession.fromFs(await fixtureFs(), {
      appState,
      localKey: (id) => `${id}@copy`,
    });
    expect([a.localKey, b.localKey]).toEqual(['project-basic', 'project-basic@copy']);

    a.apply({ type: 'updateRequest', id: 'get-invoices', patch: { method: 'PUT' } });
    await a.save();
    expect(await appState.get('project:project-basic@copy', 'state')).toBeUndefined();
    b.apply({ type: 'updateRequest', id: 'get-invoices', patch: { method: 'PATCH' } });
    await b.save();

    const a2 = await ProjectSession.fromFs(a.fs, { appState });
    const b2 = await ProjectSession.fromFs(b.fs, { appState, localKey: (id) => `${id}@copy` });
    expect(a2.findRequest('get-invoices')?.method).toBe('PUT');
    expect(b2.findRequest('get-invoices')?.method).toBe('PATCH');
  });

  it('regenerates a project id as a draft for pigeon.json', async () => {
    const fs = await fixtureFs();
    const session = await ProjectSession.fromFs(fs, {
      appState: new MemoryAppState(),
      localKey: (id) => `${id}@x`,
    });
    session.apply({ type: 'setProjectInfo', id: 'fresh-id' });
    expect(session.changeState(PROJECT_ENTITY_ID)).toBe('unsaved');
    await session.save();
    expect(session.changeState(PROJECT_ENTITY_ID)).toBe('updated');
    expect(session.getWorkingModel().id).toBe('fresh-id');
    expect(await fs.readText('pigeon.json')).toContain('"project-basic"');

    const { plan } = await session.saveForCommit();
    expect(plan.writes.map((w) => w.path)).toEqual(['pigeon.json']);
    expect(await fs.readText('pigeon.json')).toContain('"fresh-id"');
    expect(session.drafts).toEqual([]);
  });

  it('discards a project id change', async () => {
    const session = await ProjectSession.fromFs(await fixtureFs(), {
      appState: new MemoryAppState(),
    });
    session.apply({ type: 'setProjectInfo', id: 'x', name: 'Renamed' });
    await session.save();
    await session.discard(PROJECT_ENTITY_ID);
    expect(session.getWorkingModel()).toMatchObject({ id: 'project-basic', name: 'Basic project' });
    expect(() => session.apply({ type: 'setProjectInfo', name: ' ' })).toThrow(/empty/);
  });
});
