import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { get as httpsGet } from 'node:https';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PORT, startTestServer, TEST_SERVER_CERT } from '../src/index';

/** GET over HTTPS with Node's own TLS, optionally trusting `ca`. Resolves status and body. */
function httpsRequest(url: string, ca?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    httpsGet(url, ca === undefined ? {} : { ca }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

describe('startTestServer', () => {
  it('listens on an ephemeral loopback port by default', async () => {
    const server = await startTestServer();
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.port).not.toBe(DEFAULT_PORT);
      expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
      expect((await fetch(`${server.url}/status/200`)).status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it('runs several servers side by side', async () => {
    const [a, b] = await Promise.all([startTestServer(), startTestServer()]);
    expect(a.port).not.toBe(b.port);
    await Promise.all([a.close(), b.close()]);
  });

  it('closes promptly while a delayed response is pending', async () => {
    const server = await startTestServer();
    const pending = fetch(`${server.url}/delay/60000`).catch((err: unknown) => err);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const started = performance.now();
    await server.close();
    expect(performance.now() - started).toBeLessThan(1000);
    expect(await pending).toBeInstanceOf(Error);
    await expect(fetch(`${server.url}/status/200`)).rejects.toThrow();
  });

  it('rejects when the port is taken', async () => {
    const server = await startTestServer();
    try {
      await expect(startTestServer({ port: server.port })).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await server.close();
    }
  });
});

describe('startTestServer({ https: true })', () => {
  it('serves the same endpoints over TLS with a self-signed certificate', async () => {
    const server = await startTestServer({ https: true });
    try {
      expect(server.url).toBe(`https://127.0.0.1:${server.port}`);
      // Untrusted by default: that is what TLS error tests rely on.
      await expect(httpsRequest(`${server.url}/status/200`)).rejects.toMatchObject({
        code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      });
      // Valid for 127.0.0.1 and localhost once the certificate is trusted.
      for (const host of ['127.0.0.1', 'localhost']) {
        const res = await httpsRequest(
          `https://${host}:${server.port}/json/user`,
          TEST_SERVER_CERT,
        );
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ id: 1 });
      }
    } finally {
      await server.close();
    }
  });
});

describe('CLI (pnpm start)', () => {
  it('serves on the port from PIGEON_TEST_SERVER_PORT until stopped', async () => {
    const cwd = fileURLToPath(new URL('..', import.meta.url));
    const child = spawn(process.execPath, ['--experimental-strip-types', 'src/cli.ts'], {
      cwd,
      env: { ...process.env, PIGEON_TEST_SERVER_PORT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      const [line] = (await once(child.stdout, 'data')) as [Buffer];
      const baseUrl = /listening on (\S+)/.exec(line.toString())?.[1];
      expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(await (await fetch(`${baseUrl}/json/user`)).json()).toMatchObject({ id: 1 });
    } finally {
      child.kill();
      await once(child, 'exit');
    }
  });

  it('also serves HTTPS when PIGEON_TEST_SERVER_HTTPS_PORT is set', async () => {
    const cwd = fileURLToPath(new URL('..', import.meta.url));
    const child = spawn(process.execPath, ['--experimental-strip-types', 'src/cli.ts'], {
      cwd,
      env: { ...process.env, PIGEON_TEST_SERVER_PORT: '0', PIGEON_TEST_SERVER_HTTPS_PORT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      const urls: string[] = [];
      for await (const line of createInterface({ input: child.stdout })) {
        urls.push(/listening on (\S+)/.exec(line)?.[1] ?? line);
        if (urls.length === 2) break;
      }
      expect(urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(urls[1]).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
      expect((await httpsRequest(`${urls[1]}/status/204`, TEST_SERVER_CERT)).status).toBe(204);
    } finally {
      child.kill();
      await once(child, 'exit');
    }
  });
});
