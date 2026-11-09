import { describe, expect, it } from 'vitest';

import type { EchoResponse } from '../src/index';
import { useTestServer } from './helpers';

const url = useTestServer();

describe('/status/:code', () => {
  it.each([200, 201, 400, 404, 418, 500, 503, 599])('answers %i with a JSON body', async (code) => {
    const res = await fetch(url(`/status/${code}`));
    expect(res.status).toBe(code);
    expect(await res.json()).toEqual({ status: code });
  });

  it('answers 204 with no body', async () => {
    const res = await fetch(url('/status/204'));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('rejects codes outside 200–599', async () => {
    expect((await fetch(url('/status/100'))).status).toBe(400);
    expect((await fetch(url('/status/600'))).status).toBe(400);
  });
});

describe('/delay/:ms', () => {
  it('waits before answering', async () => {
    const started = performance.now();
    const res = await fetch(url('/delay/150'));
    expect(await res.json()).toEqual({ delayMs: 150 });
    // Timers may fire a little early on Windows.
    expect(performance.now() - started).toBeGreaterThanOrEqual(140);
  });

  it('can be aborted by the client, and keeps serving afterwards', async () => {
    const pending = fetch(url('/delay/10000'), { signal: AbortSignal.timeout(50) });
    await expect(pending).rejects.toThrow();
    expect((await fetch(url('/status/200'))).status).toBe(200);
  });

  it('rejects delays above the limit', async () => {
    expect((await fetch(url('/delay/999999'))).status).toBe(400);
  });
});

describe('/redirect/:n', () => {
  it('redirects n times with relative locations, ending at /echo', async () => {
    const first = await fetch(url('/redirect/3'), { redirect: 'manual' });
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe('/redirect/2');

    const last = await fetch(url('/redirect/1'), { redirect: 'manual' });
    expect(last.headers.get('location')).toBe('/echo');

    const followed = await fetch(url('/redirect/3'));
    expect(followed.redirected).toBe(true);
    expect(followed.url).toBe(url('/echo'));
  });

  it('keeps a chosen status for every hop (307 preserves method and body)', async () => {
    const hop = await fetch(url('/redirect/2?status=307'), { redirect: 'manual' });
    expect(hop.status).toBe(307);
    expect(hop.headers.get('location')).toBe('/redirect/1?status=307');

    const followed = await fetch(url('/redirect/2?status=307'), { method: 'POST', body: 'kept' });
    const body = (await followed.json()) as EchoResponse;
    expect(body).toMatchObject({ method: 'POST', body: { text: 'kept' } });
  });

  it('rejects counts and statuses that are out of range', async () => {
    expect((await fetch(url('/redirect/0'), { redirect: 'manual' })).status).toBe(400);
    expect((await fetch(url('/redirect/2?status=200'), { redirect: 'manual' })).status).toBe(400);
  });
});

describe('/redirect-to', () => {
  it('redirects to the given URL with the given status', async () => {
    const res = await fetch(url('/redirect-to?url=%2Fjson%2Fuser&status=301'), {
      redirect: 'manual',
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/json/user');
  });

  it('defaults to 302, and redirects to absolute URLs', async () => {
    const target = 'http://example.invalid/elsewhere';
    const res = await fetch(url(`/redirect-to?url=${encodeURIComponent(target)}`), {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(target);
  });

  it('requires a url', async () => {
    expect((await fetch(url('/redirect-to'), { redirect: 'manual' })).status).toBe(400);
  });
});

describe('unknown paths', () => {
  it('answer 404 with JSON', async () => {
    const res = await fetch(url('/nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'No test endpoint at /nope' });
  });
});
