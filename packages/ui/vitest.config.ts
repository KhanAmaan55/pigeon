import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import { defineProject } from 'vitest/config';

/**
 * graphql 17 ships a development and a production build. Vite picks the development one for
 * source files while dependencies loaded by Node get the production one, and graphql refuses a
 * schema from "another realm". Every `graphql` import in the tests uses the production ESM build.
 */
const GRAPHQL = join(realpathSync(join(import.meta.dirname, 'node_modules/graphql')), 'index.mjs');

export default defineProject({
  resolve: { alias: [{ find: /^graphql$/, replacement: GRAPHQL }] },
  test: {
    environment: 'jsdom',
    // Component flows render the whole app in jsdom; on a busy machine (or CI) they can take a
    // few seconds each.
    testTimeout: 20_000,
    setupFiles: ['./test/setup.ts'],
    // Resolved by Vite (with the alias above) rather than by Node.
    server: { deps: { inline: ['graphql-language-service', 'cm6-graphql'] } },
  },
});
