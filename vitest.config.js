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
    // jsdom's own dependency tree (html-encoding-sniffer, and separately
    // whatwg-url) has started requiring the ESM-only @exodus/bytes package
    // via a bare CJS require(). The very first time a given forked worker
    // spins up the jsdom environment for a test file, that require() throws
    // ERR_REQUIRE_ESM — logged here as an "Unhandled Error" — but vitest
    // recovers and the file's tests still run and pass correctly (verified
    // deterministically across repeated full-suite runs, incl. with
    // --maxWorkers=1). The only real-world effect, left unhandled, is a
    // false-negative: vitest sets process.exitCode = 1 purely because an
    // unhandled error was logged, even though every test passed.
    //
    // We deliberately did NOT "fix" this by downgrading html-encoding-sniffer
    // or whatwg-url via package.json overrides: html-encoding-sniffer's
    // sniffing function is dead code for our test usage (we never feed jsdom
    // raw byte buffers) so that swap is safe, but whatwg-url is jsdom's core
    // URL-parsing engine — downgrading it two major versions to dodge this
    // is exactly the kind of "quick fix with real regression risk" this repo
    // avoids. Instead, narrowly tell vitest to ignore ONLY this exact known
    // signature; anything else still fails the run as normal.
    onUnhandledError(error) {
      // The forked-worker crash arrives here with its original `.code`
      // stripped (lost crossing the worker→main-process serialization
      // boundary) and Windows-vs-POSIX path separators varying by OS, so
      // match on the (separator-agnostic) message text instead of `.code`.
      const knownCrash = /require\(\) of ES Module.*@exodus[\\/]bytes.*not supported/is;
      const chain = [error, error?.cause].filter(Boolean);
      if (chain.some((e) => knownCrash.test(String(e?.message || '')))) return false;
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // include + thresholds are added in commit 2 alongside the actual
      // payments.js source — adding them here would fail because the
      // targets don't exist yet.
    },
  },
});
