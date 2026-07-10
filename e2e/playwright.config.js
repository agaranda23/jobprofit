// Playwright configuration — Get Paid loop E2E suite.
//
// Two device profiles only (per QAE's plan): iPhone 13 (WebKit — closest
// Playwright gets to iOS Safari) and Pixel 7 (Chromium — Android Chrome).
// See the caveat block below: this is layout/logic coverage, NOT a substitute
// for real-device testing of anything touching camera, storage limits, or
// native app hand-off (WhatsApp, Add-to-Home-Screen).
//
// Base URL resolution:
//   PLAYWRIGHT_TEST_URL unset  → http://localhost:5173 (plain `vite dev`)
//   PLAYWRIGHT_TEST_URL set    → Netlify deploy preview / prod URL
//
// IMPORTANT ENVIRONMENT NOTE (flagged in the founder report too):
// Plain `vite dev` on :5173 serves the React app ONLY — it does not proxy
// netlify.toml redirects or /.netlify/functions/*. Every spec except pure
// UI-shell smoke checks needs either:
//   (a) `netlify dev` running locally (proxies both, default :8888), or
//   (b) PLAYWRIGHT_TEST_URL pointed at a real Netlify deploy preview.
// `npm run test:e2e:local` as specified defaults to :5173 for dev-server
// convenience; `npm run test:e2e:netlify` (added below, not in the original
// ask — flagged in the report) points at :8888 for full-loop runs.
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_TEST_URL || 'http://localhost:5173';

// Only auto-boot a dev server when no explicit URL was supplied (local runs).
// Deploy-preview / prod-smoke runs always pass PLAYWRIGHT_TEST_URL and manage
// their own server lifecycle (Netlify does it for us).
const webServer = process.env.PLAYWRIGHT_TEST_URL
  ? undefined
  : {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    };

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.js',

  // get-paid-loop.spec.js polls Supabase for eventual-consistency after a
  // synthetic Stripe webhook — 90s per QAE's plan covers that plus normal
  // network jitter on a Netlify deploy preview (cold Lambda starts).
  timeout: 90_000,

  expect: {
    timeout: 10_000,
  },

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  webServer,

  // Wipes seeded jobs/tokens/IndexedDB state via the service-role client so
  // repeated runs don't accumulate garbage in the shared Supabase project.
  // Guarded internally against missing SUPABASE_SERVICE_ROLE_KEY so `--list`
  // and config-only invocations never throw.
  globalTeardown: './global-teardown.js',

  projects: [
    {
      name: 'iOS Safari (iPhone 13)',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'Android Chrome (Pixel 7)',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
