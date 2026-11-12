import { defineConfig } from 'vitest/config';

// Tests run in Node by default. A client test that needs a DOM starts with the
// comment `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    include: [
      'scripts/**/*.test.ts',
      'server/**/*.test.ts',
      'shared/**/*.test.ts',
      'client/src/**/*.test.{ts,tsx}',
    ],
  },
});
