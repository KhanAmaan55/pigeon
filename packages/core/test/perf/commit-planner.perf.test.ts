import { contentHash } from '@pigeon/formats';
import { describe, expect, it } from 'vitest';

import type { Draft, ProjectModel } from '../../src/index';
import { applyCommand, createDraft, planCommit } from '../../src/index';

/** A project with `count` requests in 50 folders. */
function bigModel(count: number): ProjectModel {
  let model: ProjectModel = {
    id: 'p',
    name: 'Big',
    formatVersion: 1,
    collections: [],
    orphanExamples: [],
    environments: [],
    extra: {},
  };
  model = applyCommand(model, { type: 'createCollection', id: 'c', name: 'Big' });
  for (let f = 0; f < 50; f++)
    model = applyCommand(model, {
      type: 'createFolder',
      id: `f${f}`,
      parentId: 'c',
      name: `Folder ${f}`,
    });
  for (let r = 0; r < count; r++) {
    model = applyCommand(model, {
      type: 'createRequest',
      id: `r${r}`,
      parentId: `f${r % 50}`,
      name: `Request ${r}`,
    });
  }
  return model;
}

describe('commit planner performance (pnpm test:perf)', () => {
  it('plans a one-request commit in a 5,000-request project within budget', async () => {
    const base = bigModel(5000);
    const working = applyCommand(base, {
      type: 'updateRequest',
      id: 'r42',
      patch: { method: 'POST' },
    });
    const draft = createDraft(base, working, 'r42', () => null) as Draft;
    const disk = new Map<string, string | null>([['pigeon.json', 'x']]);
    const knownPaths = new Set<string>(['pigeon.json']);

    const run = () =>
      planCommit({
        base,
        drafts: [draft],
        disk,
        knownPaths,
        brokenPaths: new Set(),
        hash: (bytes: Uint8Array, path: string) => contentHash(path, bytes),
      });
    // Best of three after a warm-up: the suite runs in parallel, so single timings are noisy.
    let plan = await run();
    let elapsed = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      plan = await run();
      elapsed = Math.min(elapsed, performance.now() - started);
    }

    expect(plan.writes.map((w) => w.path).sort()).toEqual([
      'collections/big/folder-42/folder.json',
      'collections/big/folder-42/request-42.request.json',
    ]);
    // Budget: 100 ms (story PIGN-019); shared CI runners get headroom.
    expect(elapsed).toBeLessThan(process.env['CI'] ? 500 : 100);
  });
});
