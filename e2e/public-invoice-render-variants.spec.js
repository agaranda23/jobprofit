/**
 * public-invoice-render-variants.spec.js — the three payment-method branches
 * on the hosted invoice page (/i/<token>), one trader per branch, run
 * sequentially within a single test per QAE's plan.
 *
 * Branch → trader mapping (src/screens/PublicInvoiceView.jsx):
 *   Trader A — Stripe Connect connected  → PayNowBlock  (a <button>)
 *   Trader B — static Stripe Payment Link, not Connect → StaticPayLink (an <a>)
 *   Trader C — bank details only, no card option at all → bank-only note
 *
 * NO MISSING INSTRUMENTATION — unlike most other specs in this suite, this
 * one needs zero new data-testid attributes. PayNowBlock renders a native
 * <button>, StaticPayLink renders a native <a href>, and both happen to
 * share the same CSS class (`piv-btn-paynow`) — so role (button vs link) is
 * the only selector that reliably distinguishes them, and Playwright's
 * getByRole already does that. The bank-only note has a unique class
 * (`.piv-bank-only-note`). This spec should be runnable as soon as env vars
 * + seeded traders are in place.
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { seedTrader, getAdminClient } from './fixtures/seeded-traders.js';
import { seedJob, navigateToPublicPage } from './fixtures/helpers.js';

const PAY_BUTTON_RE = /pay .* by card/i;

test.describe('Public invoice — payment method variants', () => {
  test('Trader A (Connect) shows PayNowBlock and nothing else', async ({ browser }) => {
    // getAdminClient() called inside each test body (not at describe-body
    // scope) so this file can be collected/listed by `playwright test --list`
    // even without SUPABASE_SERVICE_ROLE_KEY set in the shell.
    const admin = getAdminClient();
    const trader = await seedTrader('A');
    const job = await seedJob(admin, trader, {
      amount: 150,
      meta: { publicAccessToken: randomUUID(), invoiceSentAt: new Date().toISOString(), total: 150 },
    });

    const ctx = await browser.newContext();
    const { page } = await navigateToPublicPage(ctx, '/i', job.meta.publicAccessToken);

    await expect(page.getByRole('button', { name: PAY_BUTTON_RE })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: PAY_BUTTON_RE })).toHaveCount(0);
    await expect(page.locator('.piv-bank-only-note')).toHaveCount(0);

    await ctx.close();
  });

  test('Trader B (static payment link) shows StaticPayLink and nothing else', async ({ browser }) => {
    const admin = getAdminClient();
    const trader = await seedTrader('B');
    const job = await seedJob(admin, trader, {
      amount: 220,
      meta: { publicAccessToken: randomUUID(), invoiceSentAt: new Date().toISOString(), total: 220 },
    });

    const ctx = await browser.newContext();
    const { page } = await navigateToPublicPage(ctx, '/i', job.meta.publicAccessToken);

    const payLink = page.getByRole('link', { name: PAY_BUTTON_RE });
    await expect(payLink).toBeVisible({ timeout: 15_000 });
    await expect(payLink).toHaveAttribute('href', trader.profile.stripe_payment_link);
    await expect(page.getByRole('button', { name: PAY_BUTTON_RE })).toHaveCount(0);
    await expect(page.locator('.piv-bank-only-note')).toHaveCount(0);

    await ctx.close();
  });

  test('Trader C (bank details only) shows the bank-only note and no card CTA', async ({ browser }) => {
    const admin = getAdminClient();
    const trader = await seedTrader('C');
    const job = await seedJob(admin, trader, {
      amount: 90,
      meta: { publicAccessToken: randomUUID(), invoiceSentAt: new Date().toISOString(), total: 90 },
    });

    const ctx = await browser.newContext();
    const { page } = await navigateToPublicPage(ctx, '/i', job.meta.publicAccessToken);

    await expect(page.locator('.piv-bank-only-note')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: PAY_BUTTON_RE })).toHaveCount(0);
    await expect(page.getByRole('link', { name: PAY_BUTTON_RE })).toHaveCount(0);
    // NOTE: not asserting the exact rendered sort-code string here —
    // InvoiceDocumentPreview.jsx may reformat it (e.g. with dashes) and this
    // spec wasn't scoped to read that component. The bank-only-note check
    // above is the load-bearing assertion for this branch.

    await ctx.close();
  });
});
