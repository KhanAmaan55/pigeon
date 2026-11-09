import { describe, expect, it } from 'vitest';

import { useTestServer } from './helpers';

const url = useTestServer();

const basic = (credentials: string) => `Basic ${Buffer.from(credentials).toString('base64')}`;

describe('/cookies', () => {
  it('sets one cookie per query parameter', async () => {
    const res = await fetch(url('/cookies/set?session=abc&theme=dark%20mode'));
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([
      'session=abc; Path=/',
      'theme=dark%20mode; Path=/',
    ]);
    expect(await res.json()).toEqual({ cookies: { session: 'abc', theme: 'dark mode' } });
  });

  it('reflects the Cookie header, decoding values', async () => {
    const res = await fetch(url('/cookies'), {
      headers: { Cookie: 'session=abc; theme=dark%20mode; session=second; flag' },
    });
    expect(await res.json()).toEqual({ cookies: { session: 'abc', theme: 'dark mode' } });
  });

  it('reports no cookies when none are sent', async () => {
    expect(await (await fetch(url('/cookies'))).json()).toEqual({ cookies: {} });
  });
});

describe('/auth/basic', () => {
  it('accepts matching credentials', async () => {
    const res = await fetch(url('/auth/basic?user=ada&pass=s3cr%C3%A9t'), {
      headers: { Authorization: basic('ada:s3crét') },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: true, user: 'ada' });
  });

  it('defaults to user:pass', async () => {
    const res = await fetch(url('/auth/basic'), { headers: { Authorization: basic('user:pass') } });
    expect(res.status).toBe(200);
  });

  it('challenges missing or wrong credentials', async () => {
    for (const headers of [
      {},
      { Authorization: basic('ada:wrong') },
      { Authorization: 'Bearer x' },
    ]) {
      const res = await fetch(url('/auth/basic?user=ada&pass=right'), { headers });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toMatch(/^Basic realm="pigeon-test"/);
      expect(await res.json()).toEqual({ authenticated: false });
    }
  });
});

describe('/auth/bearer', () => {
  it('accepts the expected token', async () => {
    const res = await fetch(url('/auth/bearer?token=t0k3n'), {
      headers: { Authorization: 'Bearer t0k3n' },
    });
    expect(await res.json()).toEqual({ authenticated: true, token: 't0k3n' });
  });

  it('accepts any token when none is required', async () => {
    const res = await fetch(url('/auth/bearer'), { headers: { Authorization: 'bearer anything' } });
    expect(res.status).toBe(200);
  });

  it('challenges a missing or wrong token', async () => {
    for (const headers of [{}, { Authorization: 'Bearer nope' }, { Authorization: 'Bearer ' }]) {
      const res = await fetch(url('/auth/bearer?token=t0k3n'), { headers });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer realm="pigeon-test"');
    }
  });
});
