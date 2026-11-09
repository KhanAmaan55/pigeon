import { describe, expect, it } from 'vitest';

import { rawRequest, useTestServer } from './helpers';

const url = useTestServer();

const ORIGIN = 'http://localhost:4173';

const preflight = (path: string, method = 'PUT', headers = 'x-custom, content-type') =>
  rawRequest(url(path), {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': method,
      'Access-Control-Request-Headers': headers,
    },
  });

describe('permissive CORS (every endpoint but the /cors/none and /cors/preflight-required)', () => {
  it('reflects the origin, allows credentials and exposes every response header', async () => {
    const res = await rawRequest(url('/cors/allow-all'), { headers: { Origin: ORIGIN } });
    expect(res.headers).toMatchObject({
      'access-control-allow-origin': ORIGIN,
      'access-control-allow-credentials': 'true',
      'x-pigeon-test': 'exposed',
    });
    const exposed = String(res.headers['access-control-expose-headers']).split(', ');
    expect(exposed).toEqual(expect.arrayContaining(['x-pigeon-test', 'content-type']));
    expect(JSON.parse(res.body.toString())).toEqual({ cors: 'allow-all', method: 'GET' });
  });

  it('allows any origin without credentials when no Origin is sent', async () => {
    const res = await rawRequest(url('/json/user'));
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it.each(['/echo', '/cors/allow-all', '/graphql', '/nope'])(
    'approves any preflight on %s',
    async (path) => {
      const res = await preflight(path);
      expect(res.status).toBe(204);
      expect(res.headers).toMatchObject({
        'access-control-allow-origin': ORIGIN,
        'access-control-allow-methods': 'PUT',
        'access-control-allow-headers': 'x-custom, content-type',
      });
      expect(res.body.byteLength).toBe(0);
    },
  );

  it('does not expose Set-Cookie', async () => {
    const res = await rawRequest(url('/cookies/set?a=1'), { headers: { Origin: ORIGIN } });
    expect(res.headers['access-control-expose-headers']).not.toContain('set-cookie');
  });
});

describe('/cors/none', () => {
  it('sends no CORS headers on responses or preflights', async () => {
    const res = await rawRequest(url('/cors/none'), { headers: { Origin: ORIGIN } });
    expect(JSON.parse(res.body.toString())).toEqual({ cors: 'none', method: 'GET' });
    const pre = await preflight('/cors/none');
    for (const { headers } of [res, pre]) {
      expect(Object.keys(headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
    }
  });
});

describe('/cors/preflight-required', () => {
  it('allows simple requests', async () => {
    const res = await rawRequest(url('/cors/preflight-required'), {
      method: 'POST',
      headers: { Origin: ORIGIN },
    });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('approves no non-simple methods or headers in a preflight', async () => {
    const res = await preflight('/cors/preflight-required');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toBe('GET, HEAD, POST');
    expect(res.headers['access-control-allow-headers']).toBeUndefined();
  });
});
