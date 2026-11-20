import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectFileSystem } from '@pigeon/platform';
import { MemoryAppState, MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { ExecutionResult } from '../src/index';
import {
  acceptedExamplePatch,
  compareExecution,
  effectiveComparison,
  exampleFromResponse,
  normalizeResponse,
  ProjectSession,
  SECRET_MASK,
  uniqueExampleName,
  withBaseline,
} from '../src/index';

const fixtureDirectory = join(import.meta.dirname, '../../fixtures/projects/examples');

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
  const appState = new MemoryAppState();
  return { fs, session: await ProjectSession.fromFs(fs, { appState }) };
}

function result(
  status: number,
  body: unknown,
  extraHeaders: Array<[string, string]> = [],
): ExecutionResult {
  return {
    id: 'exec',
    requestId: 'list-users',
    environmentId: null,
    startedAt: '',
    transport: 'mock',
    request: { method: 'GET', url: '', headers: [] },
    warnings: [],
    response: normalizeResponse({
      status,
      statusText: status === 200 ? 'OK' : 'Not Found',
      headers: [['Content-Type', 'application/json; charset=utf-8'], ...extraHeaders],
      body: new TextEncoder().encode(JSON.stringify(body)),
      url: '',
      redirects: [],
      timings: { startedAt: 0, totalMs: 1 },
      headersRestricted: false,
    }),
  } as unknown as ExecutionResult;
}

function compare(session: ProjectSession, actual: ExecutionResult) {
  const request = session.findRequest('list-users')!;
  const effective = effectiveComparison(session.getWorkingModel(), request);
  return compareExecution(request, actual, effective.body, effective);
}

describe('accept new baseline (PIGN-037)', () => {
  it('accept → pass; the commit changes only the example and its body; discard restores', async () => {
    const { fs, session } = await open();
    const actual = result(200, [{ id: 1, fullName: 'Ada Lovelace' }]);
    const before = compare(session, actual);
    expect(before?.kind === 'compared' && before.result.outcome).toBe('fail');
    const exampleId = before?.kind === 'compared' ? before.result.exampleId : '';

    const request = session.findRequest('list-users')!;
    session.apply({
      type: 'updateExample',
      id: exampleId,
      patch: acceptedExamplePatch(request, actual.response!),
    });
    expect(compare(session, actual)).toMatchObject({
      kind: 'compared',
      result: { outcome: 'pass' },
    });
    const example = session.findExample(exampleId)!.example;
    expect(example).toMatchObject({ id: 'example-200', name: '200 OK', fileKey: '200-ok' });

    await session.save();
    const { plan } = await session.saveForCommit();
    // Only this example's files (here its metadata is unchanged: same status and headers).
    const written = plan.writes.map((w) => w.path);
    expect(written).toContain('examples/users-api/list-users/200-ok.body.json');
    expect(
      written.every((path) =>
        /^examples\/users-api\/list-users\/200-ok\.(body|example)\.json$/.test(path),
      ),
    ).toBe(true);
    expect(plan.deletes).toEqual([]);

    // A second accept, discarded: back to the committed baseline and its failing result.
    session.apply({
      type: 'updateExample',
      id: exampleId,
      patch: acceptedExamplePatch(request, result(200, { other: true }).response!),
    });
    await session.save();
    expect(compare(session, actual)?.kind === 'compared' && compare(session, actual)).toMatchObject(
      {
        result: { outcome: 'fail' },
      },
    );
    await session.discard('list-users');
    expect(compare(session, actual)).toMatchObject({ result: { outcome: 'pass' } });
    expect(await fs.readText('examples/users-api/list-users/200-ok.body.json')).toContain(
      'fullName',
    );
  });

  it('pinning a 404 example fails a 200 on status; auto picks the 200 example', async () => {
    const { session } = await open();
    const request = session.findRequest('list-users')!;
    const notFound = exampleFromResponse(request, result(404, { error: 'nope' }).response!, {
      id: 'ex-404',
    });
    session.apply({ type: 'createExample', requestId: 'list-users', example: notFound });
    session.apply({
      type: 'setComparisonConfig',
      requestId: 'list-users',
      config: withBaseline(session.findRequest('list-users')!.comparison, {
        mode: 'example',
        exampleId: 'ex-404',
      }),
    });
    const ok = result(200, [{ id: 1, name: 'Ada', big: 1 }]);
    const pinned = compare(session, ok);
    expect(pinned?.kind === 'compared' && pinned.result).toMatchObject({
      exampleId: 'ex-404',
      outcome: 'fail',
    });
    expect(pinned?.kind === 'compared' && pinned.result.findings[0]).toMatchObject({
      kind: 'status.changed',
    });

    session.apply({
      type: 'setComparisonConfig',
      requestId: 'list-users',
      config: withBaseline(session.findRequest('list-users')!.comparison, { mode: 'auto' }),
    });
    expect(session.findRequest('list-users')!.comparison?.baseline).toBeUndefined();
    expect(compare(session, ok)).toMatchObject({ result: { exampleId: 'example-200' } });

    session.apply({
      type: 'setComparisonConfig',
      requestId: 'list-users',
      config: withBaseline(session.findRequest('list-users')!.comparison, {
        mode: 'example',
        exampleId: 'gone',
      }),
    });
    expect(compare(session, ok)).toEqual({
      kind: 'baseline-not-found',
      requestId: 'list-users',
      exampleId: 'gone',
    });
  });

  it('never puts the secrets of the send into the accepted example', async () => {
    const { session } = await open();
    const request = session.findRequest('list-users')!;
    const actual = result(200, { token: 'super-secret-token' }, [
      ['X-Token', 'super-secret-token'],
    ]);
    const patch = acceptedExamplePatch(request, actual.response!, {
      secretValues: ['super-secret-token'],
    });
    expect(JSON.stringify(patch)).not.toContain('super-secret-token');
    expect(patch.response.headers).toContainEqual({ key: 'X-Token', value: SECRET_MASK });
  });

  it('de-duplicates example names', () => {
    expect(uniqueExampleName('200 OK', [{ name: '200 OK' }, { name: '200 OK (2)' }])).toBe(
      '200 OK (3)',
    );
    expect(uniqueExampleName('201 Created', [{ name: '200 OK' }])).toBe('201 Created');
  });
});
