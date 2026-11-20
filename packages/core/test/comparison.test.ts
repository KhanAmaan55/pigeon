import type { ProjectExample } from '@pigeon/formats';
import { describe, expect, it } from 'vitest';

import type { ExecutionResult } from '../src/index';
import {
  compareExecution,
  LAST_COMPARISONS_LIMIT,
  normalizeResponse,
  projectBodySettings,
  rememberComparison,
  selectBaseline,
} from '../src/index';

const USER = {
  id: 1,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  active: true,
  roles: ['admin'],
};
const USER_V2 = { id: '1', name: 'Ada Lovelace', active: true, roles: ['admin'], nickname: 'ada' };

function example(
  id: string,
  code: number,
  body: ProjectExample['response']['body'],
): ProjectExample {
  return {
    id,
    fileKey: id,
    requestId: 'r',
    name: `${code} ${id}`,
    response: { code, status: '', headers: [], cookies: [], body },
    extra: {},
  };
}
const jsonExample = (id: string, code: number, value: unknown) =>
  example(id, code, { kind: 'text', text: JSON.stringify(value, null, 2), format: 'json' });

function result(status: number, body: string, contentType = 'application/json'): ExecutionResult {
  return {
    id: 'exec-1',
    requestId: 'r',
    environmentId: null,
    startedAt: '',
    transport: 'mock',
    request: { method: 'GET', url: '', headers: [] },
    warnings: [],
    response: normalizeResponse({
      status,
      statusText: '',
      headers: [['Content-Type', contentType]],
      body: new TextEncoder().encode(body),
      url: '',
      redirects: [],
      timings: { startedAt: 0, totalMs: 1 },
      headersRestricted: false,
    }),
  } as unknown as ExecutionResult;
}

describe('comparison service (PIGN-034)', () => {
  it('auto baseline: first example with the same status, else the first', () => {
    const examples = [
      jsonExample('a', 404, {}),
      jsonExample('b', 200, {}),
      jsonExample('c', 200, {}),
    ];
    expect(selectBaseline(examples, 200)?.id).toBe('b');
    expect(selectBaseline(examples, 500)?.id).toBe('a');
    expect(selectBaseline([], 200)).toBeUndefined();
  });

  it('user vs user-v2 fails with removed, added and type-changed findings', () => {
    const outcome = compareExecution(
      { id: 'r', examples: [jsonExample('ok', 200, USER)] },
      result(200, JSON.stringify(USER_V2)),
    );
    expect(outcome?.kind).toBe('compared');
    if (outcome?.kind !== 'compared') return;
    expect(outcome.result).toMatchObject({
      requestId: 'r',
      exampleId: 'ok',
      executionId: 'exec-1',
      outcome: 'fail',
      counts: { fail: 2, warn: 1, info: 0, ignored: 0 },
    });
    expect(outcome.result.findings.map((f) => [f.kind, f.path, f.severity])).toEqual([
      ['body.field.removed', '$.email', 'fail'],
      ['body.field.added', '$.nickname', 'warn'],
      ['body.type.changed', '$.id', 'fail'],
    ]);
    expect(
      compareExecution(
        { id: 'r', examples: [jsonExample('ok', 200, USER)] },
        result(200, JSON.stringify(USER)),
      ),
    ).toMatchObject({ result: { outcome: 'pass', findings: [] } });
  });

  it('no examples: no baseline; no response: nothing to compare', () => {
    expect(compareExecution({ id: 'r', examples: [] }, result(200, '{}'))).toEqual({
      kind: 'no-baseline',
      requestId: 'r',
    });
    expect(
      compareExecution({ id: 'r', examples: [] }, {
        ...result(200, '{}'),
        response: undefined,
      } as ExecutionResult),
    ).toBeUndefined();
  });

  it('HTML vs a JSON baseline: content type changed, body not compared', () => {
    const outcome = compareExecution(
      { id: 'r', examples: [jsonExample('ok', 200, USER)] },
      result(200, '<h1>hi</h1>', 'text/html; charset=utf-8'),
    );
    expect(outcome?.kind === 'compared' && outcome.result.findings).toEqual([
      expect.objectContaining({
        kind: 'body.contentType.changed',
        severity: 'fail',
        actual: 'text/html',
      }),
    ]);
  });

  it('JSON that does not parse, text baselines and mode none', () => {
    const examples = [jsonExample('ok', 200, USER)];
    const broken = compareExecution({ id: 'r', examples }, result(200, '{oops'));
    expect(broken?.kind === 'compared' && broken.result.findings[0]).toMatchObject({
      kind: 'body.parse.failed',
      severity: 'fail',
    });
    const text = compareExecution(
      { id: 'r', examples: [example('t', 200, { kind: 'text', text: 'hello', format: 'text' })] },
      result(200, 'hello', 'text/plain'),
    );
    expect(text?.kind === 'compared' && text.result).toMatchObject({
      outcome: 'pass',
      findings: [{ severity: 'info', message: 'Text body not compared structurally' }],
    });
    const none = compareExecution({ id: 'r', examples }, result(200, '{oops'), {
      ...projectBodySettings({}),
      mode: 'none',
    });
    expect(none?.kind === 'compared' && none.result.outcome).toBe('pass');
  });

  it('reads project defaults from pigeon.json comparison.body, ignoring invalid values', () => {
    expect(projectBodySettings({})).toEqual({
      mode: 'schema',
      additionalFields: 'warn',
      distinguishIntegers: false,
    });
    expect(
      projectBodySettings({ comparison: { body: { additionalFields: 'fail', mode: 'weird' } } }),
    ).toEqual({ mode: 'schema', additionalFields: 'fail', distinguishIntegers: false });
    const strict = compareExecution(
      { id: 'r', examples: [jsonExample('ok', 200, USER)] },
      result(200, JSON.stringify({ ...USER, extra: 1 })),
      projectBodySettings({ comparison: { body: { additionalFields: 'fail' } } }),
    );
    expect(strict?.kind === 'compared' && strict.result.outcome).toBe('fail');
  });

  it('keeps the latest comparison per request, bounded', () => {
    let kept = {};
    for (let i = 0; i < LAST_COMPARISONS_LIMIT + 5; i++) {
      kept = rememberComparison(kept, { requestId: `r${i}` } as never);
    }
    kept = rememberComparison(kept, { requestId: 'r6', outcome: 'pass' } as never);
    const ids = Object.keys(kept);
    expect(ids).toHaveLength(LAST_COMPARISONS_LIMIT);
    expect(ids.at(-1)).toBe('r6');
    expect(ids).not.toContain('r0');
  });
});
