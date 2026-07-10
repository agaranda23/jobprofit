/**
 * payment-link-expiry.spec.js — terminal states of the /p/<token> pay-redirect
 * endpoint (netlify/functions/pay-redirect.js). Expired, paid, refunded, and
 * not-found tokens must all resolve to a graceful HTML page — never a raw
 * redirect loop, never a 500.
 *
 * ⚠️ ENVIRONMENT NOTE (flagged in the founder report): /p/<token> is NOT
 * rendered by the React app — it's a pure server-side Netlify Function,
 * wired via the `/p/*` redirect in netlify.toml (status 200 rewrite to
 * pay-redirect.js). Plain `vite dev` on :5173 does not proxy netlify.toml
 * redirects or serve /.netlify/functions/* at all — these tests need
 * `netlify dev` (default :8888) or a real Netlify deploy preview. Running
 * this file against :5173 will 404 every case.
 *
 * These are pure HTTP assertions (status + body text) — using Playwright's
 * `request` fixture rather than `page` navigation, since there's no DOM to
 * interact with and it's meaningfully faster.
 */
import { test, expect } from '@playwright/test';
import { seedTrader, getAdminClient } from './fixtures/seeded-traders.js';
import { seedJob, seedInvoiceToken } from './fixtures/helpers.js';

test.describe('/p/<token> — terminal payment-link states', () => {
  let admin;
  let trader;
  let job;

  test.beforeAll(async () => {
    admin = getAdminClient();
    trader = await seedTrader('A'); // Stripe-connected — needed for the 503 case below
  });

  test.beforeEach(async () => {
    job = await seedJob(admin, trader, { amount: 120 });
  });

  test('expired token → 200 "link expired" HTML, no redirect', async ({ request }) => {
    const tok = await seedInvoiceToken(admin, job, {
      status: 'pending',
      expires_at: new Date(Date.now() - 3_600_000).toISOString(), // 1h in the past
    });

    const res = await request.get(`/p/${tok.token}`, { maxRedirects: 0 });
    expect(res.status()).toEqual(200);
    const body = await res.text();
    expect(body.toLowerCase()).toContain('expired');
  });

  test('paid token → 200 "payment already received"', async ({ request }) => {
    const tok = await seedInvoiceToken(admin, job, { status: 'paid', paid_at: new Date().toISOString() });

    const res = await request.get(`/p/${tok.token}`, { maxRedirects: 0 });
    expect(res.status()).toEqual(200);
    const body = await res.text();
    expect(body.toLowerCase()).toContain('already received');
  });

  test('refunded token → 200 "payment refunded"', async ({ request }) => {
    const tok = await seedInvoiceToken(admin, job, { status: 'refunded' });

    const res = await request.get(`/p/${tok.token}`, { maxRedirects: 0 });
    expect(res.status()).toEqual(200);
    const body = await res.text();
    expect(body.toLowerCase()).toContain('refund');
  });

  test('unknown token → 404 "link not found"', async ({ request }) => {
    const res = await request.get('/p/this-token-was-never-seeded', { maxRedirects: 0 });
    expect(res.status()).toEqual(404);
    const body = await res.text();
    expect(body.toLowerCase()).toContain('not found');
  });

  test('valid-but-unresolvable Stripe session → fails closed with 503, not a 500 or crash', async ({ request }) => {
    // COVERAGE GAP (flag in report): the "active token → 302 redirect to
    // Stripe" success path cannot be exercised without a REAL Stripe
    // test-mode Connect account + real Checkout Session — pay-redirect.js
    // calls stripe.checkout.sessions.retrieve() directly (unlike the webhook
    // handler, this call is NOT wrapped in a non-fatal degrade). Per QAE's
    // plan ("no real Stripe credentials"), we instead assert the failure
    // path degrades gracefully: a pending, non-expired token whose
    // stripe_checkout_session_id is fabricated must return 503 with
    // "try again" copy, never a raw 500 or an unhandled exception.
    const tok = await seedInvoiceToken(admin, job, {
      status: 'pending',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(), // still valid
      stripe_checkout_session_id: 'cs_test_does_not_exist_on_stripe',
    });

    const res = await request.get(`/p/${tok.token}`, { maxRedirects: 0 });
    expect(res.status()).toEqual(503);
    const body = await res.text();
    expect(body.toLowerCase()).toContain('try again');
  });
});
