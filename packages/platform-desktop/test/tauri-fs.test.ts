import type { ProjectFileSystem } from '@pigeon/platform';
import { FsError, MemoryFs } from '@pigeon/platform';
import { fsConformance } from '@pigeon/platform/conformance';
import { describe, expect, it } from 'vitest';

import type { Invoke } from '../src/native-transport';
import { TauriFs, toFsError } from '../src/tauri-fs';

const decoder = new TextDecoder();

/** A stand-in for the Rust commands: same arguments and error shape, backed by `MemoryFs`. */
function memoryInvoke(root: string, fs = new MemoryFs()): { invoke: Invoke; calls: string[] } {
  const calls: string[] = [];
  const checkRoot = (args: Record<string, unknown>) => {
    if (args['root'] !== root) throw { code: 'io', path: '', message: 'no access' };
  };
  const invoke: Invoke = async <T>(cmd: string, args?: Record<string, unknown> | Uint8Array) => {
    calls.push(cmd);
    try {
      if (args instanceof Uint8Array) {
        const length = new DataView(args.buffer, args.byteOffset).getUint32(0, true);
        const meta = JSON.parse(decoder.decode(args.subarray(4, 4 + length))) as {
          root: string;
          path: string;
        };
        checkRoot(meta);
        await fs.writeFileAtomic(meta.path, args.slice(4 + length));
        return undefined as T;
      }
      const a = args ?? {};
      checkRoot(a);
      switch (cmd) {
        case 'project_fs_read': {
          const bytes = await fs.readFile(a['path'] as string);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as T;
        }
        case 'project_fs_stat':
          return (await fs.stat(a['path'] as string)) as T;
        case 'project_fs_list':
          return (await fs.list(a['dir'] as string, { recursive: a['recursive'] as boolean })) as T;
        case 'project_fs_mkdirp':
          return (await fs.mkdirp(a['dir'] as string)) as T;
        case 'project_fs_remove':
          return (await fs.remove(a['path'] as string, {
            recursive: a['recursive'] as boolean,
          })) as T;
        case 'project_fs_rename':
          return (await fs.rename(a['from'] as string, a['to'] as string)) as T;
        default:
          throw `unknown command ${cmd}`;
      }
    } catch (error) {
      if (error instanceof FsError)
        throw { code: error.code, path: error.path, message: error.message };
      throw error;
    }
  };
  return { invoke, calls };
}

fsConformance('TauriFs (IPC contract)', (): ProjectFileSystem => {
  const root = 'C:\\Users\\Ada\\My Project';
  return new TauriFs(root, { invoke: memoryInvoke(root).invoke });
});

describe('TauriFs', () => {
  it('names its native root and sends it with every command', async () => {
    const { invoke, calls } = memoryInvoke('/repo/api');
    const fs = new TauriFs('/repo/api', { invoke });
    expect(fs.root).toEqual({ kind: 'native', absolutePath: '/repo/api' });
    await fs.writeFileAtomic('pigeon.json', '{}');
    expect(await fs.readText('pigeon.json')).toBe('{}');
    expect(calls).toEqual(['project_fs_write', 'project_fs_read']);
  });

  it('rejects invalid paths before calling Rust', async () => {
    const { invoke, calls } = memoryInvoke('/r');
    await expect(new TauriFs('/r', { invoke }).readFile('../x')).rejects.toMatchObject({
      code: 'invalid-path',
    });
    expect(calls).toEqual([]);
  });

  it('maps unexpected failures to plain errors', async () => {
    const fs = new TauriFs('/elsewhere', { invoke: memoryInvoke('/r').invoke });
    await expect(fs.readFile('a')).rejects.toThrow('no access');
    expect(toFsError('ipc missing')).toEqual(new Error('ipc missing'));
    expect(toFsError(42).message).toBe('The file operation failed.');
    expect(toFsError({ code: 'not-found', path: 'a', message: 'gone' })).toBeInstanceOf(FsError);
  });
});
