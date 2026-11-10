import type { Capabilities, PreparedRequest } from '@pigeon/platform';
import { MEMORY_CAPABILITIES, MockTransport } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { Body, FormDataParam, RequestInit } from '../src/index';
import {
  autoHeaders,
  BodySchema,
  bodyDroppedWarning,
  createExecutionContext,
  createRequest,
  emptyBody,
  encodeBody,
  encodeFormUrlencoded,
  fileNameFromSrc,
  fileRefFromSrc,
  formEncode,
  hasBody,
  mediaTypeForFileName,
  MULTIPART_CONTENT_TYPE_PREVIEW,
  pickedFileSrc,
  prepareRequest,
  RequestExecutor,
  toMultipartParts,
  validateBody,
} from '../src/index';

const decoder = new TextDecoder();
const WEB = { canSendBodyWithGet: false, canSetAnyHeader: false } as const;

function ctx(capabilities: Partial<Capabilities> = {}) {
  return createExecutionContext({ capabilities: { ...MEMORY_CAPABILITIES, ...capabilities } });
}

async function prepared(init: RequestInit, capabilities?: Partial<Capabilities>) {
  const result = await prepareRequest(createRequest(init), ctx(capabilities));
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

const contentType = (req: PreparedRequest) =>
  req.headers.filter(([name]) => name.toLowerCase() === 'content-type').map(([, v]) => v);

const text = (key: string, value: string, extra: Partial<FormDataParam> = {}): FormDataParam => ({
  key,
  value,
  kind: 'text',
  ...extra,
});
const file = (key: string, src: string | string[], extra: Partial<FormDataParam> = {}) =>
  ({ key, value: '', kind: 'file', src, ...extra }) as FormDataParam;

describe('BodySchema', () => {
  it('accepts every mode and requires a kind on form-data rows', () => {
    const bodies: Body[] = [
      { mode: 'none' },
      { mode: 'raw', raw: '{}', language: 'json', disabled: true },
      { mode: 'urlencoded', params: [{ key: 'a', value: '1' }] },
      {
        mode: 'formdata',
        params: [text('a', '1'), file('f', ['/a', '/b'], { contentType: 'x/y' })],
      },
      { mode: 'file', src: '/tmp/a.bin' },
      { mode: 'file' },
    ];
    for (const body of bodies) expect(BodySchema.parse(body)).toEqual(body);
    expect(
      BodySchema.safeParse({ mode: 'formdata', params: [{ key: 'a', value: '1' }] }).success,
    ).toBe(false);
  });

  it('creates empty bodies per mode', () => {
    expect(emptyBody('raw')).toEqual({ mode: 'raw', raw: '', language: 'json' });
    expect(emptyBody('formdata')).toEqual({ mode: 'formdata', params: [] });
    expect(emptyBody('file')).toEqual({ mode: 'file' });
  });
});

describe('file sources', () => {
  it.each([
    [pickedFileSrc('id-1', 'photo.png'), { kind: 'picked', id: 'id-1' }, 'photo.png'],
    ['/Users/ada/report.csv', { kind: 'absolute', path: '/Users/ada/report.csv' }, 'report.csv'],
    ['C:\\data\\a b.bin', { kind: 'absolute', path: 'C:\\data\\a b.bin' }, 'a b.bin'],
    ['\\\\server\\share\\x.txt', { kind: 'absolute', path: '\\\\server\\share\\x.txt' }, 'x.txt'],
    ['./files/a.json', { kind: 'project', path: 'files/a.json' }, 'a.json'],
    ['files/a.json', { kind: 'project', path: 'files/a.json' }, 'a.json'],
  ])('%s → %j named %s', (src, ref, name) => {
    expect(fileRefFromSrc(src)).toEqual(ref);
    expect(fileNameFromSrc(src)).toBe(name);
  });

  it('treats an empty source as no file', () => {
    expect(fileRefFromSrc('')).toBeUndefined();
  });

  it('maps extensions to media types case-insensitively', () => {
    expect(mediaTypeForFileName('a.PNG')).toBe('image/png');
    expect(mediaTypeForFileName('data.json')).toBe('application/json');
    expect(mediaTypeForFileName('archive.tar.gz')).toBe('application/gzip');
    expect(mediaTypeForFileName('noext')).toBeUndefined();
    expect(mediaTypeForFileName('.env')).toBeUndefined();
    expect(mediaTypeForFileName('a.unknownext')).toBeUndefined();
  });
});

describe('urlencoded encoding', () => {
  it.each([
    ['plain', 'plain'],
    ['a b', 'a+b'],
    ['a+b', 'a%2Bb'],
    ['a&b=c', 'a%26b%3Dc'],
    ['é ✓', '%C3%A9+%E2%9C%93'],
    ["*-._~!'()", '*-._%7E%21%27%28%29'],
    ['100%', '100%25'],
    ['{{var}}', '%7B%7Bvar%7D%7D'],
  ])('%s → %s', (input, encoded) => {
    expect(formEncode(input)).toBe(encoded);
    // What `/echo` (URLSearchParams) reads back.
    expect(new URLSearchParams(`k=${encoded}`).get('k')).toBe(input);
  });

  it('skips disabled and empty rows and keeps order and duplicates', () => {
    expect(
      encodeFormUrlencoded([
        { key: 'a', value: '1' },
        { key: 'off', value: 'x', disabled: true },
        { key: '', value: '' },
        { key: 'a', value: '2' },
        { key: 'flag', value: '' },
        { key: '', value: 'v' },
      ]),
    ).toBe('a=1&a=2&flag=&=v');
  });
});

describe('multipart parts', () => {
  it('turns rows into text and file parts, one per file, in order', () => {
    const { parts, warnings } = toMultipartParts([
      text('name', 'Ada'),
      text('off', 'x', { disabled: true }),
      text('', ''),
      text('meta', '{}', { contentType: 'application/json' }),
      file('photos', [pickedFileSrc('p1', 'a.png'), '/tmp/b.JPG']),
      file('doc', '/tmp/notes', { contentType: ' text/plain ' }),
      file('raw', '/tmp/blob.weird'),
    ]);
    expect(parts).toEqual([
      { name: 'name', kind: 'text', value: 'Ada' },
      { name: 'meta', kind: 'text', value: '{}', contentType: 'application/json' },
      {
        name: 'photos',
        kind: 'file',
        file: { kind: 'picked', id: 'p1' },
        filename: 'a.png',
        contentType: 'image/png',
      },
      {
        name: 'photos',
        kind: 'file',
        file: { kind: 'absolute', path: '/tmp/b.JPG' },
        filename: 'b.JPG',
        contentType: 'image/jpeg',
      },
      {
        name: 'doc',
        kind: 'file',
        file: { kind: 'absolute', path: '/tmp/notes' },
        filename: 'notes',
        contentType: 'text/plain',
      },
      {
        name: 'raw',
        kind: 'file',
        file: { kind: 'absolute', path: '/tmp/blob.weird' },
        filename: 'blob.weird',
        contentType: 'application/octet-stream',
      },
    ]);
    expect(warnings).toEqual([]);
  });

  it('skips file rows without a file, with a warning when the row is named', () => {
    const { parts, warnings } = toMultipartParts([file('avatar', []), file('', '')]);
    expect(parts).toEqual([]);
    expect(warnings).toEqual(['Form field "avatar" has no file selected; it was not sent.']);
  });
});

describe('encodeBody', () => {
  it('sends raw text byte for byte, never re-serialized', () => {
    const raw = '{ "big": 12345678901234567890, "x": 1.0 ,\n "é": "✓" }';
    const { encoded } = encodeBody({ mode: 'raw', raw, language: 'json' });
    expect(encoded?.contentType).toBe('application/json');
    expect(encoded?.body.kind === 'bytes' && decoder.decode(encoded.body.bytes)).toBe(raw);
  });

  it.each([
    ['text', 'text/plain'],
    ['xml', 'application/xml'],
    ['html', 'text/html'],
    ['javascript', 'application/javascript'],
  ] as const)('raw %s defaults to %s', (language, type) => {
    expect(encodeBody({ mode: 'raw', raw: 'x', language }).encoded?.contentType).toBe(type);
  });

  it('encodes urlencoded params with their default content type', () => {
    const { encoded } = encodeBody({
      mode: 'urlencoded',
      params: [
        { key: 'q', value: 'a b&c' },
        { key: 'ü', value: '1' },
      ],
    });
    expect(encoded?.contentType).toBe('application/x-www-form-urlencoded');
    expect(encoded?.body.kind === 'bytes' && decoder.decode(encoded.body.bytes)).toBe(
      'q=a+b%26c&%C3%BC=1',
    );
  });

  it('leaves the multipart content type to the transport', () => {
    const { encoded } = encodeBody({ mode: 'formdata', params: [text('a', '1')] });
    expect(encoded).toEqual({
      body: { kind: 'multipart', parts: [{ name: 'a', kind: 'text', value: '1' }] },
    });
  });

  it('references binary files with a content type from the extension', () => {
    expect(encodeBody({ mode: 'file', src: pickedFileSrc('id', 'pic.webp') }).encoded).toEqual({
      body: { kind: 'file', ref: { kind: 'picked', id: 'id' } },
      contentType: 'image/webp',
    });
    expect(encodeBody({ mode: 'file', src: '/data/dump' }).encoded?.contentType).toBe(
      'application/octet-stream',
    );
  });

  it.each<Body>([
    { mode: 'none' },
    { mode: 'raw', raw: '', language: 'json' },
    { mode: 'raw', raw: 'x', language: 'json', disabled: true },
    { mode: 'urlencoded', params: [{ key: 'a', value: '1', disabled: true }] },
    { mode: 'formdata', params: [] },
    { mode: 'formdata', params: [file('f', [])] },
    { mode: 'file' },
  ])('sends nothing for %j', (body) => {
    expect(encodeBody(body).encoded).toBeUndefined();
    expect(hasBody(body)).toBe(false);
  });

  it('agrees with hasBody for bodies that are sent', () => {
    for (const body of [
      { mode: 'raw', raw: ' ', language: 'text' },
      { mode: 'urlencoded', params: [{ key: 'a', value: '' }] },
      { mode: 'formdata', params: [file('f', '/x')] },
      { mode: 'file', src: '/x' },
    ] satisfies Body[]) {
      expect(hasBody(body)).toBe(true);
      expect(encodeBody(body).encoded).toBeDefined();
    }
  });
});

describe('validateBody', () => {
  const encoded = encodeBody({ mode: 'raw', raw: 'x', language: 'text' }).encoded;

  it('lets bodies through on other methods and bodyless GETs', () => {
    expect(validateBody('POST', encoded, {}, WEB)).toEqual({
      ok: true,
      value: { encoded, warnings: [] },
    });
    expect(validateBody('GET', undefined, {}, WEB)).toEqual({ ok: true, value: { warnings: [] } });
  });

  it.each(['GET', 'HEAD'])('rejects %s with a body where it cannot be sent', (method) => {
    expect(validateBody(method, encoded, { disableBodyPruning: true }, WEB)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-request', message: `${method} requests cannot have a body here.` },
    });
  });

  it.each(['GET', 'HEAD'])('drops a %s body with a warning unless pruning is off', (method) => {
    const caps = { canSendBodyWithGet: true };
    expect(validateBody(method, encoded, {}, caps)).toEqual({
      ok: true,
      value: { warnings: [bodyDroppedWarning(method)] },
    });
    expect(validateBody(method, encoded, { disableBodyPruning: true }, caps)).toEqual({
      ok: true,
      value: { encoded, warnings: [] },
    });
  });
});

describe('prepareRequest bodies', () => {
  it('adds the default Content-Type unless the user set one (any case)', async () => {
    const body: Body = { mode: 'raw', raw: '{"a":1}', language: 'json' };
    expect(contentType(await prepared({ method: 'POST', url: 'h.test', body }))).toEqual([
      'application/json',
    ]);
    const custom = await prepared({
      method: 'POST',
      url: 'h.test',
      body,
      headers: [{ key: 'content-TYPE', value: 'application/vnd.api+json' }],
    });
    expect(contentType(custom)).toEqual(['application/vnd.api+json']);
  });

  it('sends form-data as multipart parts with no Content-Type of its own', async () => {
    const req = await prepared({
      method: 'POST',
      url: 'h.test',
      body: { mode: 'formdata', params: [text('a', '1'), file('f', '/tmp/x.png')] },
    });
    expect(contentType(req)).toEqual([]);
    expect(req.body).toEqual({
      kind: 'multipart',
      parts: [
        { name: 'a', kind: 'text', value: '1' },
        {
          name: 'f',
          kind: 'file',
          file: { kind: 'absolute', path: '/tmp/x.png' },
          filename: 'x.png',
          contentType: 'image/png',
        },
      ],
    });
  });

  it('passes encoding warnings on through meta.warnings', async () => {
    const req = await prepared({
      method: 'POST',
      url: 'h.test',
      body: { mode: 'formdata', params: [text('a', '1'), file('avatar', [])] },
    });
    expect(req.meta.warnings).toEqual([
      'Form field "avatar" has no file selected; it was not sent.',
    ]);
  });

  it('rejects GET with a body on web', async () => {
    const result = await prepareRequest(
      createRequest({ url: 'h.test', body: { mode: 'raw', raw: 'x', language: 'text' } }),
      ctx(WEB),
    );
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-request' } });
  });

  it('drops a GET body on desktop with a warning and no Content-Type', async () => {
    const req = await prepared({
      url: 'h.test',
      body: { mode: 'urlencoded', params: [{ key: 'a', value: '1' }] },
    });
    expect(req.body).toBeUndefined();
    expect(contentType(req)).toEqual([]);
    expect(req.meta.warnings).toEqual([bodyDroppedWarning('GET')]);
  });

  it('sends a GET body on desktop when "Send body with GET" is on', async () => {
    const req = await prepared({
      url: 'h.test',
      body: { mode: 'raw', raw: 'x', language: 'text' },
      settings: { disableBodyPruning: true },
    });
    expect(req.body?.kind).toBe('bytes');
    expect(contentType(req)).toEqual(['text/plain']);
    expect(req.meta.warnings).toBeUndefined();
  });
});

describe('autoHeaders for bodies', () => {
  const caps = { canSetAnyHeader: false, canSendBodyWithGet: true };

  it('previews the multipart Content-Type the transport will set', () => {
    const headers = autoHeaders(
      { headers: [], body: { mode: 'formdata', params: [text('a', '1')] } },
      caps,
    );
    expect(headers.find((h) => h.name === 'Content-Type')).toMatchObject({
      value: MULTIPART_CONTENT_TYPE_PREVIEW,
      preview: true,
    });
  });

  it('omits Content-Type for a GET body that will be dropped', () => {
    const body: Body = { mode: 'raw', raw: 'x', language: 'json' };
    const names = (init: Parameters<typeof autoHeaders>[0]) =>
      autoHeaders(init, caps).map((h) => h.name);
    expect(names({ headers: [], body, method: 'GET', settings: {} })).toEqual(['Accept']);
    expect(
      names({ headers: [], body, method: 'get', settings: { disableBodyPruning: true } }),
    ).toEqual(['Accept', 'Content-Type']);
    expect(names({ headers: [], body, method: 'POST', settings: {} })).toEqual([
      'Accept',
      'Content-Type',
    ]);
  });
});

describe('RequestExecutor bodies', () => {
  it('reports prepare warnings before transport warnings and previews form-data', async () => {
    const transport = new MockTransport().on(() => true, {
      body: 'ok',
      warnings: ['from transport'],
    });
    const result = await new RequestExecutor(transport).execute(
      createRequest({
        method: 'POST',
        url: 'h.test',
        body: {
          mode: 'formdata',
          params: [text('a', '1'), file('f', pickedFileSrc('p', 'x.png')), file('none', [])],
        },
      }),
      ctx(),
    );
    expect(result.warnings).toEqual([
      'Form field "none" has no file selected; it was not sent.',
      'from transport',
    ]);
    expect(result.request.bodyPreview).toBe('a: 1\nf: <x.png>');
  });

  it('keeps the dropped-GET-body warning on transport errors too', async () => {
    const transport = new MockTransport();
    const result = await new RequestExecutor(transport).execute(
      createRequest({ url: 'h.test', body: { mode: 'raw', raw: 'x', language: 'text' } }),
      ctx(),
    );
    expect(result.error).toBeDefined();
    expect(result.warnings).toEqual([bodyDroppedWarning('GET')]);
  });
});
