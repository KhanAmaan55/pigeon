import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // The integration tests spawn the built CLI: build it once first (a few hundred ms).
    globalSetup: ['./test/build-cli.ts'],
    testTimeout: 20_000,
  },
});
