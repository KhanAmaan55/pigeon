import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PORT, startTestServer } from '../src/index';

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
});
