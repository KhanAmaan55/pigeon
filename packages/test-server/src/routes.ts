import { setTimeout as sleep } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';

import { echo } from './echo.ts';
import { HTML_PAGE, JSON_SHAPES, PNG_1X1, UNICODE, XML_DOC } from './fixtures.ts';
import { graphqlHandler } from './graphql.ts';
import type { Handler, Reply } from './reply.ts';
import { error, intParam, json, JSON_TYPE } from './reply.ts';

/**
 * - `permissive`: allow any origin, method and header; expose every response header.
 * - `simple`: allow any origin, but approve no methods or headers in a preflight, so only
 *   requests that need no preflight succeed.
 * - `none`: no CORS headers at all.
 */
export type CorsMode = 'permissive' | 'simple' | 'none';

export interface Route {
  pattern: RegExp;
  handle: Handler;
  cors?: CorsMode;
}

const MIB = 1024 * 1024;
export const LIMITS = { delayMs: 120_000, redirects: 100, bytes: 64 * MIB, largeMb: 100 };

const REDIRECT_STATUSES = new Set([300, 301, 302, 303, 305, 307, 308]);

export const routes: Route[] = [
  { pattern: /^\/echo(?:\/.*)?$/, handle: async (ctx) => json(await echo(ctx)) },

  {
    pattern: /^\/json\/([^/]+)$/,
    handle: ({ params }) => {
      const body = JSON_SHAPES[params[0] ?? ''];
      if (body === undefined) {
        return error(404, `Unknown shape; use one of: ${Object.keys(JSON_SHAPES).join(', ')}`);
      }
      return { headers: { 'Content-Type': JSON_TYPE }, body };
    },
  },

  {
    pattern: /^\/status\/(\d+)$/,
    handle: ({ params }) => {
      const status = intParam(params[0], 200, 599);
      return status === undefined ? error(400, 'Status must be 200–599') : json({ status }, status);
    },
  },

  {
    pattern: /^\/delay\/(\d+)$/,
    handle: async ({ params, signal }) => {
      const ms = intParam(params[0], 0, LIMITS.delayMs);
      if (ms === undefined) return error(400, `Delay must be 0–${LIMITS.delayMs} ms`);
      await sleep(ms, undefined, { signal });
      return json({ delayMs: ms });
    },
  },

  {
    pattern: /^\/redirect\/(\d+)$/,
    handle: ({ params, query }) => {
      const n = intParam(params[0], 1, LIMITS.redirects);
      const status = redirectStatus(query.get('status'));
      if (n === undefined) return error(400, `Redirect count must be 1–${LIMITS.redirects}`);
      if (status === undefined) return error(400, 'status must be a redirect code');
      const search = query.has('status') ? `?status=${status}` : '';
      return redirect(status, n > 1 ? `/redirect/${n - 1}${search}` : '/echo');
    },
  },

  {
    pattern: /^\/redirect-to$/,
    handle: ({ query }) => {
      const location = query.get('url');
      const status = redirectStatus(query.get('status'));
      if (!location) return error(400, 'Missing url');
      if (status === undefined) return error(400, 'status must be a redirect code');
      return redirect(status, location);
    },
  },

  {
    pattern: /^\/cookies\/set$/,
    handle: ({ query }) => {
      const cookies = Object.fromEntries(query);
      const setCookie = Object.entries(cookies).map(
        ([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/`,
      );
      return json({ cookies }, 200, { 'Set-Cookie': setCookie });
    },
  },

  {
    pattern: /^\/cookies$/,
    handle: ({ req }) => json({ cookies: parseCookies(req.headers.cookie) }),
  },

  {
    pattern: /^\/gzip$/,
    handle: ({ method }) => {
      const body = gzipSync(
        `${JSON.stringify({ gzipped: true, method, message: 'Compressed by the test server' }, null, 2)}\n`,
      );
      // The gzip header records the host OS; pin it so the bytes are identical on every OS.
      body[9] = 0xff;
      return { headers: { 'Content-Type': JSON_TYPE, 'Content-Encoding': 'gzip' }, body };
    },
  },

  {
    pattern: /^\/bytes\/(\d+)$/,
    handle: ({ params }) => {
      const n = intParam(params[0], 0, LIMITS.bytes);
      if (n === undefined) return error(400, `Byte count must be 0–${LIMITS.bytes}`);
      const body = Buffer.alloc(n);
      for (let i = 0; i < n; i++) body[i] = i % 256;
      return { headers: { 'Content-Type': 'application/octet-stream' }, body };
    },
  },

  {
    pattern: /^\/large\/(\d+(?:\.\d+)?)$/,
    handle: ({ params }) => {
      const mb = Number(params[0]);
      if (!(mb > 0 && mb <= LIMITS.largeMb))
        return error(400, `Size must be 0–${LIMITS.largeMb} MB`);
      return { headers: { 'Content-Type': JSON_TYPE }, body: largeJson(Math.ceil(mb * MIB)) };
    },
  },

  {
    pattern: /^\/html$/,
    handle: () => ({ headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: HTML_PAGE }),
  },

  {
    pattern: /^\/xml$/,
    handle: () => ({
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      body: XML_DOC,
    }),
  },

  {
    pattern: /^\/image\/png$/,
    handle: () => ({ headers: { 'Content-Type': 'image/png' }, body: PNG_1X1 }),
  },

  {
    pattern: /^\/unicode$/,
    handle: () => ({
      headers: {
        'Content-Type': JSON_TYPE,
        'Content-Disposition': `inline; filename="unicode.json"; filename*=UTF-8''${encodeURIComponent('🐦-ünïcödé.json')}`,
      },
      body: UNICODE,
    }),
  },

  {
    pattern: /^\/auth\/basic$/,
    handle: ({ req, query }) => {
      const user = query.get('user') ?? 'user';
      const pass = query.get('pass') ?? 'pass';
      const [scheme, encoded] = (req.headers.authorization ?? '').split(' ', 2);
      const decoded = Buffer.from(encoded ?? '', 'base64').toString('utf8');
      return scheme?.toLowerCase() === 'basic' && decoded === `${user}:${pass}`
        ? json({ authenticated: true, user })
        : json({ authenticated: false }, 401, {
            'WWW-Authenticate': 'Basic realm="pigeon-test", charset="UTF-8"',
          });
    },
  },

  {
    pattern: /^\/auth\/bearer$/,
    handle: ({ req, query }) => {
      const expected = query.get('token');
      const [scheme, token] = (req.headers.authorization ?? '').split(' ', 2);
      const ok =
        scheme?.toLowerCase() === 'bearer' && !!token && (expected === null || token === expected);
      return ok
        ? json({ authenticated: true, token })
        : json({ authenticated: false }, 401, { 'WWW-Authenticate': 'Bearer realm="pigeon-test"' });
    },
  },

  { pattern: /^\/graphql$/, handle: graphqlHandler },

  { pattern: /^\/cors\/none$/, cors: 'none', handle: corsReply('none') },
  {
    pattern: /^\/cors\/allow-all$/,
    handle: corsReply('allow-all', { 'X-Pigeon-Test': 'exposed' }),
  },
  {
    pattern: /^\/cors\/preflight-required$/,
    cors: 'simple',
    handle: corsReply('preflight-required'),
  },
];

function corsReply(variant: string, headers: Record<string, string> = {}): Handler {
  return ({ method }) => json({ cors: variant, method }, 200, headers);
}

function redirectStatus(raw: string | null): number | undefined {
  if (raw === null) return 302;
  const status = Number(raw);
  return REDIRECT_STATUSES.has(status) ? status : undefined;
}

function redirect(status: number, location: string): Reply {
  return json({ redirect: location }, status, { Location: location });
}

/** First value wins when a name repeats. */
function parseCookies(header: string | undefined): Record<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of (header ?? '').split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const name = decode(pair.slice(0, eq).trim());
    if (name && !cookies.has(name)) cookies.set(name, decode(pair.slice(eq + 1).trim()));
  }
  return Object.fromEntries(cookies);
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A JSON array of identical-shape items, at least `minBytes` long. */
function largeJson(minBytes: number): Buffer {
  const chunks: string[] = ['['];
  let size = 1;
  const closing = '\n]\n';
  for (let i = 0; size + closing.length < minBytes; i++) {
    const item = JSON.stringify({
      id: i,
      name: `Item ${i}`,
      active: i % 2 === 0,
      score: i * 0.5,
      tags: ['alpha', 'beta', 'gamma'],
      description: 'A deterministic item in a large response body used for performance tests.',
    });
    const chunk = `${i === 0 ? '' : ','}\n  ${item}`;
    chunks.push(chunk);
    size += Buffer.byteLength(chunk);
  }
  chunks.push(closing);
  return Buffer.from(chunks.join(''));
}
