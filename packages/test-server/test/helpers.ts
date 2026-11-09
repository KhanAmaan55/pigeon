import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll } from 'vitest';

import type { TestServer } from '../src/index';
import { startTestServer } from '../src/index';

/** Starts one server on an ephemeral port per test file; returns a URL builder. */
export function useTestServer(): (path: string) => string {
  let server: TestServer | undefined;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(() => server?.close());
  return (path) => {
    if (!server) throw new Error('Test server not started');
    return `${server.url}${path}`;
  };
}

export interface RawResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/** A plain `node:http` request: no decompression, redirects or header filtering. */
export function rawRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
      );
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
