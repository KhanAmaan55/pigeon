import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  applyRules,
  compareBinary,
  compareHeaders,
  compareStatus,
  compareText,
  compareValues,
  dynamicHint,
  mediaTypeOf,
} from '../src/index';

describe('status (§3.1)', () => {
  it.each([
    [200, 201, 'exact', 1],
    [200, 201, 'class', 0],
    [200, 404, 'class', 1],
    [200, 500, 'ignore', 0],
    [204, 204, 'exact', 0],
  ] as const)('%i vs %i in %s: %i finding(s)', (baseline, actual, mode, count) => {
    const findings = compareStatus(baseline, actual, mode);
    expect(findings).toHaveLength(count);
    if (count) expect(findings[0]).toMatchObject({ kind: 'status.changed', severity: 'fail' });
  });
});

describe('headers (§3.2)', () => {
  const json: Array<[string, string]> = [['Content-Type', 'application/json; charset=utf-8']];
  it('media-type mode ignores parameters and case', () => {
    expect(compareHeaders(json, [['content-type', 'Application/JSON']])).toEqual([]);
    expect(compareHeaders(json, [['Content-Type', 'text/html']])).toEqual([
      expect.objectContaining({ kind: 'header.changed', severity: 'fail', path: 'content-type' }),
    ]);
    expect(mediaTypeOf('text/plain; charset=x')).toBe('text/plain');
  });

  it('value and presence modes, missing, added and ignored headers', () => {
    const opts = { compare: ['Content-Type', 'x-version', 'etag'], mode: 'value' as const };
    const findings = compareHeaders(
      [...json, ['X-Version', '1']],
      [
        ['Content-Type', 'application/json'],
        ['ETag', '"a"'],
      ],
      opts,
    );
    expect(findings.map((f) => [f.kind, f.path, f.severity])).toEqual([
      ['header.changed', 'content-type', 'fail'],
      ['header.missing', 'x-version', 'fail'],
      ['header.added', 'etag', 'info'],
    ]);
    expect(compareHeaders(json, [['Content-Type', 'text/html']], { mode: 'presence' })).toEqual([]);
    expect(compareHeaders([['X-A', '1']], [], { compare: ['x-a'], ignore: ['X-A'] })).toEqual([]);
  });

  it('a compared header hidden by the browser (CORS) is a warning, not a failure', () => {
    expect(
      compareHeaders([['X-Trace', '1']], [], { compare: ['x-trace'], restricted: true }),
    ).toEqual([expect.objectContaining({ kind: 'header.missing', severity: 'warn' })]);
  });
});

describe('values mode (§4.4)', () => {
  it('scalar changes fail; type changes are left to the structural comparator', () => {
    expect(compareValues({ name: 'Ada', n: 1 }, { name: 'Grace', n: '1' })).toEqual([
      expect.objectContaining({
        kind: 'body.value.changed',
        path: '$.name',
        baseline: 'Ada',
        actual: 'Grace',
        message: 'Value changed: "Ada" → "Grace"',
      }),
    ]);
  });

  it('dynamic rules accept changed values; hints point at generated ones', () => {
    const findings = compareValues(
      { updatedAt: '2026-01-01T00:00:00Z', name: 'a' },
      { updatedAt: '2026-11-20T10:00:00Z', name: 'a' },
    );
    expect(findings[0]).toMatchObject({ path: '$.updatedAt', hint: 'iso-date' });
    expect(applyRules(findings, [{ path: '$.updatedAt', dynamic: true }])).toEqual([]);
  });

  it('arrays by index: element by element, length changes fail', () => {
    expect(compareValues([1, 2, 3], [1, 5]).map((f) => [f.kind, f.path])).toEqual([
      ['body.array.length', '$'],
      ['body.value.changed', '$[1]'],
    ]);
    expect(compareValues([1, 2], [2, 1], { arrays: 'schema' })).toEqual([]);
  });

  it('matchBy pairs elements by key, so reordering is fine', () => {
    const before = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 3, name: 'c' },
    ];
    const after = [
      { id: 2, name: 'b' },
      { id: 1, name: 'A' },
      { id: 4, name: 'd' },
    ];
    expect(
      compareValues(before, after, { arrays: { matchBy: 'id' } }).map((f) => [
        f.kind,
        f.path,
        f.message,
      ]),
    ).toEqual([
      ['body.field.added', '$[2]', 'Element added (id = 4)'],
      ['body.field.removed', '$[2]', 'Element removed (id = 3)'],
      ['body.value.changed', '$[1].name', 'Value changed: "a" → "A"'],
    ]);
    expect(compareValues(before, [...before].reverse(), { arrays: { matchBy: 'id' } })).toEqual([]);
  });

  it('property: comparing any JSON with itself finds nothing in values mode', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(compareValues(value, structuredClone(value))).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});

describe('text and binary bodies (§3.3)', () => {
  it('values mode detects a change; schema mode reports info only', () => {
    expect(compareText('a\nb', 'a\nc', 'values')).toEqual([
      expect.objectContaining({
        severity: 'fail',
        message: 'Text body changed (first difference on line 2)',
      }),
    ]);
    expect(compareText('a', 'a', 'values')).toEqual([]);
    expect(compareText('a', 'b', 'schema')).toEqual([
      expect.objectContaining({ severity: 'info', message: 'Text body not compared structurally' }),
    ]);
    expect(
      compareBinary({ hash: 'x', size: 3 }, { hash: 'y', size: 3 }, 'values')[0]?.severity,
    ).toBe('fail');
    expect(compareBinary({ hash: 'x', size: 3 }, { hash: 'x', size: 3 }, 'values')).toEqual([]);
  });
});

describe('dynamic value hints (§5)', () => {
  it.each([
    ['5f0c1a3e-9b7d-4c2e-8f6a-1d2e3f4a5b6c', 'uuid'],
    ['2026-11-20T10:00:00.123Z', 'iso-date'],
    ['2026-11-20', 'iso-date'],
    [1763632800, 'unix-timestamp'],
    [1763632800123, 'unix-timestamp'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlLXZhbHVl', 'jwt'],
    ['a3f5c9e1b2d4f6a8c0e2b4d6f8a0c2e4', 'hex-token'],
    ['Ada Lovelace', undefined],
    [42, undefined],
    [true, undefined],
  ] as const)('%s → %s', (value, hint) => {
    expect(dynamicHint(value)).toBe(hint);
  });
});
