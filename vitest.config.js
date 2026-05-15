import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Phase A is pure helpers (no DOM, no React). Node environment is faster
    // and avoids loading jsdom for unit tests that don't need it.
    environment: 'node',
    // Discover __tests__ folders alongside source files.
    include: ['src/**/__tests__/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // include + thresholds are added in commit 2 alongside the actual
      // payments.js source — adding them here would fail because the
      // targets don't exist yet.
    },
  },
});
