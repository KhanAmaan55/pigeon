import { defineConfig } from 'vitest/config';

// Each package is a Vitest project (named after its package.json). Packages that need a
// different environment (e.g. jsdom for @pigeon/ui) add their own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
