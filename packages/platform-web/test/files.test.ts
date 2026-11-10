import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FileEnvironment } from '../src/index';
import { WebFileExchange } from '../src/index';

afterEach(() => {
  vi.useRealTimers();
});

const BYTES = new Uint8Array([0, 255, 0xf0, 0x9f, 0x90, 0xa6, 13, 10]);

function fakeDocument() {
  const links: Array<{ href: string; download: string; click: () => void; clicked: number }> = [];
  const document = {
    createElement: (tag: string) => {
      expect(tag).toBe('a');
      const link = {
        href: '',
        download: '',
        rel: '',
        style: {},
        clicked: 0,
        click() {
          link.clicked++;
        },
        remove: vi.fn(),
      };
      links.push(link);
      return link;
    },
    body: { append: vi.fn() },
  } as unknown as Document;
  return { document, links };
}

describe('WebFileExchange.saveFile', () => {
  it('writes the exact bytes through showSaveFilePicker where the browser has it', async () => {
    const written: Blob[] = [];
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({
        write: async (data: Blob | BufferSource | string) => {
          written.push(data as Blob);
        },
        close: async () => undefined,
      }),
    }));
    const env = {
      ...fakeDocument(),
      URL,
      showSaveFilePicker,
    } satisfies FileEnvironment & object;
    const result = await new WebFileExchange(env).saveFile('body.bin', BYTES, 'application/x-test');

    expect(result).toBe('saved');
    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'body.bin' });
    expect(written[0]?.type).toBe('application/x-test');
    expect(new Uint8Array(await written[0]!.arrayBuffer())).toEqual(BYTES);
  });

  it('reports a dismissed picker as cancelled', async () => {
    const env: FileEnvironment = {
      ...fakeDocument(),
      URL,
      showSaveFilePicker: async () => {
        throw new DOMException('The user aborted a request.', 'AbortError');
      },
    };
    expect(await new WebFileExchange(env).saveFile('a.txt', 'x', 'text/plain')).toBe('cancelled');
  });

  it('downloads a Blob of the exact bytes when there is no picker', async () => {
    vi.useFakeTimers();
    const { document, links } = fakeDocument();
    const blobs: Blob[] = [];
    const url = {
      createObjectURL: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return 'blob:pigeon/1';
      }),
      revokeObjectURL: vi.fn(),
    };
    const result = await new WebFileExchange({ document, URL: url }).saveFile(
      '🐦-ünï.json',
      BYTES,
      'application/json',
    );

    expect(result).toBe('saved');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ href: 'blob:pigeon/1', download: '🐦-ünï.json', clicked: 1 });
    expect(new Uint8Array(await blobs[0]!.arrayBuffer())).toEqual(BYTES);
    expect(url.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:pigeon/1');
  });

  it('encodes string data as UTF-8', async () => {
    const blobs: Blob[] = [];
    const url = {
      createObjectURL: (blob: Blob) => (blobs.push(blob), 'blob:x'),
      revokeObjectURL: () => undefined,
    };
    vi.useFakeTimers();
    await new WebFileExchange({ ...fakeDocument(), URL: url }).saveFile(
      'a.txt',
      'é✓',
      'text/plain',
    );
    expect(await blobs[0]!.text()).toBe('é✓');
  });
});
