import { generateLargeProject } from '@pigeon/fixtures';
import { MemoryAppState, MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import { ProjectSession } from '../../src/index';

/** ui-ux.md §7: open a 5,000-request project in < 2 s (the read itself; UI measured in E2E). */
describe('large project budget (PIGN-042)', () => {
  it('reads 5,000 requests, 500 folders and 1,000 examples within the budget', async () => {
    const files = generateLargeProject();
    const fs = new MemoryFs();
    for (const [path, text] of Object.entries(files)) await fs.writeFileAtomic(path, text);
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      const session = await ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
      best = Math.min(best, performance.now() - started);
      expect(session.problems).toEqual([]);
    }
    console.log(`open 5,000-request project (core): ${best.toFixed(0)} ms`);
    // 2 s budget with 20 % tolerance (testing.md §3.7, PIGN-042).
    expect(best).toBeLessThan(2400);
  }, 60_000);
});
