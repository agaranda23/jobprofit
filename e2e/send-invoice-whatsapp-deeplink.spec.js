/**
 * send-invoice-whatsapp-deeplink.spec.js — WhatsApp send mechanics in
 * isolation from the full loop, using one pre-seeded job at stage 'On'.
 *
 * Two things this spec exists to prove:
 *   1. The wa.me deep-link is constructed correctly (customer phone, message
 *      content, hosted invoice URL).
 *   2. persistPublicToken's cloud write RESOLVES before window.open fires —
 *      see src/components/SendInvoiceModal.jsx handleWhatsApp(), which awaits
 *      attemptSend() (which itself awaits persistPublicToken) before ever
 *      calling window.open(). If a future refactor accidentally fires the
 *      WhatsApp link before the token write lands, a customer who taps the
 *      link fast enough hits "Invoice not found" — this is the regression
 *      this spec guards against.
 *
 * A real WhatsApp app hand-off cannot be verified in Playwright — the mobile
 * emulation profiles here (WebKit/Chromium) can't switch to a native app.
 * This proves the URL was constructed correctly, not that WhatsApp opens it.
 * That gap is closed by manual device testing (flagged in the founder report).
 *
 * MISSING INSTRUMENTATION: see the founder report — this spec references
 * data-testid selectors that don't exist yet.
 */
import { test, expect } from '@playwright/test';
import { seedTrader, loginAs, getAdminClient } from './fixtures/seeded-traders.js';
import { seedJob, extractWhatsAppUrl } from './fixtures/helpers.js';

test.describe('Send Invoice — WhatsApp deep-link mechanics (Trader A, isolated)', () => {
  let admin;
  let trader;
  let job;

  test.beforeAll(async () => {
    admin = getAdminClient();
    trader = await seedTrader('A');
  });

  test.beforeEach(async () => {
    // Stage 'On' (active, priced, not yet invoiced) — the state a job is in
    // right before the trader taps Send Invoice for the first time.
    job = await seedJob(admin, trader, {
      status: 'active',
      amount: 200,
      phone: '07700900123',
      summary: 'Fix leaking radiator valve',
      meta: { status: 'active', total: 200, lineItems: [{ id: 'li_1', desc: 'Fix leaking radiator valve', cost: 200 }] },
    });
  });

  test('wa.me link contains the hosted invoice URL and fires after the token write lands', async ({ page }) => {
    await loginAs(page, trader);
    await page.goto('/');

    // Track every write to the jobs REST endpoint so we can order it against
    // the window.open() call captured by extractWhatsAppUrl below.
    const jobsWriteTimestamps = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/rest/v1/jobs') && response.request().method() !== 'GET') {
        jobsWriteTimestamps.push(Date.now());
      }
    });

    // TODO(testid): open the job's drawer, then Send Invoice.
    await page.getByText('E2E Test Customer').first().click();
    await page.getByTestId('send-invoice-button').click();

    const { url: waUrl, allOpens } = await extractWhatsAppUrl(page, async () => {
      // TODO(testid): SendInvoiceModal's primary CTA
      // (className="invoice-send-whatsapp" in the current source — no
      // data-testid). Confirm/rename once ENG instruments it.
      await page.getByTestId('send-invoice-confirm-button').click();
    });

    // ── URL shape assertions ────────────────────────────────────────────────
    expect(waUrl.startsWith('https://wa.me/')).toEqual(true);
    // buildWhatsAppLink() (src/lib/invoiceMessage.js) strips the leading 0 and
    // prefixes 44 — 07700900123 → 447700900123.
    expect(waUrl).toContain('447700900123');

    const decodedMessage = decodeURIComponent(waUrl.split('?text=')[1] || '');
    // Hosted invoice URL is /i/<publicAccessToken> — buildPublicInvoiceUrl().
    expect(decodedMessage).toMatch(/\/i\/[0-9a-f-]{36}/i);

    // ── Ordering assertion — the actual point of this spec ─────────────────
    expect(jobsWriteTimestamps.length).toBeGreaterThan(0);
    const lastWriteTs = jobsWriteTimestamps[jobsWriteTimestamps.length - 1];
    const windowOpenTs = allOpens[0].ts;
    expect(lastWriteTs).toBeLessThanOrEqual(windowOpenTs);

    // ── DB-level cross-check — the token in the URL must match what landed ──
    const { data: dbJob } = await admin.from('jobs').select('meta').eq('id', job.id).single();
    const expectedToken = dbJob.meta?.publicAccessToken;
    expect(expectedToken).toBeDefined();
    expect(decodedMessage).toContain(expectedToken);
  });
});
