import { describe, expect, it } from 'vitest';

import { groupFindings } from '../src/features/compare/CompareTab';

describe('groupFindings', () => {
  it('groups by section and sorts each by severity', () => {
    const groups = groupFindings([
      { kind: 'body.field.added', severity: 'warn', message: 'a' },
      { kind: 'body.field.removed', severity: 'ignored', message: 'b' },
      { kind: 'status.changed', severity: 'fail', message: 'c' },
      { kind: 'body.type.changed', severity: 'fail', message: 'd' },
      { kind: 'body.array.length', severity: 'info', message: 'e' },
      { kind: 'header.missing', severity: 'warn', message: 'f' },
    ]);
    expect(groups.map((g) => [g.title, g.findings.map((f) => f.message)])).toEqual([
      ['Status', ['c']],
      ['Headers', ['f']],
      ['Body', ['d', 'a', 'e', 'b']],
    ]);
  });
});
