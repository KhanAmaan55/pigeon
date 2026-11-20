import { describe, expect, it } from 'vitest';

import { compareJson, inferSchema } from '../../src/index';

/** ~5 MB of JSON: 18,000 users with nested arrays and objects. */
function bigBody(changed = false): unknown {
  return {
    page: { size: 18_000, next: null },
    users: Array.from({ length: 18_000 }, (_, i) => ({
      id: i,
      uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `User number ${i}`,
      email: `user${i}@example.test`,
      active: i % 3 !== 0,
      score: i * 1.5,
      roles: ['reader', i % 5 === 0 ? 'admin' : 'writer'],
      address: { street: `${i} Main Street`, city: 'Springfield', zip: String(10000 + i) },
      ...(changed && i % 2 === 0 ? {} : { tags: [{ key: 'tier', value: `t${i % 4}` }] }),
    })),
  };
}

describe('comparison performance (pnpm test:perf)', () => {
  it('infers and compares a 5 MB body in under 300 ms', () => {
    const baseline = bigBody();
    const actual = bigBody(true);
    expect(JSON.stringify(baseline).length).toBeGreaterThan(5_000_000);
    let best = Number.POSITIVE_INFINITY;
    let findings: ReturnType<typeof compareJson> = [];
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      findings = compareJson(inferSchema(baseline), actual);
      best = Math.min(best, performance.now() - started);
    }
    // Every other user lost `tags`: one de-duplicated finding.
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ schemaPath: '$.users[*].tags', count: 9_000 });
    expect(best).toBeLessThan(300);
  });
});
