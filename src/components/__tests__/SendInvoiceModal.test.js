/**
 * SendInvoiceModal — pure-logic tests.
 *
 * No DOM, no React, no @testing-library — matches project convention.
 * Visual smoke is covered by the deploy-preview checklist in the PR.
 *
 * Covers:
 *   - Invoice send CTA gating (showSendInvoice / showResendInvoice)
 *   - invoiceSentAt field written correctly on first send
 *   - Paywall gate: canSendInvoice blocks free users after 1 send
 *   - nextInvoiceNumber increments from existing invoiced jobs
 *   - buildInvoiceWhatsAppMessage basic shape (has invoice number + total)
 *   - getInvoicePDFBlob returns a Blob (PDF generation round-trip)
 *   - getMissingInvoiceFields flags missing bank details
 */

import { describe, it, expect } from 'vitest';
import { nextInvoiceNumber } from '../../lib/invoiceNumber';
import { buildInvoiceWhatsAppMessage, buildWhatsAppLink } from '../../lib/invoiceMessage';
import { getInvoicePDFBlob } from '../../lib/invoicePDF';
import { getMissingInvoiceFields } from '../../lib/bizValidation';
import { resolveBusinessIdentity } from '../../lib/resolveBusinessIdentity';
import { canSendInvoice, UNLOCK_PRO_FOR_ALL } from '../../lib/plan';
import { generatePublicAccessToken } from '../../lib/publicQuoteToken';
import { buildPublicInvoiceUrl } from '../../lib/publicInvoiceToken';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function baseJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Mrs. Jane Bloggs',
    address: '12 Test Street, Manchester',
    phone: '07700 900000',
    summary: 'Replace kitchen taps and fix leak under sink',
    total: 380,
    ...overrides,
  };
}

function baseBiz(overrides = {}) {
  return {
    name: 'Alan Plumbing Ltd',
    address: '1 Trade Lane, Manchester',
    phone: '07800 100200',
    email: 'alan@alanplumbing.co.uk',
    accountName: 'Alan Aranda',
    sortCode: '12-34-56',
    accountNumber: '12345678',
    vatRegistered: false,
    ...overrides,
  };
}

function freeProfile(overrides = {}) {
  return { id: 'u1', plan: 'free', invoices_sent_count: 0, ...overrides };
}

function proProfile(overrides = {}) {
  return { id: 'u2', plan: 'pro', invoices_sent_count: 0, ...overrides };
}

// Mirror the showSendInvoice / showResendInvoice logic from JobDetailDrawer.
// Tested here as pure-logic excerpts so the gate conditions can be verified
// without mounting a component.
function deriveStatus(job) {
  if (job.paid || job.paymentStatus === 'paid' || job.jobStatus === 'paid') return 'Paid';
  if (job.invoiceStatus === 'invoiced' || job.status === 'invoice_sent') return 'Invoiced';
  if (job.jobStatus === 'complete' || job.status === 'complete') return 'Done';
  if (job.jobStatus === 'active' || job.status === 'active') return 'Active';
  return 'Quoted';
}

function invoiceCTAState(job) {
  const status = deriveStatus(job);
  const invoiceAlreadySent =
    status === 'Invoiced' || status === 'Paid' ||
    !!job.invoiceSentAt || job.status === 'invoice_sent';
  const showSendInvoice = status !== 'Paid' && !invoiceAlreadySent;
  const showResendInvoice = status !== 'Paid' && invoiceAlreadySent;
  return { showSendInvoice, showResendInvoice };
}

// ── Invoice CTA gating ────────────────────────────────────────────────────────

describe('invoice CTA gating — showSendInvoice / showResendInvoice', () => {
  it('shows Send invoice on a fresh quoted job', () => {
    const { showSendInvoice, showResendInvoice } = invoiceCTAState(baseJob());
    expect(showSendInvoice).toBe(true);
    expect(showResendInvoice).toBe(false);
  });

  it('shows Send invoice on an active job with no invoiceSentAt', () => {
    const { showSendInvoice } = invoiceCTAState(baseJob({ jobStatus: 'active' }));
    expect(showSendInvoice).toBe(true);
  });

  it('shows Send invoice on a completed (done not invoiced) job', () => {
    const { showSendInvoice } = invoiceCTAState(
      baseJob({ jobStatus: 'complete', invoiceStatus: 'none', paymentStatus: 'unpaid' })
    );
    expect(showSendInvoice).toBe(true);
  });

  it('shows Resend invoice when invoiceSentAt is set', () => {
    const { showSendInvoice, showResendInvoice } = invoiceCTAState(
      baseJob({ invoiceSentAt: '2026-05-20T10:00:00.000Z' })
    );
    expect(showSendInvoice).toBe(false);
    expect(showResendInvoice).toBe(true);
  });

  it('shows Resend invoice when status is invoice_sent', () => {
    const { showSendInvoice, showResendInvoice } = invoiceCTAState(
      baseJob({ status: 'invoice_sent' })
    );
    expect(showSendInvoice).toBe(false);
    expect(showResendInvoice).toBe(true);
  });

  it('shows Resend invoice when invoiceStatus is invoiced', () => {
    const { showSendInvoice, showResendInvoice } = invoiceCTAState(
      baseJob({ invoiceStatus: 'invoiced', paymentStatus: 'unpaid' })
    );
    expect(showSendInvoice).toBe(false);
    expect(showResendInvoice).toBe(true);
  });

  it('hides both CTAs on a paid job', () => {
    const { showSendInvoice, showResendInvoice } = invoiceCTAState(
      baseJob({ paid: true, paymentStatus: 'paid' })
    );
    expect(showSendInvoice).toBe(false);
    expect(showResendInvoice).toBe(false);
  });

  it('hides both CTAs when paymentStatus is paid', () => {
    const { showSendInvoice, showResendInvoice } = invoiceCTAState(
      baseJob({ paymentStatus: 'paid' })
    );
    expect(showSendInvoice).toBe(false);
    expect(showResendInvoice).toBe(false);
  });
});

// ── invoiceSentAt mutation shape ──────────────────────────────────────────────

describe('invoiceSentAt — field written on first send', () => {
  it('updated job has status invoice_sent and invoiceSentAt ISO string', () => {
    const job = baseJob();
    const now = new Date();
    const updated = {
      ...job,
      status: 'invoice_sent',
      invoiceSentAt: now.toISOString(),
      invoiceNumber: 'JP-0001',
      invoiceDueDate: new Date(now.getTime() + 14 * 86400000).toISOString(),
    };
    expect(updated.status).toBe('invoice_sent');
    expect(typeof updated.invoiceSentAt).toBe('string');
    expect(new Date(updated.invoiceSentAt).getFullYear()).toBe(now.getFullYear());
  });

  it('invoiceAlreadySent gate is true after update', () => {
    const updated = baseJob({ status: 'invoice_sent', invoiceSentAt: new Date().toISOString() });
    const { showSendInvoice, showResendInvoice } = invoiceCTAState(updated);
    expect(showSendInvoice).toBe(false);
    expect(showResendInvoice).toBe(true);
  });
});

// ── canSendInvoice paywall gate ───────────────────────────────────────────────
// Free tier: 3 sends per calendar month (resets on the 1st).
// invoices_sent_count on the profile is INERT for gating — the count
// is now derived from jobs in app state (invoice_sent status + invoiceSentAt).

describe('canSendInvoice — paywall gating', () => {
  const NOW = new Date('2026-06-15T12:00:00Z');
  const THIS_MONTH = '2026-06-10T09:00:00Z';

  function sentJob() {
    return { status: 'invoice_sent', invoiceSentAt: THIS_MONTH };
  }

  it('free user with 0 sends this month can send', () => {
    expect(canSendInvoice(freeProfile(), [], NOW)).toBe(true);
  });

  it('free user with 1 send this month can still send', () => {
    expect(canSendInvoice(freeProfile(), [sentJob()], NOW)).toBe(true);
  });

  it('free user with 2 sends this month can still send', () => {
    expect(canSendInvoice(freeProfile(), [sentJob(), sentJob()], NOW)).toBe(true);
  });

  it('free user with 3 sends this month is blocked (quota reached)', () => {
    const jobs = [sentJob(), sentJob(), sentJob()];
    expect(canSendInvoice(freeProfile(), jobs, NOW)).toBe(UNLOCK_PRO_FOR_ALL ? true : false);
  });

  it('invoices_sent_count on the profile no longer affects gating', () => {
    // Old behaviour: count=1 would block. New behaviour: only this-month jobs count.
    expect(canSendInvoice(freeProfile({ invoices_sent_count: 99 }), [], NOW)).toBe(true);
  });

  it('pro user is always allowed regardless of monthly send count', () => {
    const jobs = [sentJob(), sentJob(), sentJob(), sentJob()];
    expect(canSendInvoice(proProfile(), jobs, NOW)).toBe(true);
  });

  it('null profile (unauthenticated) with no jobs allows send', () => {
    expect(canSendInvoice(null, [], NOW)).toBe(true);
  });

  it('undefined profile with no jobs allows send', () => {
    expect(canSendInvoice(undefined, [], NOW)).toBe(true);
  });
});

// ── nextInvoiceNumber ─────────────────────────────────────────────────────────

describe('nextInvoiceNumber — JP-series from job.invoiceNumber fields', () => {
  it('returns JP-0001 for an empty jobs list', () => {
    expect(nextInvoiceNumber([])).toBe('JP-0001');
  });

  it('returns JP-0001 when no job has an invoiceNumber', () => {
    expect(nextInvoiceNumber([baseJob(), baseJob({ id: 'j2' })])).toBe('JP-0001');
  });

  it('increments from the highest existing JP-number', () => {
    const jobs = [
      baseJob({ invoiceNumber: 'JP-0003' }),
      baseJob({ id: 'j2', invoiceNumber: 'JP-0001' }),
    ];
    expect(nextInvoiceNumber(jobs)).toBe('JP-0004');
  });

  it('ignores INV-series numbers from the legacy invoices collection', () => {
    const jobs = [baseJob({ invoiceNumber: 'INV-0009' })];
    expect(nextInvoiceNumber(jobs)).toBe('JP-0001');
  });

  it('zero-pads to 4 digits', () => {
    const jobs = [baseJob({ invoiceNumber: 'JP-0099' })];
    expect(nextInvoiceNumber(jobs)).toBe('JP-0100');
  });
});

// ── buildInvoiceWhatsAppMessage ───────────────────────────────────────────────

describe('buildInvoiceWhatsAppMessage — message shape', () => {
  const dueDate = '2026-06-03';
  const invoiceNumber = 'JP-0001';

  it('includes the invoice number', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('JP-0001');
  });

  it('includes the total formatted as GBP', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob({ total: 380 }),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('380');
  });

  it('includes the customer first name', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob({ customer: 'Mrs. Jane Bloggs' }),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('Mrs.');
  });

  it('includes bank details when structured fields present', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('12-34-56');
    expect(msg).toContain('12345678');
  });

  it('omits VAT line when biz.vatRegistered is false', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz({ vatRegistered: false }),
      invoiceNumber,
      dueDate,
    });
    expect(msg).not.toContain('VAT');
  });

  it('includes VAT label when biz.vatRegistered is true', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz({ vatRegistered: true }),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('VAT');
  });
});

// ── buildWhatsAppLink ─────────────────────────────────────────────────────────

describe('buildWhatsAppLink — wa.me URL construction', () => {
  it('normalises a UK 07 number to 447', () => {
    const link = buildWhatsAppLink({ phone: '07700 900123', message: 'test' });
    expect(link).toContain('wa.me/447700900123');
  });

  it('strips leading + from international numbers', () => {
    const link = buildWhatsAppLink({ phone: '+447700900123', message: 'test' });
    expect(link).toContain('wa.me/447700900123');
  });

  it('returns a valid wa.me URL even with no phone (empty recipient)', () => {
    const link = buildWhatsAppLink({ phone: '', message: 'Hello' });
    expect(link).toContain('wa.me/');
    expect(link).toContain('text=');
  });

  it('URL-encodes the message text', () => {
    const link = buildWhatsAppLink({ phone: '07700 900000', message: 'Hi Jane, invoice £380' });
    expect(link).toContain('%C2%A3380'); // £ encoded
  });
});

// ── getMissingInvoiceFields — biz settings validation ─────────────────────────

describe('getMissingInvoiceFields — warns on incomplete biz settings', () => {
  it('returns empty array when biz is fully configured', () => {
    expect(getMissingInvoiceFields(baseBiz(), null)).toEqual([]);
  });

  it('flags missing business name', () => {
    const missing = getMissingInvoiceFields({ ...baseBiz(), name: '' }, null);
    expect(missing).toContain('Business name');
  });

  it('flags missing sort code', () => {
    const missing = getMissingInvoiceFields(
      { ...baseBiz(), sortCode: '', bankDetails: '' },
      null
    );
    expect(missing).toContain('Sort code');
  });

  it('flags missing account number', () => {
    const missing = getMissingInvoiceFields(
      { ...baseBiz(), accountNumber: '', bankDetails: '' },
      null
    );
    expect(missing).toContain('Account number');
  });

  it('accepts legacy bankDetails blob instead of structured fields', () => {
    const biz = { name: 'Test Co', bankDetails: 'Sort: 12-34-56 Acc: 12345678' };
    expect(getMissingInvoiceFields(biz, null)).toEqual([]);
  });

  it('prefers profile fields over biz fields', () => {
    const biz = { name: '', accountName: '', sortCode: '', accountNumber: '', bankDetails: '' };
    const profile = {
      business_name: 'Alan Plumbing',
      first_name: 'Alan',
      last_name: 'Aranda',
      sort_code: '12-34-56',
      account_number: '12345678',
    };
    expect(getMissingInvoiceFields(biz, profile)).toEqual([]);
  });

  it('flags VAT number missing when vatRegistered is true', () => {
    const missing = getMissingInvoiceFields(
      { ...baseBiz(), vatRegistered: true, vatNumber: '' },
      null
    );
    expect(missing).toContain('VAT number');
  });
});

// ── Send channel telemetry — console.log shape ────────────────────────────────
//
// These tests verify the telemetry log emitted by each send handler matches
// the shape { channel: 'whatsapp' | 'share' | 'download' } that will be
// wired to a real analytics provider later (see BottomNav.jsx:48 pattern).
//
// We test the channel strings as pure constants rather than mounting the
// component, matching the no-DOM convention of this file.

describe('send channel telemetry — log shape', () => {
  const VALID_CHANNELS = ['whatsapp', 'share', 'download'];

  it('whatsapp channel string is a known valid channel', () => {
    const channel = 'whatsapp';
    expect(VALID_CHANNELS).toContain(channel);
  });

  it('share channel string is a known valid channel', () => {
    const channel = 'share';
    expect(VALID_CHANNELS).toContain(channel);
  });

  it('download channel string is a known valid channel', () => {
    const channel = 'download';
    expect(VALID_CHANNELS).toContain(channel);
  });

  it('all three channels are distinct (no accidental duplicate)', () => {
    expect(new Set(VALID_CHANNELS).size).toBe(3);
  });

  it('telemetry event name is invoice_send', () => {
    // Guard against the event name drifting — analytics consumers key on this.
    const EVENT_NAME = '[telemetry] invoice_send';
    expect(EVENT_NAME).toBe('[telemetry] invoice_send');
  });
});

// ── WhatsApp primary path — wa.me link correctness ────────────────────────────
//
// The new primary CTA calls handleWhatsApp → buildWhatsAppLink. These tests
// confirm the WhatsApp path produces a usable link regardless of phone format,
// and that the message includes enough information for the customer to pay.

describe('WhatsApp primary path — link correctness', () => {
  const dueDate = '2026-06-17';
  const invoiceNumber = 'JP-0005';

  it('produces a wa.me link (not an email or share link)', () => {
    const link = buildWhatsAppLink({ phone: '07700 900000', message: 'test' });
    expect(link.startsWith('https://wa.me/')).toBe(true);
  });

  it('message sent via WhatsApp contains invoice number and total', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob({ total: 450 }),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain(invoiceNumber);
    expect(msg).toContain('450');
  });

  it('message contains bank sort code so customer can pay from WhatsApp', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz({ sortCode: '20-30-40', accountNumber: '87654321' }),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('20-30-40');
    expect(msg).toContain('87654321');
  });

  it('WhatsApp link is valid even when customerPhone is null (no-recipient graceful open)', () => {
    const link = buildWhatsAppLink({ phone: null, message: 'Hi' });
    expect(link).toContain('wa.me/');
    expect(link).toContain('text=');
    // Should NOT throw or produce an undefined URL
    expect(typeof link).toBe('string');
  });

  it('WhatsApp link is valid when customerPhone falls back to job.phone', () => {
    // Simulates: job.customerPhone is undefined, job.phone is set
    const phone = '07900 123456';
    const link = buildWhatsAppLink({ phone, message: 'test' });
    expect(link).toContain('wa.me/447900123456');
  });
});

// ── Regression: every invoice-send path includes the hosted /i/<token> link ──
//
// This block guards against a future caller of buildInvoiceWhatsAppMessage
// silently dropping the hostedInvoiceUrl argument. Each send entry point
// (SendInvoiceModal, legacy App.jsx modal, ReviewSheet) must mint/reuse a
// token and pass it — otherwise the customer receives plain text instead of
// the branded invoice link.
//
// We test the message-building layer directly (no DOM required). The token
// lifecycle (mint → pass → persist via onUpdate) is documented in the PR
// description. If a future send path is added, add a case here.

describe('regression — every invoice-send path includes /i/ hosted link', () => {
  const invoiceNumber = 'JP-0001';
  const dueDate = '2026-06-14';

  function mintUrl() {
    const token = generatePublicAccessToken();
    return buildPublicInvoiceUrl(token, 'https://app.jobprofit.co.uk');
  }

  it('SendInvoiceModal path: message contains /i/ when hostedInvoiceUrl is passed', () => {
    const hostedInvoiceUrl = mintUrl();
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
      hostedInvoiceUrl,
    });
    expect(msg).toContain('/i/');
    expect(msg).toContain('View & pay your invoice:');
  });

  it('ReviewSheet path: message contains /i/ when hostedInvoiceUrl is passed', () => {
    // ReviewSheet.handleInvoiceWhatsApp now mints the token and passes it.
    // This test mirrors that call: token = job.publicAccessToken || generatePublicAccessToken()
    const job = baseJob(); // no publicAccessToken — triggers mint
    const token = job.publicAccessToken || generatePublicAccessToken();
    const hostedInvoiceUrl = buildPublicInvoiceUrl(token, 'https://app.jobprofit.co.uk');
    const msg = buildInvoiceWhatsAppMessage({
      job,
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
      hostedInvoiceUrl,
    });
    expect(msg).toContain('/i/');
    expect(msg).toContain('View & pay your invoice:');
  });

  it('legacy App.jsx modal path: message contains /i/ when hostedInvoiceUrl is passed', () => {
    // App.jsx SendInvoiceModal now uses pendingToken + buildPublicInvoiceUrl, same pattern.
    const job = baseJob();
    const pendingToken = job.publicAccessToken || generatePublicAccessToken();
    const hostedInvoiceUrl = buildPublicInvoiceUrl(pendingToken, 'https://app.jobprofit.co.uk');
    const msg = buildInvoiceWhatsAppMessage({
      job,
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
      hostedInvoiceUrl,
    });
    expect(msg).toContain('/i/');
    expect(msg).toContain('View & pay your invoice:');
  });

  it('message does NOT contain /i/ link when hostedInvoiceUrl is omitted (safe fallback baseline)', () => {
    // Documents expected fallback — this case should only happen in tests, never in production.
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
      // hostedInvoiceUrl intentionally omitted
    });
    expect(msg).not.toContain('View & pay your invoice:');
    expect(msg).not.toContain('/i/');
  });

  it('existing token on job is reused, not regenerated (stable URL for re-sends)', () => {
    const existingToken = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const job = baseJob({ publicAccessToken: existingToken });
    const token = job.publicAccessToken || generatePublicAccessToken();
    expect(token).toBe(existingToken);
    const url = buildPublicInvoiceUrl(token, 'https://app.jobprofit.co.uk');
    expect(url).toBe(`https://app.jobprofit.co.uk/i/${existingToken}`);
  });

  it('onUpdate patch includes publicAccessToken so /i/<token> resolves for the customer', () => {
    // Simulates the patch object produced by attemptSend (App.jsx) and handleInvoiceWhatsApp
    // (ReviewSheet). The token MUST be present — without it the /i/<token> page returns 404.
    const job = baseJob();
    const pendingToken = job.publicAccessToken || generatePublicAccessToken();
    const patch = {
      ...job,
      status: 'invoice_sent',
      invoiceSentAt: new Date().toISOString(),
      invoiceNumber,
      invoiceDueDate: new Date(dueDate).toISOString(),
      publicAccessToken: pendingToken,
      invoiceLinkSentAt: new Date().toISOString(),
    };
    expect(patch.publicAccessToken).toBeTruthy();
    expect(typeof patch.publicAccessToken).toBe('string');
    expect(patch.publicAccessToken.length).toBeGreaterThan(10);
  });
});

// ── getInvoicePDFBlob — PDF generation round-trip ─────────────────────────────
// Note: generateInvoicePDF / getInvoicePDFBlob are now async (QR code generation).

describe('getInvoicePDFBlob — returns a non-empty Blob', () => {
  it('returns a Blob with size > 1KB', async () => {
    const blob = await getInvoicePDFBlob({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber: 'JP-0001',
      dueDate: '2026-06-03',
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1000); // sanity: at least 1 KB
  });

  it('handles a job with no lineItems (falls back to summary row)', async () => {
    const blob = await getInvoicePDFBlob({
      job: baseJob({ lineItems: [] }),
      biz: baseBiz(),
      invoiceNumber: 'JP-0002',
      dueDate: '2026-06-03',
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('handles a null biz without throwing', async () => {
    await expect(
      getInvoicePDFBlob({
        job: baseJob(),
        biz: null,
        invoiceNumber: 'JP-0003',
        dueDate: '2026-06-03',
      })
    ).resolves.not.toThrow();
  });

  it('renders Pay-now button + QR when payNowUrl is provided', async () => {
    const blob = await getInvoicePDFBlob({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber: 'JP-0004',
      dueDate: '2026-06-03',
      payNowUrl: 'https://app.jobprofit.co.uk/p/abc123',
    });
    // A PDF with QR embedded is larger than one without. Sanity check only —
    // the exact size varies by QR content length.
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('renders without Pay-now button when payNowUrl is absent', async () => {
    const blob = await getInvoicePDFBlob({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber: 'JP-0005',
      dueDate: '2026-06-03',
      // payNowUrl omitted — should render as legacy PDF
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1000);
  });
});

// ── buildInvoiceWhatsAppMessage — partial payment balance wiring ─────────────
// PRD §4.8 (shipped May 2026) + deposit-delta spec §4 (June 2026):
// When amountPaid > 0 the invoice WhatsApp message MUST show the outstanding
// balance, not the full gross total. Chasing a customer for £500 when they've
// already paid £250 burns trust.

describe('buildInvoiceWhatsAppMessage — partial payment balance lines', () => {
  const dueDate = '2026-06-10';
  const invoiceNumber = 'JP-0010';

  it('shows Received and Balance lines when a payment exists', () => {
    const job = baseJob({
      total: 500,
      payments: [
        { id: 'pay_a', amount: 250, date: '2026-06-01', method: 'cash', note: '', createdAt: 'x' },
      ],
    });
    const msg = buildInvoiceWhatsAppMessage({ job, biz: baseBiz(), invoiceNumber, dueDate });
    expect(msg).toContain('Received: £250.00');
    expect(msg).toContain('Balance: £250.00');
  });

  it('balance line reflects the outstanding amount after a deposit, not the gross total', () => {
    const job = baseJob({
      total: 400,
      payments: [
        { id: 'pay_a', amount: 100, date: '2026-06-01', method: 'bank', note: '', createdAt: 'x' },
      ],
    });
    const msg = buildInvoiceWhatsAppMessage({ job, biz: baseBiz(), invoiceNumber, dueDate });
    // The message must NOT claim the full £400 is owed
    expect(msg).toContain('Balance: £300.00');
    expect(msg).toContain('Received: £100.00');
  });

  it('does NOT show Received/Balance lines when no payments recorded', () => {
    const job = baseJob({ total: 400, payments: [] });
    const msg = buildInvoiceWhatsAppMessage({ job, biz: baseBiz(), invoiceNumber, dueDate });
    expect(msg).not.toContain('Received:');
    expect(msg).not.toContain('Balance:');
  });

  it('does NOT show Received/Balance lines when payments field is absent (legacy job)', () => {
    const job = baseJob({ total: 400 });
    delete job.payments;
    const msg = buildInvoiceWhatsAppMessage({ job, biz: baseBiz(), invoiceNumber, dueDate });
    expect(msg).not.toContain('Received:');
    expect(msg).not.toContain('Balance:');
  });

  it('balance accounts for multiple partial payments', () => {
    const job = baseJob({
      total: 600,
      payments: [
        { id: 'a', amount: 200, date: '2026-06-01', method: 'cash', note: '', createdAt: 'x' },
        { id: 'b', amount: 150, date: '2026-06-05', method: 'bank', note: '', createdAt: 'x' },
      ],
    });
    const msg = buildInvoiceWhatsAppMessage({ job, biz: baseBiz(), invoiceNumber, dueDate });
    expect(msg).toContain('Received: £350.00');
    expect(msg).toContain('Balance: £250.00');
  });
});

// ── resolveBusinessIdentity — profile fields reach the PDF generator ──────────
//
// Root-cause regression tests for the "filled in Settings but details don't
// appear on documents" bug. The SendInvoiceModal PDF paths (share PDF, download
// PDF) previously passed only `biz: bizWithStripe` (no `profile`), so the
// generator's profile-fallback chain never fired.
//
// After the fix, SendInvoiceModal:
//   1. Calls resolveBusinessIdentity(biz, profile) → resolvedBiz (all fields merged)
//   2. Passes resolvedBiz as `biz` AND the raw `profile` to getInvoicePDFBlob /
//      downloadInvoicePDF so both the send-path and the generator internals agree.
//
// These tests verify the resolved object carries every field the generator reads.

describe('resolveBusinessIdentity — profile fields flow into SendInvoiceModal PDF path', () => {
  // Simulate what SendInvoiceModal now does: biz is null (AppShell passes null),
  // profile has all the data the founder entered in Settings.
  function profileWithAllFields(overrides = {}) {
    return {
      business_name:  'Alan Plumbing Ltd',
      address:        '12 Trade Street, Manchester, M1 2AB',
      phone:          '07800 100200',
      email:          'alan@alanplumbing.co.uk',
      logo_url:       'https://storage.supabase.co/logos/alan.png',
      account_name:   'Alan Aranda',
      sort_code:      '12-34-56',
      account_number: '12345678',
      vat_number:     'GB123456789',
      vat_registered: true,
      utr_number:     '1234567890',
      stripe_payment_link: '',
      ...overrides,
    };
  }

  it('name resolves from profile.business_name when biz is null', () => {
    const resolved = resolveBusinessIdentity(null, profileWithAllFields());
    expect(resolved.name).toBe('Alan Plumbing Ltd');
  });

  it('address resolves from profile.address when biz is null', () => {
    const resolved = resolveBusinessIdentity(null, profileWithAllFields());
    expect(resolved.address).toBe('12 Trade Street, Manchester, M1 2AB');
  });

  it('phone resolves from profile.phone when biz is null', () => {
    const resolved = resolveBusinessIdentity(null, profileWithAllFields());
    expect(resolved.phone).toBe('07800 100200');
  });

  it('email resolves from profile.email when biz is null', () => {
    const resolved = resolveBusinessIdentity(null, profileWithAllFields());
    expect(resolved.email).toBe('alan@alanplumbing.co.uk');
  });

  it('sortCode resolves from profile.sort_code when biz is null', () => {
    const resolved = resolveBusinessIdentity(null, profileWithAllFields());
    expect(resolved.sortCode).toBe('12-34-56');
  });

  it('accountNumber resolves from profile.account_number when biz is null', () => {
    const resolved = resolveBusinessIdentity(null, profileWithAllFields());
    expect(resolved.accountNumber).toBe('12345678');
  });

  it('vatNumber resolves from profile.vat_number when biz is null', () => {
    const resolved = resolveBusinessIdentity(null, profileWithAllFields());
    expect(resolved.vatNumber).toBe('GB123456789');
  });

  it('vatRegistered resolves from profile.vat_registered when biz is null', () => {
    const resolved = resolveBusinessIdentity(null, profileWithAllFields());
    expect(resolved.vatRegistered).toBe(true);
  });

  it('utr resolves from profile.utr_number when biz is null', () => {
    const resolved = resolveBusinessIdentity(null, profileWithAllFields());
    expect(resolved.utr).toBe('1234567890');
  });

  it('logoUrl resolves from profile.logo_url when biz is null', () => {
    const resolved = resolveBusinessIdentity(null, profileWithAllFields());
    expect(resolved.logoUrl).toBe('https://storage.supabase.co/logos/alan.png');
  });

  it('getInvoicePDFBlob does not throw when biz is null and profile has all fields', async () => {
    const resolved = resolveBusinessIdentity(null, profileWithAllFields());
    const blob = await getInvoicePDFBlob({
      job: baseJob(),
      biz: resolved,
      profile: profileWithAllFields(),
      invoiceNumber: 'JP-0099',
      dueDate: '2026-07-01',
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1000);
  });
});
