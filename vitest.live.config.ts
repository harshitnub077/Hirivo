import { defineConfig } from 'vitest/config';

// Live checks against the real job sources. Not part of `npm test`; run with `npm run test:live`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.live.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60_000,
  },
});
