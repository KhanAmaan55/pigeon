import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import type { Invoke } from '../src/index';
import { DesktopFileExchange, encodeSaveFrame } from '../src/index';

const decoder = new TextDecoder();

function readFrame(frame: Uint8Array) {
  const length = new DataView(frame.buffer, frame.byteOffset).getUint32(0, true);
  return {
    meta: JSON.parse(decoder.decode(frame.subarray(4, 4 + length))) as unknown,
    bytes: frame.subarray(4 + length),
  };
}

describe('DesktopFileExchange.saveFile', () => {
  it('sends the name, type and exact bytes to save_file in one frame', async () => {
    const bytes = new Uint8Array([0, 255, 13, 10, 0xf0, 0x9f, 0x90, 0xa6]);
    const invoke = vi.fn(async () => 'saved') as unknown as Invoke & ReturnType<typeof vi.fn>;
    const result = await new DesktopFileExchange({ invoke }).saveFile(
      '🐦.bin',
      bytes,
      'application/octet-stream',
    );

    expect(result).toBe('saved');
    const [cmd, frame] = invoke.mock.calls[0] as [string, Uint8Array];
    expect(cmd).toBe('save_file');
    expect(readFrame(frame)).toEqual({
      meta: { suggestedName: '🐦.bin', mime: 'application/octet-stream' },
      bytes,
    });
  });

  it('passes cancellation through and turns failures into errors', async () => {
    const cancelled = new DesktopFileExchange({ invoke: (async () => 'cancelled') as Invoke });
    expect(await cancelled.saveFile('a', 'x', 'text/plain')).toBe('cancelled');

    const failing = new DesktopFileExchange({
      invoke: (async () => {
        throw 'Could not write /x/a: Permission denied';
      }) as Invoke,
    });
    await expect(failing.saveFile('a', 'x', 'text/plain')).rejects.toThrow(
      'Could not write /x/a: Permission denied',
    );
  });

  it('encodes string data as UTF-8', () => {
    expect(readFrame(encodeSaveFrame('a.txt', 'é', 'text/plain')).bytes).toEqual(
      new Uint8Array([0xc3, 0xa9]),
    );
  });
});
