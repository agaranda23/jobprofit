import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The React plugin is required here (not just in vite.config.js) so that
  // vitest can transform JSX in *.test.jsx smoke-test files. Pure *.test.js
  // files are unaffected — the plugin is a no-op for them.
  plugins: [react()],
  test: {
    // Phase A is pure helpers (no DOM, no React). Node environment is faster
    // and avoids loading jsdom for unit tests that don't need it.
    // Render smoke tests (*.test.jsx) override this per-file via:
    //   // @vitest-environment jsdom
    environment: 'node',
    // globals: true exposes describe/it/expect/beforeEach/afterEach as
    // true globals. @testing-library/react's auto-cleanup checks
    // `typeof afterEach === 'function'` at module load time — without
    // globals it finds nothing and skips cleanup, so rendered components
    // pile up across tests and cause "multiple elements found" failures.
    globals: true,
    // setupFiles runs before every test file in every environment.
    // It extends vitest's expect with @testing-library/jest-dom matchers
    // so the render smoke tests can use toBeInTheDocument etc.
    // Pure-logic node-env tests are unaffected — the matchers are available
    // but never called there.
    setupFiles: ['./src/test-setup.js'],
    // Discover *.test.{js,jsx} anywhere in src or netlify/functions.
    // src/** covers lib, components, screens. netlify/** covers function unit tests.
    include: ['src/**/*.test.{js,jsx}', 'netlify/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // include + thresholds are added in commit 2 alongside the actual
      // payments.js source — adding them here would fail because the
      // targets don't exist yet.
    },
  },
});
