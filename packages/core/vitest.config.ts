import { configDefaults, defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // Performance budgets run separately: `pnpm test:perf`.
    exclude: [...configDefaults.exclude, '**/*.perf.test.ts'],
  },
});
