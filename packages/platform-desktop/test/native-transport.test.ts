import type { FileRef, PreparedRequest, RawResponse } from '@pigeon/platform';
import { PickedFileStore, TransportError } from '@pigeon/platform';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import type { Invoke } from '../src/index';
import { decodeResponseFrame, encodeRequestFrame, NativeTransport } from '../src/index';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function prepared(overrides: Partial<PreparedRequest> = {}): PreparedRequest {
  return {
    id: 'exec-1',
    method: 'GET',
    url: 'http://127.0.0.1:4010/json/user',
    headers: [],
    settings: { timeoutMs: 30_000, followRedirects: true, maxRedirects: 10, strictSSL: true },
    meta: { protocol: 'http', unresolved: [], secretValues: [] },
    ...overrides,
  };
}

/** Splits a request frame the way http.rs does. */
function readRequestFrame(frame: Uint8Array): { meta: Record<string, unknown>; body: Uint8Array } {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const length = view.getUint32(0, true);
  return {
    meta: JSON.parse(decoder.decode(frame.subarray(4, 4 + length))) as Record<string, unknown>,
    body: frame.subarray(4 + length),
  };
}

/** Builds a response frame the way http.rs does. */
function responseFrame(meta: Omit<RawResponse, 'body'>, body: Uint8Array): ArrayBuffer {
  const json = encoder.encode(JSON.stringify(meta));
  const frame = new Uint8Array(4 + json.length + body.length);
  new DataView(frame.buffer).setUint32(0, json.length, true);
  frame.set(json, 4);
  frame.set(body, 4 + json.length);
  return frame.buffer;
}

const META: Omit<RawResponse, 'body'> = {
  status: 200,
  statusText: 'OK',
  headers: [
    ['set-cookie', 'a=1'],
    ['set-cookie', 'b=2'],
  ],
  url: 'http://127.0.0.1:4010/echo',
  redirects: [{ status: 302, url: 'http://127.0.0.1:4010/redirect/1', location: '/echo' }],
  httpVersion: 'HTTP/1.1',
  timings: { startedAt: 1_700_000_000_000, totalMs: 12.5, ttfbMs: 10 },
  headersRestricted: false,
  warnings: [],
};

function fakeInvoke(impl: (cmd: string, args: unknown) => unknown) {
  return vi.fn(async (cmd: string, args?: unknown) => impl(cmd, args)) as unknown as Invoke &
    ReturnType<typeof vi.fn>;
}

const signal = () => new AbortController().signal;

describe('request frames', () => {
  it('carry the PreparedRequest as JSON with the body bytes appended raw', () => {
    const bytes = new Uint8Array([0, 0xff, 0x80, 10]);
    const frame = encodeRequestFrame(
      prepared({
        method: 'POST',
        headers: [
          ['X-A', '1'],
          ['X-A', '2'],
        ],
        body: { kind: 'bytes', bytes },
        meta: { projectId: 'p1', protocol: 'http', unresolved: [], secretValues: [] },
      }),
    );
    const { meta, body } = readRequestFrame(frame);
    expect(meta).toEqual({
      id: 'exec-1',
      method: 'POST',
      url: 'http://127.0.0.1:4010/json/user',
      headers: [
        ['X-A', '1'],
        ['X-A', '2'],
      ],
      body: { kind: 'bytes' },
      settings: { timeoutMs: 30_000, followRedirects: true, maxRedirects: 10, strictSSL: true },
      meta: { projectId: 'p1', protocol: 'http', unresolved: [], secretValues: [] },
    });
    expect(body).toEqual(bytes);
  });

  it('omit the body entirely for bodyless requests', () => {
    const { meta, body } = readRequestFrame(encodeRequestFrame(prepared()));
    expect(meta).not.toHaveProperty('body');
    expect(body.byteLength).toBe(0);
  });

  it('send absolute file paths for http.rs to read and picked files inline', () => {
    const pickedFiles = new PickedFileStore();
    const png = pickedFiles.add({ name: 'a.png', bytes: new Uint8Array([1, 2, 3]) });
    const csv = pickedFiles.add({ name: 'b.csv', bytes: new Uint8Array([4, 5]) });
    const { meta, body } = readRequestFrame(
      encodeRequestFrame(
        prepared({
          method: 'POST',
          body: {
            kind: 'multipart',
            parts: [
              { name: 't', kind: 'text', value: 'v', contentType: 'text/plain' },
              { name: 'f1', kind: 'file', file: png, filename: 'a.png', contentType: 'image/png' },
              {
                name: 'f2',
                kind: 'file',
                file: { kind: 'absolute', path: '/x/y.bin' },
                filename: 'y.bin',
              },
              { name: 'f3', kind: 'file', file: csv, filename: 'b.csv' },
            ],
          },
        }),
        pickedFiles,
      ),
    );
    expect(meta['body']).toEqual({
      kind: 'multipart',
      parts: [
        { name: 't', kind: 'text', value: 'v', contentType: 'text/plain' },
        {
          name: 'f1',
          kind: 'file',
          file: { kind: 'inline', offset: 0, length: 3 },
          filename: 'a.png',
          contentType: 'image/png',
        },
        {
          name: 'f2',
          kind: 'file',
          file: { kind: 'absolute', path: '/x/y.bin' },
          filename: 'y.bin',
        },
        {
          name: 'f3',
          kind: 'file',
          file: { kind: 'inline', offset: 3, length: 2 },
          filename: 'b.csv',
        },
      ],
    });
    expect(body).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('send binary bodies by path, or picked bytes as a plain body', () => {
    const byPath = readRequestFrame(
      encodeRequestFrame(
        prepared({ method: 'POST', body: { kind: 'file', ref: { kind: 'absolute', path: '/x' } } }),
      ),
    );
    expect(byPath.meta['body']).toEqual({ kind: 'file', ref: { kind: 'absolute', path: '/x' } });
    expect(byPath.body.byteLength).toBe(0);

    const pickedFiles = new PickedFileStore();
    const ref = pickedFiles.add({ name: 'a.bin', bytes: new Uint8Array([7, 8]) });
    const picked = readRequestFrame(
      encodeRequestFrame(prepared({ method: 'POST', body: { kind: 'file', ref } }), pickedFiles),
    );
    expect(picked.meta['body']).toEqual({ kind: 'bytes' });
    expect(picked.body).toEqual(new Uint8Array([7, 8]));
  });

  it('reject files they cannot read as file-unavailable', () => {
    const unavailable = (ref: FileRef) => {
      try {
        encodeRequestFrame(
          prepared({
            method: 'POST',
            body: {
              kind: 'multipart',
              parts: [{ name: 'f', kind: 'file', file: ref, filename: 'a' }],
            },
          }),
          new PickedFileStore(),
        );
      } catch (error) {
        return error;
      }
      throw new Error('expected a rejection');
    };
    for (const ref of [
      { kind: 'picked', id: 'gone' },
      { kind: 'project', path: 'files/a.png' },
    ] as const) {
      const error = unavailable(ref);
      expect(error).toBeInstanceOf(TransportError);
      expect(error).toMatchObject({ kind: 'file-unavailable' });
    }
  });
});

describe('response frames', () => {
  it('decode metadata and expose the body as a view without copying', () => {
    const buffer = responseFrame(META, new Uint8Array([1, 2, 3]));
    const res = decodeResponseFrame(buffer);
    expect(res).toMatchObject(META);
    expect(res.body).toEqual(new Uint8Array([1, 2, 3]));
    expect(res.body.buffer).toBe(buffer);
  });
});

describe('NativeTransport', () => {
  it('invokes http_send with the binary frame and returns the decoded response', async () => {
    const invoke = fakeInvoke(() => responseFrame(META, encoder.encode('{"ok":true}')));
    const res = await new NativeTransport({ invoke }).send(prepared(), { signal: signal() });

    expect(invoke).toHaveBeenCalledTimes(1);
    const [cmd, frame] = invoke.mock.calls[0] as [string, Uint8Array];
    expect(cmd).toBe('http_send');
    expect(frame).toBeInstanceOf(Uint8Array);
    expect(readRequestFrame(frame).meta['id']).toBe('exec-1');
    expect(decoder.decode(res.body)).toBe('{"ok":true}');
    expect(res.headers).toEqual(META.headers);
    expect(res.redirects).toEqual(META.redirects);
  });

  it('turns command failures into TransportErrors', async () => {
    const invoke = fakeInvoke(() => {
      throw { kind: 'connection-refused', message: 'Refused', detail: 'os error 61' };
    });
    const error = await new NativeTransport({ invoke })
      .send(prepared(), { signal: signal() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({
      kind: 'connection-refused',
      message: 'Refused',
      detail: 'os error 61',
    });
  });

  it('reports IPC errors (plain strings) as unknown', async () => {
    const invoke = fakeInvoke(() => {
      throw 'http_send not allowed. Permissions associated with this command: allow-http-send';
    });
    await expect(
      new NativeTransport({ invoke }).send(prepared(), { signal: signal() }),
    ).rejects.toMatchObject({
      kind: 'unknown',
      detail: expect.stringContaining('allow-http-send') as unknown,
    });
  });

  it('rejects with signal.reason at once on abort and cancels the native request', async () => {
    let finish: (value: ArrayBuffer) => void = () => undefined;
    const invoke = fakeInvoke((cmd) =>
      cmd === 'http_send' ? new Promise((resolve) => (finish = resolve)) : true,
    );
    const controller = new AbortController();
    const pending = new NativeTransport({ invoke }).send(prepared({ id: 'exec-9' }), {
      signal: controller.signal,
    });
    const reason = new Error('stop');
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(invoke).toHaveBeenCalledWith('http_cancel', { id: 'exec-9' });
    finish(responseFrame(META, new Uint8Array())); // a late answer is ignored
  });

  it('never invokes for an already-aborted signal', async () => {
    const invoke = fakeInvoke(() => undefined);
    const controller = new AbortController();
    controller.abort(new Error('early'));
    await expect(
      new NativeTransport({ invoke }).send(prepared(), { signal: controller.signal }),
    ).rejects.toThrow('early');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not cancel after the response arrived', async () => {
    const invoke = fakeInvoke(() => responseFrame(META, new Uint8Array()));
    const controller = new AbortController();
    await new NativeTransport({ invoke }).send(prepared(), { signal: controller.signal });
    controller.abort();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
