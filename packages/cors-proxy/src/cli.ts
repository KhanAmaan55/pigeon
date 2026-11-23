/**
 * `pnpm --filter @pigeon/cors-proxy start [-- options]` (or `node dist/cli.js`): runs the
 * self-hosted CORS proxy for the Pigeon web app (PIGN-052).
 *
 *   --port <n>            default 8787 (env PIGEON_PROXY_PORT)
 *   --host <addr>         default 127.0.0.1 (env PIGEON_PROXY_HOST); other hosts expose the
 *                         proxy to your network — only do that behind your own access control
 *   --allow-origin <url>  repeatable; replaces the defaults (env PIGEON_PROXY_ORIGINS, comma-separated)
 *   --token <t>           fixed token (env PIGEON_PROXY_TOKEN); a random one by default
 *   --quiet               no per-request log lines (bodies are never logged)
 */

import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_PROXY_HOST,
  DEFAULT_PROXY_PORT,
  startProxy,
} from './server';

function parse(argv: readonly string[]) {
  const out: { port?: number; host?: string; origins: string[]; token?: string; quiet: boolean } = {
    origins: [],
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--port') out.port = Number(value());
    else if (arg === '--host') out.host = value();
    else if (arg === '--allow-origin') out.origins.push(value());
    else if (arg === '--token') out.token = value();
    else if (arg === '--quiet') out.quiet = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('pigeon-cors-proxy [--port n] [--host addr] [--allow-origin url]… [--token t]');
      process.exit(0);
    } else throw new Error(`Unknown option ${arg}`);
  }
  return out;
}

const env = process.env;
const args = parse(process.argv.slice(2));
const origins =
  args.origins.length > 0
    ? args.origins
    : env['PIGEON_PROXY_ORIGINS']
      ? env['PIGEON_PROXY_ORIGINS'].split(',').map((o) => o.trim())
      : DEFAULT_ALLOWED_ORIGINS;
const host = args.host ?? env['PIGEON_PROXY_HOST'] ?? DEFAULT_PROXY_HOST;
const token = args.token ?? env['PIGEON_PROXY_TOKEN'];

const proxy = await startProxy({
  host,
  port: args.port ?? Number(env['PIGEON_PROXY_PORT'] ?? DEFAULT_PROXY_PORT),
  allowedOrigins: origins,
  ...(token ? { token } : {}),
  ...(args.quiet ? {} : { log: (line: string) => console.log(line) }),
});
console.log(`Pigeon CORS proxy listening on ${proxy.url}`);
console.log(`Token: ${proxy.token}`);
console.log(`Allowed origins: ${origins.join(', ')}`);
if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
  console.warn(
    'Warning: the proxy is reachable from your network. Anyone with the token can make requests from this machine.',
  );
}
console.log('Enter the URL and token in Pigeon → Settings → CORS proxy. Stop with Ctrl+C.');
const stop = () => void proxy.close().then(() => process.exit(0));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, stop);
