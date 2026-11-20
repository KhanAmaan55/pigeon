import type { ProjectComparisonConfig, ProjectExample } from '@pigeon/formats';
import { describe, expect, it } from 'vitest';

import type { ExecutionResult } from '../src/index';
import { compareExecution, effectiveComparison, normalizeResponse } from '../src/index';

function example(
  code: number,
  body: ProjectExample['response']['body'],
  headers: Array<[string, string]> = [['Content-Type', 'application/json; charset=utf-8']],
): ProjectExample {
  return {
    id: 'ex',
    fileKey: 'ex',
    requestId: 'r',
    name: 'baseline',
    response: {
      code,
      status: '',
      headers: headers.map(([key, value]) => ({ key, value })),
      cookies: [],
      body,
    },
    extra: {},
  };
}

function result(
  status: number,
  body: string,
  headers: Array<[string, string]> = [['Content-Type', 'application/json']],
  headersRestricted = false,
): ExecutionResult {
  return {
    id: 'exec',
    requestId: 'r',
    environmentId: null,
    startedAt: '',
    transport: 'mock',
    request: { method: 'GET', url: '', headers: [] },
    warnings: [],
    response: normalizeResponse({
      status,
      statusText: '',
      headers,
      body: new TextEncoder().encode(body),
      url: '',
      redirects: [],
      timings: { startedAt: 0, totalMs: 1 },
      headersRestricted,
    }),
  } as unknown as ExecutionResult;
}

function run(
  baseline: ProjectExample,
  actual: ExecutionResult,
  config?: ProjectComparisonConfig,
  project: Record<string, unknown> = {},
) {
  const effective = effectiveComparison(
    { comparison: project },
    config ? { comparison: config } : {},
  );
  const outcome = compareExecution({ id: 'r', examples: [baseline] }, actual, effective.body, {
    ...effective,
    baseline: { mode: 'example', exampleId: 'ex' },
  });
  if (outcome?.kind !== 'compared') throw new Error('not compared');
  return outcome.result;
}

const json = (value: unknown) => ({
  kind: 'text' as const,
  text: JSON.stringify(value),
  format: 'json' as const,
});

describe('status, headers and values (PIGN-036)', () => {
  it('200 vs 201 fails in exact, passes in class', () => {
    expect(run(example(200, json({})), result(201, '{}')).outcome).toBe('fail');
    expect(
      run(example(200, json({})), result(201, '{}'), { status: 'class', rules: [], extra: {} })
        .outcome,
    ).toBe('pass');
  });

  it('application/json; charset=utf-8 vs application/json passes in media-type mode', () => {
    expect(run(example(200, json({})), result(200, '{}')).findings).toEqual([]);
    const strict = run(example(200, json({})), result(200, '{}'), {
      headers: { mode: 'value' },
      rules: [],
      extra: {},
    });
    expect(strict.findings[0]).toMatchObject({ kind: 'header.changed', severity: 'fail' });
  });

  it('a compared header hidden by CORS on the web is a warning', () => {
    const baseline = example(200, json({}), [
      ['Content-Type', 'application/json'],
      ['X-Version', '2'],
    ]);
    const findings = run(
      baseline,
      result(200, '{}', [['Content-Type', 'application/json']], true),
      undefined,
      {
        headers: { compare: ['content-type', 'x-version'] },
      },
    ).findings;
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'header.missing', severity: 'warn' }),
    ]);
  });

  it('values mode: changed name fails; dynamic updatedAt passes; matchBy handles reordering', () => {
    const values = { body: { mode: 'values' }, rules: [], extra: {} };
    const baseline = example(200, json({ name: 'Ada', updatedAt: '2026-01-01T00:00:00Z' }));
    const changed = run(
      baseline,
      result(200, JSON.stringify({ name: 'Grace', updatedAt: '2026-11-20T00:00:00Z' })),
      values,
    );
    expect(changed.findings.map((f) => [f.path, f.severity, f.hint])).toEqual([
      ['$.updatedAt', 'fail', 'iso-date'],
      ['$.name', 'fail', undefined],
    ]);
    const dynamic = run(
      baseline,
      result(200, JSON.stringify({ name: 'Ada', updatedAt: '2026-11-20T00:00:00Z' })),
      { ...values, rules: [{ path: '$.updatedAt', dynamic: true }] },
    );
    expect(dynamic.outcome).toBe('pass');
    const list = example(
      200,
      json([
        { id: 1, v: 'a' },
        { id: 2, v: 'b' },
      ]),
    );
    const reordered = result(
      200,
      JSON.stringify([
        { id: 2, v: 'b' },
        { id: 1, v: 'a' },
      ]),
    );
    expect(run(list, reordered, values).outcome).toBe('fail');
    expect(
      run(list, reordered, {
        body: { mode: 'values', arrays: { matchBy: 'id' } },
        rules: [],
        extra: {},
      }).outcome,
    ).toBe('pass');
  });

  it('text body: values mode detects a change, schema mode reports info only', () => {
    const text = example(200, { kind: 'text', text: 'hello', format: 'text' }, [
      ['Content-Type', 'text/plain'],
    ]);
    const changed = result(200, 'hello world', [['Content-Type', 'text/plain']]);
    expect(run(text, changed, { body: { mode: 'values' }, rules: [], extra: {} }).findings).toEqual(
      [expect.objectContaining({ kind: 'body.value.changed', severity: 'fail' })],
    );
    expect(run(text, changed).findings).toEqual([
      expect.objectContaining({ severity: 'info', message: 'Text body not compared structurally' }),
    ]);
  });
});
