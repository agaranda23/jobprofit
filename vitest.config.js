import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Phase A is pure helpers (no DOM, no React). Node environment is faster
    // and avoids loading jsdom for unit tests that don't need it.
    environment: 'node',
    // Discover *.test.{js,jsx} anywhere in src — covers both the
    // src/lib/__tests__/foo.test.js layout (this branch) and the
    // sibling src/lib/foo.test.js layout (main's bizValidation.test.js).
    include: ['src/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // include + thresholds are added in commit 2 alongside the actual
      // payments.js source — adding them here would fail because the
      // targets don't exist yet.
    },
  },
});
