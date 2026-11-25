import { describe, expect, it } from 'vitest';

import { DesktopGitStatus } from '../src/git';
import type { Invoke } from '../src/native-transport';

describe('DesktopGitStatus (PIGN-057)', () => {
  it('asks Rust for the status of a native project root only', async () => {
    const calls: Array<[string, unknown]> = [];
    const invoke: Invoke = async <T>(cmd: string, args?: Record<string, unknown> | Uint8Array) => {
      calls.push([cmd, args]);
      return {
        available: true,
        repository: { branch: 'main', files: [], path: '', ignored: false },
      } as T;
    };
    const git = new DesktopGitStatus({ invoke });
    expect(await git.status({ kind: 'native', absolutePath: '/work/api' })).toEqual({
      available: true,
      repository: { branch: 'main', files: [], path: '', ignored: false },
    });
    expect(calls).toEqual([['git_status', { root: '/work/api' }]]);
    expect(await git.status({ kind: 'memory', id: 'x' })).toEqual({
      available: false,
      repository: null,
    });
    expect(calls).toHaveLength(1);
  });
});
