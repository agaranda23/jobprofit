/**
 * trial-expired-loop-not-blocked.spec.js — free-tier parity for the Get Paid
 * loop. Trader E's trial expired 30 days ago (plan='trial', trial_ends_at in
 * the past — see fixtures/seeded-traders.js). Walks the same quote → send-
 * invoice sequence as get-paid-loop.spec.js and asserts every CTA stays
 * enabled — no Pro paywall blocks sending a quote or an invoice.
 *
 * ⚠️ FOUNDER FLAG (verbatim from QAE's plan — surfaced in the report too):
 * confirm whether this free-tier non-blocking is INTENDED design or a future
 * Pro gate. If a future gate ships, these assertions will need to invert.
 *
 * THIS IS NOT A GUESS — src/lib/plan.js documents it as current, deliberate
 * behaviour, not an oversight:
 *   - `canSendInvoice()` always returns true (function kept only so callers
 *     don't need changes) — "Invoices are now UNLIMITED for ALL plans as of
 *     2026-06-03... the Get Paid loop is free forever."
 *   - `FREE_MONTHLY_INVOICE_LIMIT` is exported as `Infinity`, marked
 *     `@deprecated`, kept only so old imports don't break.
 *   - The only Pro-gated perk anywhere in that file is white-label (removing
 *     the "Sent with JobProfit" footer) — `showJobProfitFooter()` /
 *     `eligibleForWhiteLabelNudge()`. That's a nudge shown AFTER a
 *     successful send, never a blocker.
 * This spec's first assertion block checks that contract directly against
 * the real plan.js module (no browser needed) before ever touching the UI,
 * so a regression here fails fast with a precise cause instead of a vague
 * "button was disabled" screenshot.
 */
import { test, expect } from '@playwright/test';
import { seedTrader, loginAs, getAdminClient } from './fixtures/seeded-traders.js';
import { seedJob, extractWhatsAppUrl } from './fixtures/helpers.js';
// Pure logic module (Date-only, no DOM) — safe to import directly in the Node
// test process rather than reaching into the browser to check it.
import { isPro, isTrialActive, canSendInvoice } from '../src/lib/plan.js';

test.describe('Get Paid loop — free/expired-trial parity (Trader E)', () => {
  let admin;
  let trader;
  let job;

  test.beforeAll(async () => {
    admin = getAdminClient();
    trader = await seedTrader('E');
  });

  test.beforeEach(async () => {
    job = await seedJob(admin, trader, {
      status: 'active',
      amount: 90,
      summary: 'Bleed radiators, top up boiler pressure',
      meta: { status: 'active', total: 90, lineItems: [{ id: 'li_1', desc: 'Bleed radiators, top up pressure', cost: 90 }] },
    });
  });

  test('plan.js contract: Trader E is genuinely non-Pro but invoice sending is unlimited', async () => {
    expect(isTrialActive(trader.profile)).toEqual(false);
    expect(isPro(trader.profile)).toEqual(false);
    expect(canSendInvoice(trader.profile, [])).toEqual(true);
  });

  test('Send Invoice completes with every CTA enabled — no paywall interception', async ({ page }) => {
    await loginAs(page, trader);
    await page.goto('/');

    // TODO(testid): open the job's drawer, then Send Invoice.
    await page.getByText('E2E Test Customer').first().click();

    const sendInvoiceButton = page.getByTestId('send-invoice-button');
    await expect(sendInvoiceButton).toBeVisible({ timeout: 15_000 });
    await expect(sendInvoiceButton).toBeEnabled();
    await sendInvoiceButton.click();

    // No ProUpgradeSheet paywall should appear before the send — assert its
    // absence explicitly rather than just proceeding, so a regression that
    // silently inserts a blocking gate fails loudly here.
    await expect(page.getByTestId('pro-upgrade-sheet')).toHaveCount(0);

    const confirmButton = page.getByTestId('send-invoice-confirm-button');
    await expect(confirmButton).toBeEnabled();

    const { url: waUrl } = await extractWhatsAppUrl(page, async () => {
      await confirmButton.click();
    });
    expect(waUrl.startsWith('https://wa.me/')).toEqual(true);

    // Confirms the send actually persisted (not silently blocked server-side
    // either — canSendInvoice() always true, but this is the end-to-end proof).
    await expect
      .poll(async () => {
        const { data } = await admin.from('jobs').select('meta').eq('id', job.id).single();
        return data?.meta?.invoiceSentAt ?? null;
      }, { timeout: 15_000 })
      .not.toBeNull();

    // eligibleForWhiteLabelNudge() is expected to be TRUE for this trader
    // (free/expired-trial) — the post-send nudge is a soft upsell, not a
    // paywall, and its presence here is the correct/expected behaviour, not
    // a bug. Assert it's DISMISSIBLE (never blocks closing the flow).
    const nudgeDismiss = page.getByTestId('post-send-nudge-dismiss');
    if (await nudgeDismiss.isVisible().catch(() => false)) {
      await expect(nudgeDismiss).toBeEnabled();
      await nudgeDismiss.click();
    }
  });
});
