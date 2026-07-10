/**
 * stripe-not-connected-409.spec.js — graceful 409 handling when a customer
 * tries to pay by card but the trader is not (or is no longer) connected to
 * Stripe.
 *
 * Two angles, both from QAE's plan:
 *   1. Direct request-fixture call to create-invoice-payment-link-public.js
 *      — the simplest, fastest proof of the 409 contract.
 *   2. A UI-driven race-condition scenario: the trader WAS connected when the
 *      invoice was sent (so PublicInvoiceView renders PayNowBlock), but
 *      disconnects before the customer taps Pay — create-invoice-payment-
 *      link-public.js re-checks the connection live, so this is the only
 *      realistic way a customer ever sees the 409 through the actual UI.
 *      Asserts the inline error renders and the button returns to an
 *      enabled, non-busy state (PayNowBlock's `state` goes 'loading' → 'error',
 *      re-enabling the button — see src/screens/PublicInvoiceView.jsx).
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { seedTrader, getAdminClient } from './fixtures/seeded-traders.js';
import { seedJob, navigateToPublicPage } from './fixtures/helpers.js';

test.describe('create-invoice-payment-link-public — 409 NOT_CONNECTED', () => {
  test('direct request to a not-connected trader\'s invoice returns 409 NOT_CONNECTED', async ({ request }) => {
    // getAdminClient() called inside each test body (not at describe-body
    // scope) so this file can be collected/listed by `playwright test --list`
    // even without SUPABASE_SERVICE_ROLE_KEY set in the shell.
    const admin = getAdminClient();
    const trader = await seedTrader('D'); // not connected, no static link, no bank details
    const job = await seedJob(admin, trader, {
      amount: 75,
      meta: { publicAccessToken: randomUUID(), invoiceSentAt: new Date().toISOString(), total: 75 },
    });

    const res = await request.post('/.netlify/functions/create-invoice-payment-link-public', {
      data: { publicInvoiceToken: job.meta.publicAccessToken },
    });

    expect(res.status()).toEqual(409);
    const body = await res.json();
    expect(body.code).toEqual('NOT_CONNECTED');
    expect(typeof body.error).toEqual('string');
  });

  test('trader disconnects between invoice-open and Pay tap — inline error shows, no stuck loading state', async ({ browser }) => {
    const admin = getAdminClient();
    // Start connected so fetch-public-invoice reports isConnected:true and
    // PublicInvoiceView renders PayNowBlock at all.
    const trader = await seedTrader('D');
    await admin
      .from('profiles')
      .update({ stripe_connect_status: 'connected', stripe_user_id: 'acct_test_e2e_d_temp' })
      .eq('id', trader.id);

    const job = await seedJob(admin, trader, {
      amount: 60,
      meta: { publicAccessToken: randomUUID(), invoiceSentAt: new Date().toISOString(), total: 60 },
    });

    const ctx = await browser.newContext();
    const { page } = await navigateToPublicPage(ctx, '/i', job.meta.publicAccessToken);

    const payButton = page.getByRole('button', { name: /pay .* by card/i });
    await expect(payButton).toBeVisible({ timeout: 15_000 });

    // Simulate the disconnect happening right before the customer pays —
    // create-invoice-payment-link-public.js re-reads the profile live, so
    // this flip is enough to reproduce the 409 through the real UI path.
    await admin
      .from('profiles')
      .update({ stripe_connect_status: 'disconnected', stripe_user_id: null })
      .eq('id', trader.id);

    await payButton.click();

    // PayNowBlock's inline error (role="alert" in the source).
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('alert')).toContainText(/bank transfer/i);

    // No stuck loading state — button must be re-enabled and readable again,
    // not permanently disabled/spinning.
    await expect(payButton).toBeEnabled();
    await expect(payButton).not.toHaveText(/preparing/i);

    await ctx.close();
  });
});
