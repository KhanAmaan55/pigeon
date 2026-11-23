/** Vitest global setup: bundles `dist/cli.js` so the spawn tests run the real program. */

import { join } from 'node:path';

import { build } from 'vite';

export default async function setup(): Promise<void> {
  const root = join(import.meta.dirname, '..');
  await build({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
}
