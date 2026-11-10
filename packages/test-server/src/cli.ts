/**
 * `pnpm --filter @pigeon/test-server start`: serves on 127.0.0.1:4010 until stopped.
 * Override with PIGEON_TEST_SERVER_PORT (0 = any free port) and PIGEON_TEST_SERVER_HOST.
 * With PIGEON_TEST_SERVER_EXIT_ON_STDIN_END=1 it also stops when stdin closes, so a parent
 * process (e.g. `cargo test`) can't leave it running by exiting without cleanup.
 */
import { DEFAULT_HOST, DEFAULT_PORT, startTestServer } from './server.ts';

const port = Number(process.env['PIGEON_TEST_SERVER_PORT'] ?? DEFAULT_PORT);
const host = process.env['PIGEON_TEST_SERVER_HOST'] ?? DEFAULT_HOST;

const server = await startTestServer({ port, host });
console.log(`Pigeon test server listening on ${server.url}`);

const stop = () => {
  void server.close().then(() => process.exit(0));
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, stop);
if (process.env['PIGEON_TEST_SERVER_EXIT_ON_STDIN_END'] === '1') {
  process.stdin.once('end', stop).once('close', stop).resume();
}
