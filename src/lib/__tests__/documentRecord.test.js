// Unit tests for documentRecord.js
// Covers every state of buildQuoteRecordMeta and buildInvoiceRecordMeta,
// and ports the resolveSignedLabel audit-line cases from publicQuoteViewG2.test.js
// to confirm the signed-state detection is consistent.
//
// No DOM, no React, no Supabase — pure function tests.

import { buildQuoteRecordMeta, buildInvoiceRecordMeta } from '../documentRecord.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Returns a YYYY-MM-DD string for today ± n days (local tz to avoid UTC drift)
function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── buildQuoteRecordMeta ─────────────────────────────────────────────────────

describe('buildQuoteRecordMeta', () => {
  // ── None state ──────────────────────────────────────────────────────────────

  it('returns none state when job is null', () => {
    const r = buildQuoteRecordMeta(null);
    expect(r.state).toBe('none');
    expect(r.metaString).toBe('None yet');
    expect(r.chipLabel).toBe('');
    expect(r.chipClass).toBe('');
  });

  it('returns none state when job is empty object', () => {
    const r = buildQuoteRecordMeta({});
    expect(r.state).toBe('none');
    expect(r.metaString).toBe('None yet');
    expect(r.chipLabel).toBe('');
  });

  it('returns none state when job has no content and no quoteSentAt', () => {
    const r = buildQuoteRecordMeta({ customer: 'Bob', status: 'Lead' });
    expect(r.state).toBe('none');
  });

  // ── Draft state ─────────────────────────────────────────────────────────────

  it('returns draft state when job has lineItems but no quoteSentAt', () => {
    const job = { lineItems: [{ desc: 'Labour', cost: 200 }] };
    const r = buildQuoteRecordMeta(job);
    expect(r.state).toBe('draft');
    expect(r.metaString).toBe('Not sent');
    expect(r.chipLabel).toBe('Draft');
    expect(r.chipClass).toBe('muted');
  });

  it('returns draft state when job has non-zero total but no quoteSentAt', () => {
    const r = buildQuoteRecordMeta({ total: 1500 });
    expect(r.state).toBe('draft');
    expect(r.chipLabel).toBe('Draft');
  });

  it('returns draft state when job has non-zero amount but no quoteSentAt', () => {
    const r = buildQuoteRecordMeta({ amount: 800 });
    expect(r.state).toBe('draft');
    expect(r.chipLabel).toBe('Draft');
  });

  // ── Sent state ──────────────────────────────────────────────────────────────

  it('returns sent state when quoteSentAt is set and not opened', () => {
    const r = buildQuoteRecordMeta({ quoteSentAt: '2026-06-01T10:00:00Z', total: 1000 });
    expect(r.state).toBe('sent');
    expect(r.chipLabel).toBe('Sent');
    expect(r.chipClass).toBe('neutral');
    expect(r.metaString).toMatch(/^Sent \d/);
  });

  it('sent metaString contains the formatted date', () => {
    const r = buildQuoteRecordMeta({ quoteSentAt: '2026-06-01T00:00:00Z' });
    expect(r.metaString).toContain('Jun');
  });

  // ── Opened state ────────────────────────────────────────────────────────────

  it('returns opened state when quoteLinkOpenedAt is set and not accepted', () => {
    const job = {
      quoteSentAt: '2026-06-01T10:00:00Z',
      quoteLinkOpenedAt: '2026-06-02T09:00:00Z',
    };
    const r = buildQuoteRecordMeta(job);
    expect(r.state).toBe('opened');
    expect(r.chipLabel).toBe('Opened');
    expect(r.chipClass).toBe('neutral');
    expect(r.metaString).toMatch(/^Opened/);
  });

  it('opened wins over sent (furthest state)', () => {
    const job = {
      quoteSentAt: '2026-06-01T00:00:00Z',
      quoteLinkOpenedAt: '2026-06-03T00:00:00Z',
    };
    expect(buildQuoteRecordMeta(job).state).toBe('opened');
  });

  // ── Signed state ────────────────────────────────────────────────────────────

  it('returns signed state when acceptedAt is set', () => {
    const job = {
      quoteSentAt: '2026-06-01T00:00:00Z',
      quoteLinkOpenedAt: '2026-06-02T00:00:00Z',
      acceptedAt: '2026-06-03T14:00:00Z',
    };
    const r = buildQuoteRecordMeta(job);
    expect(r.state).toBe('signed');
    expect(r.chipLabel).toBe('Signed');
    expect(r.chipClass).toBe('green');
    expect(r.metaString).toMatch(/^Signed/);
  });

  it('returns signed state when quoteStatus is accepted (even without acceptedAt)', () => {
    const r = buildQuoteRecordMeta({ quoteStatus: 'accepted' });
    expect(r.state).toBe('signed');
    expect(r.chipLabel).toBe('Signed');
  });

  it('signed wins over opened (furthest state)', () => {
    const job = {
      quoteLinkOpenedAt: '2026-06-02T00:00:00Z',
      acceptedAt: '2026-06-03T00:00:00Z',
    };
    expect(buildQuoteRecordMeta(job).state).toBe('signed');
  });

  it('signed wins over draft', () => {
    const job = { lineItems: [{ desc: 'Fit', cost: 400 }], acceptedAt: '2026-06-03T00:00:00Z' };
    expect(buildQuoteRecordMeta(job).state).toBe('signed');
  });

  // ── resolveSignedLabel parity (ported from publicQuoteViewG2.test.js) ───────
  // These verify that our signed-state detection matches the cases that the
  // accept-quote function and public quote page rely on.

  it('[parity] detects Phase F path (acceptedSignature only, no acceptedSource)', () => {
    const job = { acceptedSignature: 'data:image/png;base64,...' };
    // Phase F: no acceptedAt, no quoteStatus — should NOT be signed
    expect(buildQuoteRecordMeta(job).state).not.toBe('signed');
  });

  it('[parity] detects signed when acceptedSource is remote and acceptedAt present', () => {
    const job = { acceptedSource: 'remote', acceptedAt: '2026-06-04T00:00:00Z', acceptedName: 'Jane Smith' };
    expect(buildQuoteRecordMeta(job).state).toBe('signed');
  });

  it('[parity] detects signed when acceptedSource is deposit_payment and acceptedAt present', () => {
    const job = { acceptedSource: 'deposit_payment', acceptedAt: '2026-06-04T00:00:00Z' };
    expect(buildQuoteRecordMeta(job).state).toBe('signed');
  });
});

// ── buildInvoiceRecordMeta ───────────────────────────────────────────────────

describe('buildInvoiceRecordMeta', () => {
  // ── None state ──────────────────────────────────────────────────────────────

  it('returns none when job is null', () => {
    const r = buildInvoiceRecordMeta(null);
    expect(r.state).toBe('none');
    expect(r.metaString).toBe('None yet');
    expect(r.chipLabel).toBe('');
  });

  it('returns none when job has no invoiceSentAt', () => {
    const r = buildInvoiceRecordMeta({ status: 'Invoiced', amount: 1000 });
    expect(r.state).toBe('none');
    expect(r.metaString).toBe('None yet');
  });

  // ── Sent state ──────────────────────────────────────────────────────────────

  it('returns sent state when invoiceSentAt set and no due date or payment', () => {
    const r = buildInvoiceRecordMeta({ invoiceSentAt: '2026-06-01T10:00:00Z' });
    expect(r.state).toBe('sent');
    expect(r.chipLabel).toBe('Sent');
    expect(r.chipClass).toBe('neutral');
    expect(r.metaString).toMatch(/^Sent/);
  });

  it('sent metaString contains the formatted date', () => {
    const r = buildInvoiceRecordMeta({ invoiceSentAt: '2026-06-01T00:00:00Z' });
    expect(r.metaString).toContain('Jun');
  });

  it('returns sent when invoiceDueDate is well in the future (>3 days)', () => {
    const r = buildInvoiceRecordMeta({
      invoiceSentAt: '2026-06-01T00:00:00Z',
      invoiceDueDate: localDate(10),
    });
    expect(r.state).toBe('sent');
  });

  // ── Due state ───────────────────────────────────────────────────────────────

  it('returns due state when invoiceDueDate is today', () => {
    const r = buildInvoiceRecordMeta({
      invoiceSentAt: '2026-06-01T00:00:00Z',
      invoiceDueDate: localDate(0),
    });
    expect(r.state).toBe('due');
    expect(r.chipLabel).toBe('Due');
    expect(r.chipClass).toBe('amber');
    expect(r.metaString).toMatch(/^Due/);
  });

  it('returns due when invoiceDueDate is 3 days away', () => {
    const r = buildInvoiceRecordMeta({
      invoiceSentAt: '2026-06-01T00:00:00Z',
      invoiceDueDate: localDate(3),
    });
    expect(r.state).toBe('due');
    expect(r.chipLabel).toBe('Due');
  });

  it('returns sent (not due) when invoiceDueDate is 4 days away', () => {
    const r = buildInvoiceRecordMeta({
      invoiceSentAt: '2026-06-01T00:00:00Z',
      invoiceDueDate: localDate(4),
    });
    expect(r.state).toBe('sent');
  });

  // ── Overdue state ───────────────────────────────────────────────────────────

  it('returns overdue state when invoiceDueDate is in the past', () => {
    const r = buildInvoiceRecordMeta({
      invoiceSentAt: '2026-05-01T00:00:00Z',
      invoiceDueDate: localDate(-5),
    });
    expect(r.state).toBe('overdue');
    expect(r.chipLabel).toBe('Overdue');
    expect(r.chipClass).toBe('rose');
    expect(r.metaString).toBe('Overdue · 5d');
  });

  it('overdue metaString shows correct day count', () => {
    const r = buildInvoiceRecordMeta({
      invoiceSentAt: '2026-05-01T00:00:00Z',
      invoiceDueDate: localDate(-14),
    });
    expect(r.metaString).toBe('Overdue · 14d');
  });

  // ── Part-paid state ─────────────────────────────────────────────────────────
  // shouldShowPartPaidChip requires stage Invoiced/Overdue, partial payment > 0, balance > 0

  it('returns part-paid state for Invoiced job with partial payments', () => {
    // status:'invoice_sent' → deriveDisplayStatus returns 'Invoiced'.
    // computeBalance uses job.amount; must be set for the balance check to be positive.
    const job = {
      invoiceSentAt: '2026-06-01T00:00:00Z',
      status: 'invoice_sent',
      total: 1000,
      amount: 1000,
      payments: [{ id: 'p1', amount: 300, date: '2026-06-05', method: 'cash' }],
    };
    const r = buildInvoiceRecordMeta(job);
    expect(r.state).toBe('part-paid');
    expect(r.chipLabel).toBe('Part paid');
    expect(r.chipClass).toBe('amber');
    expect(r.metaString).toContain('%');
    expect(r.metaString).toContain('left');
  });

  it('returns part-paid state for Overdue job with partial payments', () => {
    // status:'invoice_sent' + overdue:true → deriveDisplayStatus returns 'Overdue'.
    // computeBalance uses job.amount; must be set for the balance check to be positive.
    const job = {
      invoiceSentAt: '2026-05-01T00:00:00Z',
      invoiceDueDate: localDate(-10),
      status: 'invoice_sent',
      overdue: true,
      total: 500,
      amount: 500,
      payments: [{ id: 'p1', amount: 100, date: '2026-06-01', method: 'bank' }],
    };
    const r = buildInvoiceRecordMeta(job);
    expect(r.state).toBe('part-paid');
    expect(r.chipLabel).toBe('Part paid');
  });

  it('does NOT return part-paid for a Lead-stage job', () => {
    // status:'lead' → deriveDisplayStatus returns 'Lead' (not in AWAITING_PAYMENT_STAGES)
    const job = {
      invoiceSentAt: '2026-06-01T00:00:00Z',
      status: 'lead',
      total: 1000,
      amount: 1000,
      payments: [{ id: 'p1', amount: 300, date: '2026-06-05', method: 'cash' }],
    };
    const r = buildInvoiceRecordMeta(job);
    expect(r.state).not.toBe('part-paid');
  });

  // ── Paid state ──────────────────────────────────────────────────────────────

  it('returns paid state when paymentStatus is paid', () => {
    const r = buildInvoiceRecordMeta({
      invoiceSentAt: '2026-06-01T00:00:00Z',
      paymentStatus: 'paid',
    });
    expect(r.state).toBe('paid');
    expect(r.chipLabel).toBe('Paid');
    expect(r.chipClass).toBe('green');
  });

  it('returns paid state when paidAt is set', () => {
    const r = buildInvoiceRecordMeta({
      invoiceSentAt: '2026-06-01T00:00:00Z',
      paidAt: '2026-06-10T09:00:00Z',
    });
    expect(r.state).toBe('paid');
    expect(r.chipLabel).toBe('Paid');
    expect(r.metaString).toMatch(/^Paid/);
  });

  it('paid wins over overdue (paid is highest priority)', () => {
    const r = buildInvoiceRecordMeta({
      invoiceSentAt: '2026-05-01T00:00:00Z',
      invoiceDueDate: localDate(-7),
      paymentStatus: 'paid',
      paidAt: '2026-06-08T00:00:00Z',
    });
    expect(r.state).toBe('paid');
  });

  it('paid wins over part-paid', () => {
    const job = {
      invoiceSentAt: '2026-06-01T00:00:00Z',
      status: 'Invoiced',
      total: 1000,
      payments: [{ id: 'p1', amount: 300, date: '2026-06-05', method: 'cash' }],
      paymentStatus: 'paid',
      paidAt: '2026-06-09T00:00:00Z',
    };
    expect(buildInvoiceRecordMeta(job).state).toBe('paid');
  });
});
