import { MEMORY_CAPABILITIES, MemoryAppState, MemoryFs } from '@pigeon/platform';
import { NODE_CAPABILITIES, NodeTransport } from '@pigeon/platform-node';
import type { TestServer } from '@pigeon/test-server';
import { startTestServer } from '@pigeon/test-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CookieJar,
  COOKIES_PER_DOMAIN,
  createExecutionContext,
  createRequest,
  initializeProject,
  parseSetCookie,
  pathMatches,
  ProjectSession,
  RequestExecutor,
} from '../src/index';

const NOW = Date.UTC(2026, 0, 1);
const url = (u: string) => new URL(u);

describe('cookie jar rules (PIGN-045)', () => {
  it('parses attributes; Max-Age wins over Expires', () => {
    const cookie = parseSetCookie(
      'sid=abc; Domain=.Example.test; Path=/api; Max-Age=60; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Secure; HttpOnly; SameSite=lax',
      url('https://www.example.test/login'),
      NOW,
    );
    expect(cookie).toEqual({
      name: 'sid',
      value: 'abc',
      domain: 'example.test',
      hostOnly: false,
      path: '/api',
      expires: NOW + 60_000,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      createdAt: NOW,
    });
    expect(parseSetCookie('a=1', url('http://h.test/x/y/z'), NOW)).toMatchObject({
      domain: 'h.test',
      hostOnly: true,
      path: '/x/y',
    });
  });

  it('refuses foreign domains, top-level domains, nameless and insecure Secure cookies', () => {
    const at = url('http://api.example.test/');
    expect(parseSetCookie('a=1; Domain=other.test', at, NOW)).toBeNull();
    expect(parseSetCookie('a=1; Domain=test', at, NOW)).toBeNull();
    expect(parseSetCookie('=1', at, NOW)).toBeNull();
    expect(parseSetCookie('novalue', at, NOW)).toBeNull();
    expect(parseSetCookie('a=1; Secure', at, NOW)).toBeNull();
    expect(parseSetCookie('a=1; Secure', url('http://localhost:4010/'), NOW)).not.toBeNull();
  });

  it('matches domain, host-only, path, secure and expiry', () => {
    const jar = new CookieJar();
    jar.storeResponse(
      'https://www.example.test/app/page',
      [
        'host=1',
        'parent=2; Domain=example.test; Path=/',
        'deep=3; Path=/app/settings',
        'safe=4; Secure; Path=/',
        'old=5; Max-Age=10; Path=/',
      ],
      NOW,
    );
    const names = (u: string, now = NOW) => jar.matching(u, now).map((c) => c.name);
    expect(names('https://www.example.test/app/x')).toEqual(['host', 'parent', 'safe', 'old']);
    expect(names('https://www.example.test/app/settings/1')).toEqual([
      'deep',
      'host',
      'parent',
      'safe',
      'old',
    ]);
    // Host-only cookies stay on www; the Domain cookie reaches every subdomain.
    expect(names('https://other.example.test/')).toEqual(['parent']);
    expect(names('http://www.example.test/app/x')).toEqual(['host', 'parent', 'old']);
    expect(jar.cookieHeader('https://www.example.test/app/x', NOW)).toBe(
      'host=1; parent=2; safe=4; old=5',
    );
    expect(names('https://www.example.test/app/x', NOW + 11_000)).toEqual([
      'host',
      'parent',
      'safe',
    ]);
    expect(pathMatches('/apples', '/app')).toBe(false);
    expect(pathMatches('/app/', '/app')).toBe(true);
  });

  it('replaces, deletes with an expiry in the past, and bounds per domain', () => {
    const jar = new CookieJar();
    jar.storeResponse('http://a.test/', ['x=1'], NOW);
    jar.storeResponse('http://a.test/', ['x=2'], NOW + 5);
    expect(jar.list(NOW).map((c) => [c.value, c.createdAt])).toEqual([['2', NOW]]);
    jar.storeResponse('http://a.test/', ['x=; Max-Age=0'], NOW + 10);
    expect(jar.list(NOW)).toEqual([]);
    for (let i = 0; i < COOKIES_PER_DOMAIN + 5; i++)
      jar.storeResponse('http://a.test/', [`c${i}=1`], NOW + i);
    expect(jar.list(NOW)).toHaveLength(COOKIES_PER_DOMAIN);
    expect(jar.list(NOW).some((c) => c.name === 'c0')).toBe(false);
    jar.clear('a.test');
    expect(jar.list(NOW)).toEqual([]);
  });
});

describe('cookies in sends (PIGN-045)', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(() => server.close());

  async function project() {
    const fs = new MemoryFs();
    await initializeProject(fs, 'Cookies');
    return ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
  }
  const send = (session: ProjectSession, path: string, settings = {}) => {
    let changed = 0;
    return new RequestExecutor(new NodeTransport())
      .execute(
        createRequest({
          name: 'R',
          url: { raw: `${server.url}${path}`, query: [], pathVariables: [], extra: {} },
          settings,
        }),
        createExecutionContext({
          capabilities: NODE_CAPABILITIES,
          cookies: { jar: session.cookieJar, onChange: () => (changed += 1) },
        }),
      )
      .then((result) => ({
        result,
        changed,
        cookies: result.response
          ? (JSON.parse(new TextDecoder().decode(result.response.body)) as { cookies: object })
              .cookies
          : undefined,
      }));
  };

  it('a cookie set by one request is sent by the next; projects have separate jars', async () => {
    const first = await project();
    const second = await project();
    const set = await send(first, '/cookies/set?session=abc');
    expect(set.changed).toBe(1);
    expect((await send(first, '/cookies')).cookies).toEqual({ session: 'abc' });
    expect((await send(second, '/cookies')).cookies).toEqual({});
    // "Don't use cookie jar" and an explicit Cookie header win.
    expect((await send(first, '/cookies', { disableCookies: true })).cookies).toEqual({});
    expect(first.cookieJar.list().map((c) => [c.domain, c.name, c.value])).toEqual([
      ['127.0.0.1', 'session', 'abc'],
    ]);
    // Saved in local state, not in files.
    first.saveCookies();
    await first.flushLocalState();
    expect(first.localState?.cookies).toEqual([expect.objectContaining({ name: 'session' })]);
  });

  it('browsers can neither read Set-Cookie nor set Cookie: the jar stays unused', async () => {
    const session = await project();
    const browser = {
      ...MEMORY_CAPABILITIES,
      canReadAllResponseHeaders: false,
      canSetAnyHeader: false,
    };
    await new RequestExecutor(new NodeTransport()).execute(
      createRequest({
        name: 'R',
        url: { raw: `${server.url}/cookies/set?x=1`, query: [], pathVariables: [], extra: {} },
      }),
      createExecutionContext({ capabilities: browser, cookies: { jar: session.cookieJar } }),
    );
    expect(session.cookieJar.list()).toEqual([]);
  });
});
