import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    environment: 'jsdom',
    // Component flows render the whole app in jsdom; on a busy machine (or CI) they can take a
    // few seconds each.
    testTimeout: 20_000,
  },
});
