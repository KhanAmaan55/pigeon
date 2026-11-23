import { MEMORY_CAPABILITIES, MemoryAppState, MemoryFs, MockTransport } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { RunEvent, RunReport, RunTarget } from '../src/index';
import {
  acceptedExamplePatch,
  compareExecution,
  createExecutionContext,
  effectiveComparison,
  exampleFromResponse,
  initializeProject,
  ProjectSession,
  RequestExecutor,
  rememberRunReport,
  runRegression,
  runTargets,
} from '../src/index';

/** Paths the mock server answers, and what each request's baseline is. */
const ROUTES: Array<{ name: string; path: string; baseline?: unknown; folder?: string }> = [
  { name: 'Same', path: 'same', baseline: { id: 1 } },
  { name: 'Added field', path: 'added', baseline: { id: 1 } },
  { name: 'Removed field', path: 'removed', baseline: { id: 1, name: 'x' } },
  { name: 'No baseline', path: 'nobase' },
  { name: 'Type changed', path: 'typed', baseline: { id: 1 }, folder: 'Nested' },
  { name: 'Same 2', path: 'same', baseline: { id: 1 }, folder: 'Nested' },
  { name: 'Unreachable', path: 'down', baseline: { id: 1 } },
  { name: 'Same 3', path: 'same', baseline: { id: 1 } },
  { name: 'Same 4', path: 'same', baseline: { id: 1 } },
  { name: 'Same 5', path: 'same', baseline: { id: 1 } },
];
const BODIES: Record<string, unknown> = {
  same: { id: 1 },
  added: { id: 1, extra: true },
  removed: { id: 1 },
  nobase: { ok: true },
  typed: { id: '1' },
};

async function project() {
  const fs = new MemoryFs();
  await initializeProject(fs, 'Runs');
  const session = await ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
  session.apply({ type: 'createCollection', id: 'c', name: 'API' });
  // Top-level requests first, then the folder with its requests (explorer order).
  const ordered = [
    ...ROUTES.map((route, i) => ({ route, i })).filter(({ route }) => !route.folder),
    ...ROUTES.map((route, i) => ({ route, i })).filter(({ route }) => route.folder),
  ];
  let folderCreated = false;
  ordered.forEach(({ route, i }) => {
    if (route.folder && !folderCreated) {
      session.apply({ type: 'createFolder', id: 'nested', parentId: 'c', name: 'Nested' });
      folderCreated = true;
    }
    const id = `r${i}`;
    session.apply({
      type: 'createRequest',
      id,
      parentId: route.folder ? 'nested' : 'c',
      name: route.name,
      request: {
        url: { raw: `http://api.test/${route.path}`, query: [], pathVariables: [], extra: {} },
      },
    });
    if (route.baseline !== undefined) {
      session.apply({
        type: 'createExample',
        requestId: id,
        example: {
          id: `ex${i}`,
          name: '200 OK',
          response: {
            code: 200,
            status: 'OK',
            headers: [{ key: 'Content-Type', value: 'application/json' }],
            cookies: [],
            body: { kind: 'text', text: JSON.stringify(route.baseline), format: 'json' },
          },
          extra: {},
        },
      });
    }
  });
  const transport = new MockTransport().on({ url: /./ }, (req) => {
    const path = new URL(req.url).pathname.slice(1);
    if (path === 'down') throw new Error('connection refused');
    return { headers: [['Content-Type', 'application/json']], body: JSON.stringify(BODIES[path]) };
  });
  const executor = new RequestExecutor(transport);
  const deps = {
    execute: (target: RunTarget, signal: AbortSignal) =>
      executor.execute(
        session.findRequest(target.requestId)!,
        createExecutionContext({ capabilities: MEMORY_CAPABILITIES }),
        { signal },
      ),
    compare: async (target: RunTarget, result: Parameters<typeof compareExecution>[1]) => {
      const request = session.findRequest(target.requestId)!;
      const effective = effectiveComparison(session.getWorkingModel(), request);
      return compareExecution(request, result, effective.body, effective);
    },
  };
  return { session, transport, deps };
}

async function collect(generator: AsyncGenerator<RunEvent, RunReport>) {
  const events: RunEvent[] = [];
  for (;;) {
    const next = await generator.next();
    if (next.done) return { events, report: next.value };
    events.push(next.value);
  }
}

const OPTIONS = {
  scope: { kind: 'collection' as const, id: 'c', name: 'API' },
  environment: null,
  transport: 'mock',
};

describe('regression runner (PIGN-038)', () => {
  it('runs every request in explorer order and reports a mix of outcomes', async () => {
    const { session, deps } = await project();
    const targets = runTargets(session.getWorkingModel(), 'c');
    expect(targets.map((t) => t.name)).toEqual([
      'Same',
      'Added field',
      'Removed field',
      'No baseline',
      'Unreachable',
      'Same 3',
      'Same 4',
      'Same 5',
      'Type changed',
      'Same 2',
    ]);
    expect(targets.find((t) => t.name === 'Same 2')?.folders).toEqual(['Nested']);
    const { events, report } = await collect(runRegression(targets, deps, OPTIONS));
    expect(events[0]).toMatchObject({ type: 'started', total: 10 });
    expect(report.entries.map((e) => [e.name, e.outcome])).toEqual([
      ['Same', 'pass'],
      ['Added field', 'warn'],
      ['Removed field', 'fail'],
      ['No baseline', 'no-baseline'],
      ['Unreachable', 'error'],
      ['Same 3', 'pass'],
      ['Same 4', 'pass'],
      ['Same 5', 'pass'],
      ['Type changed', 'fail'],
      ['Same 2', 'pass'],
    ]);
    expect(report.totals).toEqual({
      pass: 5,
      warn: 1,
      fail: 2,
      'no-baseline': 1,
      error: 1,
      skipped: 0,
    });
    expect(report).toMatchObject({ pigeonRunReport: 1, cancelled: false, stoppedOnFail: false });
    // Stored reports are plain JSON without findings.
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(JSON.stringify(report)).not.toContain('findings');
  });

  it('only with baselines leaves requests without examples out', async () => {
    const { session } = await project();
    expect(
      runTargets(session.getWorkingModel(), 'c', { onlyWithBaseline: true }).map((t) => t.name),
    ).not.toContain('No baseline');
    expect(runTargets(session.getWorkingModel(), 'nested').map((t) => t.name)).toEqual([
      'Type changed',
      'Same 2',
    ]);
  });

  it('stop on first failure stops after the first fail; the rest is skipped', async () => {
    const { session, deps } = await project();
    const { report } = await collect(
      runRegression(runTargets(session.getWorkingModel(), 'c'), deps, {
        ...OPTIONS,
        stopOnFail: true,
      }),
    );
    expect(report.entries.map((e) => e.outcome)).toEqual([
      'pass',
      'warn',
      'fail',
      ...Array(7).fill('skipped'),
    ]);
    expect(report).toMatchObject({ stoppedOnFail: true, totals: { skipped: 7 } });
  });

  it('cancel stops mid-run and marks the rest skipped', async () => {
    const { session, deps } = await project();
    const controller = new AbortController();
    const generator = runRegression(runTargets(session.getWorkingModel(), 'c'), deps, {
      ...OPTIONS,
      signal: controller.signal,
    });
    const events: RunEvent[] = [];
    let report: RunReport | undefined;
    for (;;) {
      const next = await generator.next();
      if (next.done) {
        report = next.value;
        break;
      }
      events.push(next.value);
      if (next.value.type === 'request-finished' && next.value.index === 1) controller.abort();
    }
    expect(report.cancelled).toBe(true);
    expect(report.entries.filter((e) => e.outcome === 'skipped')).toHaveLength(8);
  });

  it('bulk accept of the failures as drafts makes a re-run pass', async () => {
    const { session, deps } = await project();
    const targets = runTargets(session.getWorkingModel(), 'c');
    const { events } = await collect(runRegression(targets, deps, OPTIONS));
    for (const event of events) {
      if (event.type !== 'request-finished' || event.comparison?.kind !== 'compared') continue;
      if (event.comparison.result.outcome === 'pass' || !event.result?.response) continue;
      const request = session.findRequest(event.entry.requestId)!;
      session.apply({
        type: 'updateExample',
        id: event.comparison.result.exampleId,
        patch: acceptedExamplePatch(request, event.result.response),
      });
    }
    await session.save();
    const { report } = await collect(runRegression(targets, deps, OPTIONS));
    expect(report.totals).toMatchObject({ pass: 8, warn: 0, fail: 0 });
    // A request without a baseline can get one from its run result too.
    expect(exampleFromResponse).toBeTypeOf('function');
  });

  it('keeps the last 20 reports, newest first', () => {
    let reports: RunReport[] = [];
    for (let i = 0; i < 25; i++)
      reports = rememberRunReport(reports, { id: `run${i}` } as RunReport);
    expect(reports).toHaveLength(20);
    expect(reports[0]!.id).toBe('run24');
  });
});

describe('test results in runs (PIGN-044)', () => {
  const target = (id: string): RunTarget => ({
    requestId: id,
    name: id,
    method: 'GET',
    folders: [],
  });
  const result = (tests: Array<'pass' | 'fail' | 'error'>) =>
    ({
      id: 'e',
      environmentId: null,
      startedAt: '',
      transport: 'mock',
      request: { method: 'GET', url: 'http://x/', headers: [] },
      warnings: [],
      response: {
        status: 200,
        statusText: 'OK',
        headers: [],
        body: new Uint8Array(),
        url: '',
        redirects: [],
        timings: { startedAt: 0, totalMs: 1 },
        headersRestricted: false,
      },
      tests: {
        results: tests.map((outcome, i) => ({
          name: `t${i}`,
          outcome,
          ...(outcome === 'pass' ? {} : { message: 'nope' }),
        })),
        counts: {
          pass: tests.filter((t) => t === 'pass').length,
          fail: tests.filter((t) => t === 'fail').length,
          error: tests.filter((t) => t === 'error').length,
        },
      },
    }) as never;
  const run = async (testsAffectOutcome?: boolean) => {
    const outcomes: Record<string, Array<'pass' | 'fail' | 'error'>> = {
      ok: ['pass', 'pass'],
      bad: ['pass', 'fail', 'error'],
    };
    const generator = runRegression(
      [target('ok'), target('bad')],
      {
        execute: async (t) => result(outcomes[t.requestId]!),
        compare: async () => ({ kind: 'no-baseline', requestId: 'x' }),
      },
      {
        scope: { kind: 'collection', id: 'c', name: 'C' },
        environment: null,
        transport: 'mock',
        ...(testsAffectOutcome === undefined ? {} : { testsAffectOutcome }),
      },
    );
    for (;;) {
      const next = await generator.next();
      if (next.done) return next.value;
    }
  };

  it('a failed or errored test fails the request; passing tests pass an uncompared one', async () => {
    const report = await run();
    expect(report.entries.map((e) => [e.outcome, e.tests])).toEqual([
      ['pass', { pass: 2, fail: 0, error: 0 }],
      [
        'fail',
        {
          pass: 1,
          fail: 1,
          error: 1,
          failures: [
            { name: 't1', message: 'nope' },
            { name: 't2', message: 'nope' },
          ],
        },
      ],
    ]);
    expect(report.options.testsAffectOutcome).toBe(true);
    const ignored = await run(false);
    expect(ignored.entries.map((e) => e.outcome)).toEqual(['no-baseline', 'no-baseline']);
  });
});
