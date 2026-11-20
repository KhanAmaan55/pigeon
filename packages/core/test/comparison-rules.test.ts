import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectFileSystem } from '@pigeon/platform';
import { MemoryAppState, MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { ExecutionResult } from '../src/index';
import {
  compareExecution,
  effectiveComparison,
  normalizeResponse,
  ProjectSession,
  upsertRule,
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
  return { fs, appState, session: await ProjectSession.fromFs(fs, { appState }) };
}

function result(body: unknown): ExecutionResult {
  return {
    id: 'exec',
    requestId: 'r',
    environmentId: null,
    startedAt: '',
    transport: 'mock',
    request: { method: 'GET', url: '', headers: [] },
    warnings: [],
    response: normalizeResponse({
      status: 200,
      statusText: 'OK',
      headers: [['Content-Type', 'application/json']],
      body: new TextEncoder().encode(JSON.stringify(body)),
      url: '',
      redirects: [],
      timings: { startedAt: 0, totalMs: 1 },
      headersRestricted: false,
    }),
  } as unknown as ExecutionResult;
}

function compare(session: ProjectSession, requestId: string, body: unknown) {
  const request = session.findRequest(requestId)!;
  const effective = effectiveComparison(session.getWorkingModel(), request);
  const outcome = compareExecution(request, result(body), effective.body, effective);
  if (outcome?.kind !== 'compared') throw new Error('not compared');
  return outcome.result;
}

describe('field rules in comparisons (PIGN-035)', () => {
  it('Mark optional: a removed field becomes a warning; the rule is committed to compare.json', async () => {
    const { fs, session } = await open();
    // The fixture's delete-user baseline has no body: give it one.
    session.apply({
      type: 'createExample',
      requestId: 'delete-user',
      example: {
        id: 'deleted',
        name: 'Deleted',
        response: {
          code: 200,
          status: 'OK',
          headers: [],
          cookies: [],
          body: { kind: 'text', text: '{"id":42,"reason":"spam"}', format: 'json' },
        },
        extra: {},
      },
      index: 0,
    });
    expect(compare(session, 'delete-user', { id: 42 }).outcome).toBe('fail');
    const request = session.findRequest('delete-user')!;
    session.apply({
      type: 'setComparisonConfig',
      requestId: 'delete-user',
      config: upsertRule(request.comparison, { path: '$.reason', optional: true }),
    });
    const relaxed = compare(session, 'delete-user', { id: 42 });
    expect(relaxed.outcome).toBe('warn');
    expect(relaxed.findings[0]).toMatchObject({ severity: 'warn', rule: { path: '$.reason' } });

    await session.saveForCommit();
    expect(await fs.readText('examples/users-api/admin/delete-user/compare.json')).toBe(
      `${JSON.stringify(
        {
          pigeonCompare: 1,
          requestId: 'delete-user',
          rules: [{ path: '$.reason', optional: true }],
        },
        null,
        2,
      )}\n`,
    );
  });

  it('merges flags into an existing rule for the same path', () => {
    const config = upsertRule(upsertRule(undefined, { path: '$.a', optional: true }), {
      path: '$.a',
      nullable: true,
    });
    expect(config.rules).toEqual([{ path: '$.a', optional: true, nullable: true }]);
  });

  it('project rules apply to every request; request body settings override project ones', async () => {
    const { fs, appState, session } = await open();
    session.apply({
      type: 'setComparisonDefaults',
      comparison: {
        body: { additionalFields: 'ignore' },
        rules: [{ path: '$..id', ignore: true }],
      },
    });
    const effective = effectiveComparison(
      session.getWorkingModel(),
      session.findRequest('list-users')!,
    );
    // list-users' compare.json sets additionalFields: fail over the project's ignore.
    expect(effective.body.additionalFields).toBe('fail');
    expect(effective.rules.map((r) => r.path)).toEqual(['$..id', '$.meta', '$[*].nickname']);
    const compared = compare(session, 'list-users', [{ id: 'x', name: 'Ada Lovelace', big: 1 }]);
    expect(compared.findings.find((f) => f.path === '$[0].id')?.severity).toBe('ignored');

    await session.saveForCommit();
    expect(JSON.parse(await fs.readText('pigeon.json')).comparison).toEqual({
      body: { additionalFields: 'ignore' },
      rules: [{ path: '$..id', ignore: true }],
    });
    const reopened = await ProjectSession.fromFs(fs, { appState });
    expect(reopened.getWorkingModel().comparison).toEqual(session.getWorkingModel().comparison);
  });

  it('baseline modes: none disables, example pins one', async () => {
    const { session } = await open();
    const request = session.findRequest('list-users')!;
    expect(
      compareExecution(request, result([]), undefined, { baseline: { mode: 'none' } }),
    ).toBeUndefined();
    const pinned = compareExecution(request, result([]), undefined, {
      baseline: { mode: 'example', exampleId: 'example-avatar' },
    });
    expect(pinned?.kind === 'compared' && pinned.result.exampleId).toBe('example-avatar');
  });
});
