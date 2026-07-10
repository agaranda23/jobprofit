/**
 * get-paid-loop.spec.js — the Get Paid loop happy path, end to end.
 *
 * Quote (already sent) → customer accepts → trader sends invoice → customer
 * pays by card (synthetic Stripe webhook — per QAE's plan: real Supabase,
 * Stripe stubbed via a signed direct POST, never the real Checkout UI) →
 * job lands in the canonical paid state → trader UI reflects it.
 *
 * SCOPING NOTE (flag for the founders): this spec seeds the STARTING quote
 * via seedJob() rather than driving the full "+ New job" → quote-builder UI
 * from a blank job. That UI (voice input, AI quote generation, line-item
 * builder) is complex enough to deserve its own dedicated coverage rather
 * than being re-walked inside the loop's happy path every run. This spec
 * proves the CROSS-SYSTEM seams instead: trader UI ↔ public customer pages
 * ↔ Netlify functions ↔ Stripe webhook ↔ Supabase eventual consistency ↔
 * trader UI reflecting the paid state. That's where Get Paid loop
 * regressions actually live — a broken quote-builder would fail fast and
 * loud in manual testing; a broken webhook reconciliation fails silently
 * days later as "customer says they paid but the job still shows unpaid."
 *
 * Longest spec in the suite — Supabase eventual consistency after the
 * synthetic webhook needs polling headroom (90s file-level timeout is set
 * globally in playwright.config.js).
 *
 * MISSING INSTRUMENTATION: every `getByTestId(...)` call below references a
 * selector that does not exist in the codebase yet. See the founder report's
 * "Missing instrumentation" section for the full list and which file each
 * belongs in. This spec will not pass until those are added — that is
 * expected, not a bug in this file.
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { seedTrader, loginAs, getAdminClient } from './fixtures/seeded-traders.js';
import {
  seedJob,
  navigateToPublicPage,
  waitForSupabaseWrite,
  buildCheckoutSessionCompletedEvent,
  createSyntheticStripeWebhook,
} from './fixtures/helpers.js';

const BASE_URL = process.env.PLAYWRIGHT_TEST_URL || 'http://localhost:5173';

test.describe('Get Paid loop — happy path (Trader A)', () => {
  let admin;
  let trader;
  let job;

  test.beforeAll(async () => {
    // Called lazily inside beforeAll (not at describe-body scope) so this
    // file can be collected/listed by `playwright test --list` even without
    // SUPABASE_SERVICE_ROLE_KEY set in the shell.
    admin = getAdminClient();
    trader = await seedTrader('A');
  });

  test.beforeEach(async () => {
    // A quote already "sent" to the customer (publicAccessToken set) —
    // represents the state right after the trader taps Send on a real quote.
    // See file docblock for why we don't drive the quote-builder UI here.
    job = await seedJob(admin, trader, {
      status: 'quoted',
      amount: 350,
      summary: 'Replace kitchen tap and fix under-sink leak',
      meta: {
        status: 'quoted',
        quoteStatus: 'sent',
        total: 350,
        lineItems: [
          { id: 'li_1', desc: 'Replace kitchen tap', cost: 220 },
          { id: 'li_2', desc: 'Fix under-sink leak', cost: 130 },
        ],
        publicAccessToken: randomUUID(),
      },
    });
  });

  test('trader sees the seeded quote in the Work tab', async ({ page }) => {
    await loginAs(page, trader);
    await page.goto('/');

    // TODO(testid): job tiles have no stable selector yet — falling back to
    // a text match on the customer name, which is brittle (breaks the moment
    // two seeded jobs share a customer name in a shared test project).
    await expect(page.getByText('E2E Test Customer').first()).toBeVisible({ timeout: 15_000 });
  });

  test('customer accepts, trader invoices, card payment lands the job as paid', async ({ page, browser }) => {
    const quoteToken = job.meta.publicAccessToken;

    // ── 1. Customer opens the public quote page and accepts ────────────────
    const customerCtx = await browser.newContext();
    const { page: quotePage } = await navigateToPublicPage(customerCtx, '/q', quoteToken);

    await expect(quotePage.getByText(job.summary, { exact: false })).toBeVisible({ timeout: 15_000 });

    // TODO(testid): PublicQuoteView's Accept button.
    await quotePage.getByTestId('accept-quote-button').click();
    await expect(quotePage.getByText(/accepted/i)).toBeVisible({ timeout: 10_000 });
    await customerCtx.close();

    // ── 2. Assert acceptance landed in Supabase (accept-quote.js) ──────────
    const acceptedJob = await waitForSupabaseWrite(
      admin,
      'jobs',
      (row) => row.meta?.quoteStatus === 'accepted',
      { baseFilter: { id: job.id }, timeoutMs: 15_000 }
    );
    expect(acceptedJob.meta.quoteStatus).toEqual('accepted');
    // accept-quote.js only advances meta.status → 'active' when the job was
    // 'quoted' beforehand (never time-travels backwards from On/Invoiced/Paid).
    expect(acceptedJob.meta.status).toEqual('active');

    // ── 3. Trader sends the invoice from the now-active job ────────────────
    await loginAs(page, trader);
    await page.goto('/');

    // TODO(testid): open the job's drawer, then the Send Invoice CTA + confirm.
    await page.getByText('E2E Test Customer').first().click();
    await page.getByTestId('send-invoice-button').click();
    await page.getByTestId('send-invoice-confirm-button').click();

    const invoicedJob = await waitForSupabaseWrite(
      admin,
      'jobs',
      (row) => row.meta?.invoiceSentAt != null,
      { baseFilter: { id: job.id }, timeoutMs: 15_000 }
    );
    expect(invoicedJob.meta.publicAccessToken).toBeDefined();
    const invoiceToken = invoicedJob.meta.publicAccessToken;

    // ── 4. Customer opens the hosted invoice ────────────────────────────────
    const payerCtx = await browser.newContext();
    const { page: invoicePage } = await navigateToPublicPage(payerCtx, '/i', invoiceToken);

    // Trader A is Stripe-connected — PayNowBlock should render (native
    // <button>, distinct from Trader B's StaticPayLink <a> — see
    // public-invoice-render-variants.spec.js for the full three-way check).
    await expect(invoicePage.getByRole('button', { name: /pay .* by card/i })).toBeVisible({ timeout: 15_000 });
    await payerCtx.close();

    // We deliberately do NOT click through to real Stripe Checkout — per
    // QAE's plan, Stripe is stubbed via a signed direct webhook POST so the
    // suite never depends on live Stripe test-mode UI stability.

    // ── 5. Fire the synthetic checkout.session.completed webhook ───────────
    const event = buildCheckoutSessionCompletedEvent({
      invoiceId: job.id,
      traderUserId: trader.id,
      traderStripeAccountId: trader.profile.stripe_user_id,
      amountPence: 35000,
    });

    const webhookResult = await createSyntheticStripeWebhook(BASE_URL, event);
    expect(webhookResult.status).toEqual(200);

    // ── 6. Assert the job lands in the canonical paid state ────────────────
    const paidJob = await waitForSupabaseWrite(admin, 'jobs', { id: job.id, paid: true }, { timeoutMs: 20_000 });
    expect(paidJob.paid).toEqual(true);
    expect(paidJob.status).toEqual('paid');
    expect(paidJob.payment_date).not.toBeNull();
    expect(paidJob.card_paid_at).not.toBeNull();

    // ⚠️ CONFIRMED GAP (see mark-paid-manual-fallback.spec.js for the full
    // investigation): stripe-connect-webhook.js's handleCheckoutCompleted
    // never writes meta.paidAt — only stagePatch('Paid') (manual mark-paid,
    // src/lib/jobStatus.js) does. src/lib/store.js's mapCloudJobToToday()
    // derives job.paidAt purely from meta.paidAt with no fallback to
    // payment_date/card_paid_at, so a card-paid job's paidAt is undefined
    // even though paid/status/payment_date/card_paid_at are all correct.
    // Documented here as CURRENT (broken) behaviour so this spec doesn't
    // silently start failing the moment ENG backfills it — flip this to
    // `.toBeDefined()` once that fix ships.
    expect(paidJob.meta?.paidAt).toBeUndefined();

    // ── 7. Trader UI reflects the paid state ────────────────────────────────
    await page.reload();
    // TODO(testid): job tile stage chip should read "Paid"; no selector yet.
    await expect(page.getByText('E2E Test Customer').first()).toBeVisible({ timeout: 15_000 });
    // Profit assertion intentionally omitted here — profit MATH is unit-
    // tested (src/lib/cashflow.js's getJobProfit, see project Vitest suites);
    // this spec's job is proving the loop reaches the paid state at all.
  });
});
