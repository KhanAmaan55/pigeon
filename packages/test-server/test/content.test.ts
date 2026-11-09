import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { USERS } from '../src/index';
import { rawRequest, useTestServer } from './helpers';

const url = useTestServer();

describe('/json/:shape', () => {
  it('serves the fixed user and users bodies', async () => {
    expect(await (await fetch(url('/json/user'))).json()).toEqual(USERS[0]);
    expect(await (await fetch(url('/json/users'))).json()).toEqual(USERS);
  });

  it('serves a deeply nested body', async () => {
    const body = (await (await fetch(url('/json/nested'))).json()) as {
      company: { departments: Array<{ teams: Array<{ members: unknown[] }> }> };
    };
    expect(body.company.departments[0]?.teams[0]?.members).toHaveLength(2);
  });

  it('serves every JSON type, keeping literals JSON.parse would change', async () => {
    const res = await fetch(url('/json/types'));
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const text = await res.text();
    expect(text).toContain('"bigInteger": 9007199254740993');
    expect(text).toContain('"floatWithZero": 1.0');
    expect(JSON.parse(text)).toMatchObject({ null: null, emptyArray: [], emptyObject: {} });
  });

  it('answers 404 for an unknown shape', async () => {
    const res = await fetch(url('/json/nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: expect.stringContaining('user, users, nested, types'),
    });
  });

  it('is byte-for-byte deterministic and has no Date header', async () => {
    const [a, b] = await Promise.all([
      rawRequest(url('/json/nested')),
      rawRequest(url('/json/nested')),
    ]);
    expect(a.body.equals(b.body)).toBe(true);
    expect(a.headers['date']).toBeUndefined();
  });
});

describe('/unicode', () => {
  it('serves UTF-8 JSON with non-ASCII keys and an RFC 5987 file name', async () => {
    const res = await fetch(url('/unicode'));
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''%F0%9F%90%A6");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ nfc: 'é', nfd: 'é', 'ключ 🔑': 'non-ASCII key' });
    expect(body['greetings']).toMatchObject({ ja: 'こんにちは', ar: 'مرحبا' });
  });
});

describe('/gzip', () => {
  it('sends a gzip-encoded body with identical bytes on every OS', async () => {
    const raw = await rawRequest(url('/gzip'));
    expect(raw.headers['content-encoding']).toBe('gzip');
    expect(Number(raw.headers['content-length'])).toBe(raw.body.byteLength);
    expect(raw.body[9]).toBe(0xff);
    expect(JSON.parse(gunzipSync(raw.body).toString())).toMatchObject({
      gzipped: true,
      method: 'GET',
    });
  });

  it('is decoded transparently by fetch', async () => {
    expect(await (await fetch(url('/gzip'))).json()).toMatchObject({ gzipped: true });
  });
});

describe('/bytes/:n', () => {
  it('serves n deterministic bytes', async () => {
    const res = await fetch(url('/bytes/300'));
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes).toHaveLength(300);
    expect(bytes.every((byte, i) => byte === i % 256)).toBe(true);
  });

  it('serves an empty body for 0 and rejects oversize requests', async () => {
    expect((await (await fetch(url('/bytes/0'))).arrayBuffer()).byteLength).toBe(0);
    expect((await fetch(url('/bytes/999999999'))).status).toBe(400);
  });
});

describe('/large/:mb', () => {
  it('serves a JSON array of at least the requested size', async () => {
    const res = await fetch(url('/large/1.5'));
    const text = await res.text();
    const size = Buffer.byteLength(text);
    expect(Number(res.headers.get('content-length'))).toBe(size);
    expect(size).toBeGreaterThanOrEqual(1.5 * 1024 * 1024);
    expect(size).toBeLessThan(1.5 * 1024 * 1024 + 1024);
    const items = JSON.parse(text) as Array<{ id: number }>;
    expect(items[0]).toMatchObject({ id: 0, name: 'Item 0' });
    expect(items.at(-1)?.id).toBe(items.length - 1);
  });

  it('rejects zero and oversize requests', async () => {
    expect((await fetch(url('/large/0'))).status).toBe(400);
    expect((await fetch(url('/large/101'))).status).toBe(400);
  });
});
