import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MemoryAppState, MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import {
  initializeProject,
  planEntityIds,
  previewImport,
  ProjectSession,
  renamePlan,
} from '../src/index';

const fixtures = join(import.meta.dirname, '../../fixtures/postman');
const COLLECTIONS = readdirSync(fixtures).filter((name) => /\.v2\.[01]\.json$/.test(name));

async function emptySession() {
  const fs = new MemoryFs();
  await initializeProject(fs, 'Imports');
  const appState = new MemoryAppState();
  return { fs, appState, session: await ProjectSession.fromFs(fs, { appState }) };
}

describe('import → Save for Commit → reopen (PIGN-028)', () => {
  it.each(COLLECTIONS)('%s gives the identical working model after a reopen', async (name) => {
    const { fs, appState, session } = await emptySession();
    const preview = previewImport(session.getWorkingModel(), readFileSync(join(fixtures, name)));
    if (!preview.ok) throw new Error(preview.message);
    session.apply({ type: 'importCollection', collection: preview.plan.collection });
    const { plan, result } = await session.saveForCommit(planEntityIds(preview.plan));
    expect(plan.blocked).toEqual([]);
    expect(result.written).toContain('pigeon.json');
    const reopened = await ProjectSession.fromFs(fs, { appState });
    expect(reopened.problems).toEqual([]);
    expect(reopened.getWorkingModel()).toEqual(session.getWorkingModel());
    expect(reopened.unsavedIds()).toEqual([]);
  });

  it('can import as local drafts only: files stay untouched until committed', async () => {
    const { fs, appState, session } = await emptySession();
    const before = (await fs.list('', { recursive: true })).map((e) => e.path).sort();
    const preview = previewImport(
      session.getWorkingModel(),
      readFileSync(join(fixtures, 'examples.v2.1.json')),
    );
    if (!preview.ok) throw new Error(preview.message);
    const plan = renamePlan(preview.plan, 'Renamed on import');
    session.apply({ type: 'importCollection', collection: plan.collection });
    await session.save(planEntityIds(plan));
    expect((await fs.list('', { recursive: true })).map((e) => e.path).sort()).toEqual(before);

    const restarted = await ProjectSession.fromFs(fs, { appState });
    const collection = restarted.getWorkingModel().collections[0]!;
    expect(collection).toMatchObject({ name: 'Renamed on import', fileKey: 'renamed-on-import' });
    expect(restarted.changeState(collection.id)).toBe('created');
    expect(restarted.findRequest('list-users')?.examples).toHaveLength(5);
  });

  it('regenerates ids already in the project and rejects v1 and non-collections', async () => {
    const { session } = await emptySession();
    const text = readFileSync(join(fixtures, 'auth.v2.1.json'));
    const first = previewImport(session.getWorkingModel(), text);
    if (!first.ok) throw new Error(first.message);
    session.apply({ type: 'importCollection', collection: first.plan.collection });
    const second = previewImport(session.getWorkingModel(), text);
    expect(second.ok && second.plan.report.regeneratedIds).toHaveLength(10);
    if (second.ok) session.apply({ type: 'importCollection', collection: second.plan.collection });
    expect(session.getWorkingModel().collections.map((c) => c.fileKey)).toEqual([
      'auth-types',
      'auth-types-2',
    ]);

    const v1 = previewImport(session.getWorkingModel(), readFileSync(join(fixtures, 'v1.json')));
    expect(v1).toMatchObject({ ok: false, format: 'Postman Collection v1' });
    expect(previewImport(session.getWorkingModel(), '{"name":"Env","values":[]}')).toMatchObject({
      ok: false,
      format: 'Postman environment',
    });
  });

  it('imports 5,000 requests (preview, apply, local drafts) in under 5 s', async () => {
    const items = Array.from({ length: 50 }, (_, f) => ({
      id: `f${f}`,
      name: `Folder ${f}`,
      item: Array.from({ length: 100 }, (_, r) => ({
        id: `f${f}-r${r}`,
        name: `Request ${r}`,
        request: { method: 'GET', url: `{{baseUrl}}/items/${f}/${r}` },
      })),
    }));
    const text = JSON.stringify({ info: { name: 'Big', schema: 'v2.1.0' }, item: items });
    // Best of two: other test files run in parallel and steal CPU. Committing thousands of
    // files is covered by commit-perf.test.ts.
    let best = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 2 && best >= 5000; attempt++) {
      const { session } = await emptySession();
      const started = performance.now();
      const preview = previewImport(session.getWorkingModel(), text);
      if (!preview.ok) throw new Error(preview.message);
      session.apply({ type: 'importCollection', collection: preview.plan.collection });
      await session.save(planEntityIds(preview.plan));
      best = Math.min(best, performance.now() - started);
      expect(session.unsavedIds()).toEqual([]);
      expect(session.getWorkingModel().collections[0]!.children).toHaveLength(50);
    }
    expect(best).toBeLessThan(5000);
  }, 60_000);
});
