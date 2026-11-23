import { generateLargeProject } from '@pigeon/fixtures';
import { MemoryAppState, MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import { ProjectSession } from '../src/index';

/** Loads generated files into a session (PIGN-042 performance fixture). */
export async function openGenerated(files: Record<string, string>) {
  const fs = new MemoryFs();
  for (const [path, text] of Object.entries(files)) await fs.writeFileAtomic(path, text);
  return ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
}

describe('generated large project (PIGN-042)', () => {
  it('reads without problems, with the requested shape, and saves for commit as a no-op', async () => {
    const session = await openGenerated(
      generateLargeProject({ requests: 60, folders: 6, examples: 12 }),
    );
    expect(session.problems).toEqual([]);
    const [collection] = session.getWorkingModel().collections;
    expect(collection?.children).toHaveLength(6);
    const requests = collection!.children.flatMap((folder) =>
      folder.kind === 'folder' ? folder.children : [],
    );
    expect(requests).toHaveLength(60);
    expect(requests.reduce((n, r) => n + (r.kind === 'request' ? r.examples.length : 0), 0)).toBe(
      12,
    );
    const plan = await session.planCommit();
    expect(plan.writes).toEqual([]);
  });
});
