/** Reporter output (snapshots) and `main` in process with a mock transport (PIGN-054). */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunReport } from '@pigeon/core';
import { initializeProject, ProjectSession } from '@pigeon/core';
import { MemoryAppState, MockTransport } from '@pigeon/platform';
import { NodeFs } from '@pigeon/platform-node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CliIo } from '../src/main';
import { main } from '../src/main';
import type { EntryDetail } from '../src/reporters';
import { createPrettyReporter, renderJson, renderJunit } from '../src/reporters';

const REPORT: RunReport = {
  pigeonRunReport: 1,
  id: 'run-1',
  scope: { kind: 'collection', id: 'c', name: 'Users <API>' },
  environment: { id: 'e', name: 'Staging' },
  transport: 'node',
  startedAt: '2026-11-23T10:00:00.000Z',
  finishedAt: '2026-11-23T10:00:01.250Z',
  durationMs: 1250,
  options: { stopOnFail: true, onlyWithBaseline: false, testsAffectOutcome: true },
  cancelled: false,
  stoppedOnFail: true,
  totals: { pass: 1, warn: 1, fail: 1, 'no-baseline': 1, error: 1, skipped: 1 },
  entries: [
    {
      requestId: 'a',
      name: 'List',
      method: 'GET',
      folders: [],
      outcome: 'pass',
      url: 'http://api.test/users',
      status: 200,
      timeMs: 12,
      exampleId: 'x',
      exampleName: '200 OK',
      counts: { fail: 0, warn: 0, info: 0, ignored: 0 },
    },
    {
      requestId: 'b',
      name: 'Get',
      method: 'GET',
      folders: ['Admin'],
      outcome: 'warn',
      url: 'http://api.test/users/1',
      status: 200,
      timeMs: 8,
      exampleName: '200 OK',
      counts: { fail: 0, warn: 1, info: 0, ignored: 0 },
    },
    {
      requestId: 'c',
      name: 'Create',
      method: 'POST',
      folders: ['Admin'],
      outcome: 'fail',
      url: 'http://api.test/users?key=••••••',
      status: 500,
      timeMs: 30,
      exampleName: '201 & "Created"',
      counts: { fail: 2, warn: 0, info: 0, ignored: 0 },
      tests: {
        pass: 1,
        fail: 1,
        error: 0,
        failures: [{ name: 'is 201', message: 'expected 500 to equal 201' }],
      },
    },
    {
      requestId: 'd',
      name: 'Ping',
      method: 'GET',
      folders: [],
      outcome: 'no-baseline',
      url: 'http://api.test/ping',
      status: 204,
      timeMs: 3,
      message: 'No baseline example',
    },
    {
      requestId: 'e',
      name: 'Down',
      method: 'GET',
      folders: [],
      outcome: 'error',
      url: 'http://127.0.0.1:1/',
      message: 'connect ECONNREFUSED 127.0.0.1:1',
    },
    { requestId: 'f', name: 'Later', method: 'DELETE', folders: [], outcome: 'skipped' },
  ],
};

const DETAILS = new Map<string, EntryDetail>([
  [
    'c/b',
    {
      className: 'Users <API>/Admin',
      findings: [{ severity: 'warn', text: '$.nickname: Field added' }],
    },
  ],
  [
    'c/c',
    {
      className: 'Users <API>/Admin',
      findings: [
        { severity: 'fail', text: 'status: Status changed: 201 → 500' },
        { severity: 'fail', text: '$.id: Type changed: number → string' },
      ],
    },
  ],
]);

describe('reporters', () => {
  it('pretty', () => {
    let out = '';
    const pretty = createPrettyReporter({ write: (text) => (out += text), color: false });
    pretty.scope(REPORT.scope, REPORT.environment, REPORT.entries.length);
    for (const entry of REPORT.entries)
      pretty.entry(entry, DETAILS.get(`c/${entry.requestId}`) ?? {});
    pretty.totals(REPORT);
    expect(out).toMatchSnapshot();
  });

  it('pretty with colours wraps outcomes in ANSI codes', () => {
    let out = '';
    createPrettyReporter({ write: (text) => (out += text), color: true }).totals(REPORT);
    expect(out).toContain('\u001b[31m');
  });

  it('json', () => {
    const json = JSON.parse(renderJson('Project', [REPORT], 1)) as Record<string, unknown>;
    expect(json).toMatchObject({ pigeonCliReport: 1, project: 'Project', exitCode: 1 });
    expect(json['reports']).toEqual([REPORT]);
  });

  it('junit (escaped, one testcase per request)', () => {
    expect(renderJunit([REPORT], DETAILS, { failOnWarn: false })).toMatchSnapshot();
    expect(renderJunit([REPORT], DETAILS, { failOnWarn: true })).toContain(
      '<failure message="1 warning, vs “200 OK”" type="warn">',
    );
  });
});

describe('main in process', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pigeon-cli-warn-'));
    const fs = new NodeFs(dir);
    await initializeProject(fs, 'Warn');
    const session = await ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
    session.apply({ type: 'createCollection', id: 'c', name: 'C' });
    session.apply({
      type: 'createRequest',
      id: 'r',
      parentId: 'c',
      name: 'Grows',
      request: { url: { raw: 'http://api.test/x', query: [], pathVariables: [], extra: {} } },
    });
    session.apply({
      type: 'createExample',
      requestId: 'r',
      example: {
        id: 'e',
        name: '200 OK',
        response: {
          code: 200,
          status: 'OK',
          headers: [{ key: 'Content-Type', value: 'application/json' }],
          cookies: [],
          body: { kind: 'text', text: '{"id":1}', format: 'json' },
        },
        extra: {},
      },
    });
    await session.saveForCommit();
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  async function run(args: string[]) {
    let stdout = '';
    let stderr = '';
    const io: CliIo = {
      stdout: (t) => (stdout += t),
      stderr: (t) => (stderr += t),
      env: {},
      cwd: dir,
      color: false,
      writeFile: async () => undefined,
      transport: new MockTransport().on(() => true, {
        headers: [['Content-Type', 'application/json']],
        body: '{"id":1,"extra":true}',
      }),
    };
    return { code: await main(args, io), stdout, stderr };
  }

  it('a warning passes unless --fail-on-warn', async () => {
    const plain = await run(['run', '.']);
    expect(plain.code).toBe(0);
    expect(plain.stdout).toMatch(/! GET +Grows 200/);
    expect(plain.stdout).toContain('$.extra');
    expect((await run(['run', '.', '--fail-on-warn'])).code).toBe(1);
  });
});
