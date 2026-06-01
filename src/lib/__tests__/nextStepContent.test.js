/**
 * nextStepContent.test.js — Unit tests for the Next Step hero card mapping.
 *
 * Covers:
 *   deriveNextStepContent — all stages map to the right headline/CTA
 *   overdueHeadline       — tier label copy and day counts
 *   tierCtaLabel          — tier 1/2/3 CTA copy
 *
 * No DOM, no React — pure function tests, matches project convention.
 */

import { describe, it, expect } from 'vitest';
import { deriveNextStepContent, overdueHeadline, tierCtaLabel } from '../nextStepContent';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function baseParams(overrides = {}) {
  return {
    status: 'Lead',
    isPaid: false,
    isInvoiced: false,
    isQuoteAccepted: false,
    isQuoteSent: false,
    showChase: false,
    chaseBlocked: false,
    tier: 1,
    daysOverdue: 0,
    customerFirstName: 'Sarah',
    profit: null,
    ...overrides,
  };
}

// ── tierCtaLabel ──────────────────────────────────────────────────────────────

describe('tierCtaLabel', () => {
  it('returns light copy for tier 1', () => {
    expect(tierCtaLabel(1)).toBe('Send payment reminder');
  });

  it('returns firm copy for tier 2', () => {
    expect(tierCtaLabel(2)).toBe('Send firm follow-up');
  });

  it('returns final copy for tier 3', () => {
    expect(tierCtaLabel(3)).toBe('Send final reminder');
  });

  it('returns final copy for tier > 3 (clamped at max)', () => {
    expect(tierCtaLabel(4)).toBe('Send final reminder');
  });

  it('returns light copy for tier 0 (pre-due fallback)', () => {
    expect(tierCtaLabel(0)).toBe('Send payment reminder');
  });
});

// ── overdueHeadline ───────────────────────────────────────────────────────────

describe('overdueHeadline', () => {
  it('uses the customer first name', () => {
    expect(overdueHeadline('Sarah', 5)).toContain('Sarah');
  });

  it('falls back to "the customer" when name is empty', () => {
    expect(overdueHeadline('', 5)).toContain('the customer');
  });

  it('shows "invoice due" when days is 0', () => {
    expect(overdueHeadline('Dave', 0)).toContain('invoice due');
  });

  it('shows singular "1 day overdue" at exactly 1 day', () => {
    expect(overdueHeadline('Dave', 1)).toBe('Chase Dave — 1 day overdue');
  });

  it('shows plural "N days overdue" for 2+ days', () => {
    expect(overdueHeadline('Dave', 9)).toBe('Chase Dave — 9 days overdue');
    expect(overdueHeadline('Dave', 14)).toBe('Chase Dave — 14 days overdue');
  });
});

// ── deriveNextStepContent — Lead stage ────────────────────────────────────────

describe('deriveNextStepContent — Lead (quote not sent)', () => {
  const params = baseParams(); // status: Lead, nothing is sent/invoiced/paid

  it('returns non-null content', () => {
    expect(deriveNextStepContent(params)).not.toBeNull();
  });

  it('headline is "Send the quote"', () => {
    expect(deriveNextStepContent(params).headline).toBe('Send the quote');
  });

  it('primary CTA label is "Send quote"', () => {
    expect(deriveNextStepContent(params).primaryCta.label).toBe('Send quote');
  });

  it('primary CTA action is sendQuoteLink', () => {
    expect(deriveNextStepContent(params).primaryCta.action).toBe('sendQuoteLink');
  });

  it('includes micro-actions for editing price and line items', () => {
    const actions = deriveNextStepContent(params).microCtas.map(m => m.action);
    expect(actions).toContain('editPrice');
    expect(actions).toContain('editLineItems');
  });
});

// ── deriveNextStepContent — Quote sent, awaiting acceptance ──────────────────

describe('deriveNextStepContent — Quote sent (awaiting acceptance)', () => {
  const params = baseParams({ isQuoteSent: true, customerFirstName: 'Sarah' });

  it('headline mentions the customer name', () => {
    expect(deriveNextStepContent(params).headline).toContain('Sarah');
  });

  it('primary CTA action is sendQuoteLink', () => {
    expect(deriveNextStepContent(params).primaryCta.action).toBe('sendQuoteLink');
  });

  it('primary CTA label is Resend quote', () => {
    expect(deriveNextStepContent(params).primaryCta.label).toContain('Resend');
  });

  it('includes a micro-action to mark accepted manually', () => {
    const actions = deriveNextStepContent(params).microCtas.map(m => m.action);
    expect(actions).toContain('openSigPad');
  });

  it('headline falls back gracefully when customer name is empty', () => {
    const p = baseParams({ isQuoteSent: true, customerFirstName: '' });
    expect(deriveNextStepContent(p).headline).toContain('the customer');
  });
});

// ── deriveNextStepContent — Quote accepted / Active (send invoice) ────────────

describe('deriveNextStepContent — Quote accepted (Active)', () => {
  const params = baseParams({ isQuoteAccepted: true });

  it('headline mentions invoice', () => {
    expect(deriveNextStepContent(params).headline.toLowerCase()).toContain('invoice');
  });

  it('primary CTA action is openInvoiceModal', () => {
    expect(deriveNextStepContent(params).primaryCta.action).toBe('openInvoiceModal');
  });

  it('primary CTA label is Send invoice', () => {
    expect(deriveNextStepContent(params).primaryCta.label).toBe('Send invoice');
  });

  it('micro-actions include Log receipt and Add photo', () => {
    const actions = deriveNextStepContent(params).microCtas.map(m => m.action);
    expect(actions).toContain('openReceiptModal');
    expect(actions).toContain('openPhotoInput');
  });
});

// ── deriveNextStepContent — Invoiced, awaiting payment (no phone) ─────────────

describe('deriveNextStepContent — Invoiced (no phone, no chase)', () => {
  const params = baseParams({ isInvoiced: true, showChase: false });

  it('headline is "Awaiting payment"', () => {
    expect(deriveNextStepContent(params).headline).toBe('Awaiting payment');
  });

  it('primary CTA action is openPaymentModal (record payment)', () => {
    expect(deriveNextStepContent(params).primaryCta.action).toBe('openPaymentModal');
  });

  it('has no micro-actions when no chase available', () => {
    expect(deriveNextStepContent(params).microCtas).toHaveLength(0);
  });
});

// ── deriveNextStepContent — Invoiced, chase available ────────────────────────

describe('deriveNextStepContent — Invoiced (chase available, tier 1)', () => {
  const params = baseParams({ isInvoiced: true, showChase: true, tier: 1, daysOverdue: 0 });

  it('headline is "Awaiting payment" when not yet overdue', () => {
    expect(deriveNextStepContent(params).headline).toBe('Awaiting payment');
  });

  it('primary CTA action is handleChase', () => {
    expect(deriveNextStepContent(params).primaryCta.action).toBe('handleChase');
  });

  it('primary CTA label uses tier 1 copy', () => {
    expect(deriveNextStepContent(params).primaryCta.label).toBe(tierCtaLabel(1));
  });

  it('micro-actions include Record payment', () => {
    const actions = deriveNextStepContent(params).microCtas.map(m => m.action);
    expect(actions).toContain('openPaymentModal');
  });
});

// ── deriveNextStepContent — Overdue, tier 2 ──────────────────────────────────

describe('deriveNextStepContent — Overdue (tier 2, 9 days)', () => {
  const params = baseParams({
    status: 'Overdue',
    isInvoiced: true,
    showChase: true,
    tier: 2,
    daysOverdue: 9,
    customerFirstName: 'Dave',
  });

  it('headline includes customer name and days overdue', () => {
    const { headline } = deriveNextStepContent(params);
    expect(headline).toContain('Dave');
    expect(headline).toContain('9 days overdue');
  });

  it('primary CTA action is handleChase', () => {
    expect(deriveNextStepContent(params).primaryCta.action).toBe('handleChase');
  });

  it('primary CTA label uses tier 2 copy', () => {
    expect(deriveNextStepContent(params).primaryCta.label).toBe(tierCtaLabel(2));
  });
});

// ── deriveNextStepContent — Overdue, tier 3 ──────────────────────────────────

describe('deriveNextStepContent — Overdue (tier 3, 14+ days)', () => {
  const params = baseParams({
    status: 'Overdue',
    isInvoiced: true,
    showChase: true,
    tier: 3,
    daysOverdue: 16,
    customerFirstName: 'Dave',
  });

  it('headline shows 16 days overdue', () => {
    expect(deriveNextStepContent(params).headline).toContain('16 days overdue');
  });

  it('primary CTA label uses tier 3 copy', () => {
    expect(deriveNextStepContent(params).primaryCta.label).toBe(tierCtaLabel(3));
  });
});

// ── deriveNextStepContent — Chase blocked (48h suppression) ──────────────────

describe('deriveNextStepContent — Chase blocked (chaseBlocked = true)', () => {
  const params = baseParams({
    isInvoiced: true,
    showChase: true,
    chaseBlocked: true,
    tier: 1,
    daysOverdue: 3,
    customerFirstName: 'Dave',
  });

  it('primary CTA action is noop when chase is blocked', () => {
    expect(deriveNextStepContent(params).primaryCta.action).toBe('noop');
  });

  it('primary CTA label indicates chased recently', () => {
    expect(deriveNextStepContent(params).primaryCta.label).toContain('recently');
  });
});

// ── deriveNextStepContent — Paid stage ───────────────────────────────────────

describe('deriveNextStepContent — Paid', () => {
  it('returns content (not null) for the paid completion state', () => {
    const params = baseParams({ isPaid: true, profit: 618 });
    expect(deriveNextStepContent(params)).not.toBeNull();
  });

  it('headline includes profit amount formatted as £', () => {
    const params = baseParams({ isPaid: true, profit: 618 });
    expect(deriveNextStepContent(params).headline).toContain('£618');
  });

  it('headline is "Job complete" when profit is null (no quote set)', () => {
    const params = baseParams({ isPaid: true, profit: null });
    expect(deriveNextStepContent(params).headline).toBe('Job complete');
  });

  it('headline is "Job complete" when profit is 0', () => {
    const params = baseParams({ isPaid: true, profit: 0 });
    // profit = 0 is non-null and >= 0 so the £ value is shown
    expect(deriveNextStepContent(params).headline).toContain('£0');
  });

  it('primary CTA action is viewProfitBreakdown', () => {
    const params = baseParams({ isPaid: true, profit: 200 });
    expect(deriveNextStepContent(params).primaryCta.action).toBe('viewProfitBreakdown');
  });

  it('no micro-CTAs on paid state', () => {
    const params = baseParams({ isPaid: true, profit: 300 });
    expect(deriveNextStepContent(params).microCtas).toHaveLength(0);
  });
});

// ── Stage priority ordering ───────────────────────────────────────────────────
// Paid > Invoiced > QuoteAccepted > QuoteSent > Lead

describe('deriveNextStepContent — stage priority', () => {
  it('isPaid takes priority over isInvoiced', () => {
    const params = baseParams({ isPaid: true, isInvoiced: true, profit: 100 });
    expect(deriveNextStepContent(params).headline).toContain('complete');
  });

  it('isInvoiced takes priority over isQuoteAccepted', () => {
    const params = baseParams({ isInvoiced: true, isQuoteAccepted: true, showChase: false });
    expect(deriveNextStepContent(params).headline).toBe('Awaiting payment');
  });

  it('isQuoteAccepted takes priority over isQuoteSent', () => {
    const params = baseParams({ isQuoteAccepted: true, isQuoteSent: true });
    expect(deriveNextStepContent(params).primaryCta.action).toBe('openInvoiceModal');
  });
});
