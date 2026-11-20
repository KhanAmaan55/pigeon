import { defineConfig } from 'vitest/config';

// `pnpm test:perf`: performance budgets (testing.md §3.7), kept out of `pnpm test` because they
// are timing-sensitive on busy machines.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.perf.test.ts'],
  },
});
