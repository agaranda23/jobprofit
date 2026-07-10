/**
 * prod-smoke.spec.js — post-deploy canary. Deliberately small and fast;
 * this is NOT a re-run of the full loop, it's "did the deploy actually work."
 *
 * Unlike every other spec in this suite, this one drives the REAL magic-link
 * auth path — navigating the browser to the actual action_link from
 * `auth.admin.generateLink()` rather than injecting a session via
 * loginAs() — because the entire point of a prod canary is proving the real
 * auth flow (URL hash detection, detectSessionInUrl:true in
 * src/lib/supabase.js) survived whatever just got deployed.
 *
 * ⚠️ DOMAIN FLAG (surfaced in the founder report): a domain migration from
 * jobprofit.co.uk → ohnar.co.uk is in progress per the project's own
 * migration notes (feat/domain-migration-ohnar, NOT to be merged until the
 * Netlify/Supabase/Stripe dashboard cutover is live). This file defaults to
 * ohnar.co.uk but takes PLAYWRIGHT_TEST_URL as an override — confirm the
 * CURRENT production domain with the founders before trusting a run against
 * the hardcoded default; if the migration hasn't cut over yet, point
 * PLAYWRIGHT_TEST_URL at whichever domain is actually live.
 *
 * Should run against every deploy, not just PRs — wire this into whatever
 * post-deploy hook Netlify triggers (a Netlify deploy-succeeded webhook
 * calling this file, or a manual run right after clicking "Publish deploy").
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { seedTrader, getAdminClient } from './fixtures/seeded-traders.js';
import { seedJob } from './fixtures/helpers.js';
import { getJobProfit } from '../src/lib/cashflow.js';

// Deliberately NOT reusing playwright.config.js's `use.baseURL` (which
// defaults to localhost:5173 for the rest of the suite) — a prod canary that
// silently ran against localhost because PLAYWRIGHT_TEST_URL wasn't set
// would report a false "prod is fine". This file resolves its own target,
// defaulting to the production domain, and is used as an absolute URL
// everywhere below rather than relying on Playwright's relative-URL baseURL
// resolution.
const PROD_URL = process.env.PLAYWRIGHT_TEST_URL || 'https://ohnar.co.uk';

test.describe('Production smoke — post-deploy canary', () => {
  test('real magic-link auth completes and lands the trader in the app', async ({ page }) => {
    // getAdminClient() called inside each test body (not at describe-body
    // scope) so this file can be collected/listed by `playwright test --list`
    // even without SUPABASE_SERVICE_ROLE_KEY set in the shell.
    const admin = getAdminClient();
    const trader = await seedTrader('A');

    const { data: linkData, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: trader.email,
    });
    expect(error).toBeNull();
    const actionLink = linkData?.properties?.action_link;
    expect(actionLink).toBeDefined();

    // Navigate to the REAL link a user would click from their inbox — proves
    // the whole chain: Supabase auth redirect → app's detectSessionInUrl
    // handling → landing on the authenticated shell.
    await page.goto(actionLink);

    // TODO(testid): some stable "authenticated shell loaded" marker (e.g.
    // the bottom nav bar) — falling back to URL settling on the app root as
    // the interim signal.
    await expect(page).toHaveURL(/\/(#.*)?$/, { timeout: 20_000 });
  });

  test('job created via Supabase → expense added → marked paid → profit = £80 on £100/£20', async () => {
    const admin = getAdminClient();
    const trader = await seedTrader('A');
    const job = await seedJob(admin, trader, {
      amount: 100,
      paid: true,
      meta: { status: 'paid', total: 100, paidAt: new Date().toISOString() },
    });

    const { error: receiptErr } = await admin.from('receipts').insert({
      id: randomUUID(),
      user_id: trader.id,
      job_id: job.id,
      merchant: 'E2E Test Merchant',
      amount: 20,
      vat: 0,
      date: new Date().toISOString().slice(0, 10),
    });
    expect(receiptErr).toBeNull();

    // getJobProfit (src/lib/cashflow.js) is pure — exercise it directly with
    // the client-side receipt shape (jobId, amount) rather than re-deriving
    // the DB→client mapping here. Profit math itself has its own Vitest
    // coverage; this smoke test's job is proving the write path landed.
    const profit = getJobProfit(job, [{ jobId: job.id, amount: 20 }]);
    expect(profit.quote).toEqual(100);
    expect(profit.materials).toEqual(20);
    expect(profit.profit).toEqual(80);

    await admin.from('receipts').delete().eq('job_id', job.id);
  });

  test('landing page loads with no 404s and the service worker cache name resolves', async ({ page }) => {
    const failed404s = [];
    page.on('response', (response) => {
      if (response.status() === 404) failed404s.push(response.url());
    });

    await page.goto(PROD_URL);
    await page.waitForLoadState('networkidle');

    expect(failed404s).toEqual([]);

    // sw.js is registered with no-cache (see netlify.toml header block) so a
    // stale service worker never masks a bad deploy.
    const swResponse = await page.request.get(`${PROD_URL.replace(/\/$/, '')}/sw.js`);
    expect(swResponse.ok()).toEqual(true);
    const swBody = await swResponse.text();
    expect(swBody).toMatch(/CACHE_NAME/);
  });
});
