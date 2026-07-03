/**
 * invoiceMessage.js — tests for Stripe Pay-by-Link additions.
 *
 * No DOM, no React — pure-logic convention matching this repo.
 * Visual placement is covered by the deploy-preview checklist in the PR.
 *
 * Covers:
 *   - Pay-by-card line present / absent based on stripePaymentLink
 *   - Bank header relabelled "Or by bank transfer:" when link is set
 *   - Bank header stays "Bank details:" when no link is set
 *   - Correct order: card block appears BEFORE bank block
 *   - VAT total still correct with link present
 *   - Phone normalisation unaffected by link presence
 *   - Reads stripe link from biz.stripePaymentLink (camelCase, legacy biz object)
 *   - Reads stripe link from biz.stripe_payment_link (snake_case, profile-merged biz)
 *   - Null/empty link produces identical output to the pre-feature baseline
 */

import { describe, it, expect } from 'vitest';
import { buildInvoiceWhatsAppMessage, buildWhatsAppLink, buildReviewRequestWhatsAppMessage } from '../invoiceMessage.js';

function baseJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Mrs. Jane Bloggs',
    summary: 'Replace kitchen taps',
    total: 380,
    ...overrides,
  };
}

function baseBiz(overrides = {}) {
  return {
    name: 'Alan Plumbing Ltd',
    accountName: 'Alan Aranda',
    sortCode: '12-34-56',
    accountNumber: '12345678',
    vatRegistered: false,
    ...overrides,
  };
}

const invoiceNumber = 'JP-0001';
const dueDate = '2026-06-14';

// ── Pay-by-card line — present / absent ──────────────────────────────────────

describe('buildInvoiceWhatsAppMessage — Pay-by-card line', () => {
  it('includes a pay-by-card line when biz.stripePaymentLink is set', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz({ stripePaymentLink: 'https://buy.stripe.com/test_abc123' }),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('Pay by card:');
    expect(msg).toContain('https://buy.stripe.com/test_abc123');
  });

  it('includes a pay-by-card line when biz.stripe_payment_link (snake_case) is set', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz({ stripe_payment_link: 'https://buy.stripe.com/test_xyz789' }),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('Pay by card:');
    expect(msg).toContain('https://buy.stripe.com/test_xyz789');
  });

  it('omits pay-by-card line when stripePaymentLink is empty string', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz({ stripePaymentLink: '' }),
      invoiceNumber,
      dueDate,
    });
    expect(msg).not.toContain('Pay by card:');
  });

  it('omits pay-by-card line when stripePaymentLink is absent', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
    });
    expect(msg).not.toContain('Pay by card:');
  });

  it('omits pay-by-card line when biz is null', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: null,
      invoiceNumber,
      dueDate,
    });
    expect(msg).not.toContain('Pay by card:');
  });
});

// ── Bank header relabelling ───────────────────────────────────────────────────

describe('buildInvoiceWhatsAppMessage — bank header relabelling', () => {
  it('uses "Or by bank transfer:" when Stripe link is set', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz({ stripePaymentLink: 'https://buy.stripe.com/test_abc123' }),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('Or by bank transfer:');
    expect(msg).not.toContain('Bank details:');
  });

  it('uses "Bank details:" when no Stripe link is set', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('Bank details:');
    expect(msg).not.toContain('Or by bank transfer:');
  });

  it('uses "Bank details:" when Stripe link is null', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz({ stripePaymentLink: null }),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('Bank details:');
  });
});

// ── Ordering — card link appears before bank details ─────────────────────────

describe('buildInvoiceWhatsAppMessage — ordering', () => {
  it('card link appears before bank sort code in the message', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz({ stripePaymentLink: 'https://buy.stripe.com/test_abc123' }),
      invoiceNumber,
      dueDate,
    });
    const cardPos = msg.indexOf('Pay by card:');
    const bankPos = msg.indexOf('12-34-56');
    expect(cardPos).toBeGreaterThan(-1);
    expect(bankPos).toBeGreaterThan(-1);
    expect(cardPos).toBeLessThan(bankPos);
  });
});

// ── VAT — prices are VAT-inclusive (gross) ────────────────────────────────────
// Decision: ACC, 2026-06-21. The trader enters a VAT-inclusive price.
// The invoice message shows that gross price — it does NOT add VAT on top.

describe('buildInvoiceWhatsAppMessage — VAT-inclusive price display', () => {
  it('shows the entered price (gross-inclusive) when vatRegistered + Stripe link set', () => {
    // total: 120 is VAT-inclusive (£100 net + £20 VAT). Message shows 120.00, not 144.00.
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob({ total: 120 }),
      biz: baseBiz({ vatRegistered: true, stripePaymentLink: 'https://buy.stripe.com/test_abc123' }),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('120.00');
    expect(msg).toContain('inc VAT');
    expect(msg).toContain('Pay by card:');
  });

  it('does NOT inflate the entered price by adding VAT on top (regression guard)', () => {
    // total: 100. Old bug: showed 120.00 (100 + 20%). Correct: shows 100.00.
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob({ total: 100 }),
      biz: baseBiz({ vatRegistered: true }),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('100.00');
    expect(msg).not.toContain('120.00');
    expect(msg).toContain('inc VAT');
  });
});

// ── Legacy bankDetails blob with Stripe link ──────────────────────────────────

describe('buildInvoiceWhatsAppMessage — legacy bankDetails blob + Stripe link', () => {
  it('uses "Or by bank transfer:" with the blob when Stripe link is set', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: {
        name: 'Alan Plumbing',
        bankDetails: 'Sort: 12-34-56 / Acc: 12345678',
        stripePaymentLink: 'https://buy.stripe.com/test_abc123',
      },
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('Pay by card:');
    expect(msg).toContain('Or by bank transfer:');
    expect(msg).toContain('Sort: 12-34-56 / Acc: 12345678');
  });
});

// ── Phone normalisation unaffected ───────────────────────────────────────────

describe('buildWhatsAppLink — phone normalisation unaffected by Stripe link', () => {
  it('still normalises 07 UK numbers when the message contains a Stripe link', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz({ stripePaymentLink: 'https://buy.stripe.com/test_abc123' }),
      invoiceNumber,
      dueDate,
    });
    const link = buildWhatsAppLink({ phone: '07700 900123', message: msg });
    expect(link).toContain('wa.me/447700900123');
  });
});

// ── hostedInvoiceUrl — hosted invoice link in the WhatsApp message ────────────

const HOSTED_URL = 'https://app.jobprofit.co.uk/i/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('buildInvoiceWhatsAppMessage — hostedInvoiceUrl', () => {
  it('includes "View & pay your invoice:" with the URL when hostedInvoiceUrl is set', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
      hostedInvoiceUrl: HOSTED_URL,
    });
    expect(msg).toContain('View & pay your invoice:');
    expect(msg).toContain(HOSTED_URL);
  });

  it('hosted invoice link appears before the invoice number line', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
      hostedInvoiceUrl: HOSTED_URL,
    });
    const linkPos    = msg.indexOf(HOSTED_URL);
    const invNumPos  = msg.indexOf(invoiceNumber);
    expect(linkPos).toBeGreaterThan(-1);
    expect(invNumPos).toBeGreaterThan(-1);
    expect(linkPos).toBeLessThan(invNumPos);
  });

  it('omits "View & pay" line when hostedInvoiceUrl is absent', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
    });
    expect(msg).not.toContain('View & pay your invoice:');
  });

  it('omits "View & pay" line when hostedInvoiceUrl is empty string', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
      hostedInvoiceUrl: '',
    });
    expect(msg).not.toContain('View & pay your invoice:');
  });

  it('does not include the static Stripe link when hostedInvoiceUrl is set (avoid duplicate CTAs)', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz({ stripePaymentLink: 'https://buy.stripe.com/test_abc123' }),
      invoiceNumber,
      dueDate,
      hostedInvoiceUrl: HOSTED_URL,
    });
    // The static Stripe link should not be a separate CTA when hostedInvoiceUrl is present
    expect(msg).not.toContain('Pay by card: https://buy.stripe.com/test_abc123');
  });

  it('uses "Or by bank transfer:" header when hostedInvoiceUrl is set (card CTA already present)', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
      hostedInvoiceUrl: HOSTED_URL,
    });
    expect(msg).toContain('Or by bank transfer:');
    expect(msg).not.toContain('Bank details:');
  });

  it('still includes invoice amount in the message when hostedInvoiceUrl is set', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob({ total: 500 }),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
      hostedInvoiceUrl: HOSTED_URL,
    });
    expect(msg).toContain('500.00');
  });

  it('shows the entered gross price (not inflated) when vatRegistered and hostedInvoiceUrl is set', () => {
    // total: 120 is the VAT-inclusive price. Message shows 120.00, not 144.00.
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob({ total: 120 }),
      biz: baseBiz({ vatRegistered: true }),
      invoiceNumber,
      dueDate,
      hostedInvoiceUrl: HOSTED_URL,
    });
    expect(msg).toContain('120.00');
    expect(msg).toContain(HOSTED_URL);
  });
});

// ── Warmer-tone pass (2026-07-03) ─────────────────────────────────────────────

describe('buildInvoiceWhatsAppMessage — warmer tone + Reference line', () => {
  it('uses a warm first-name greeting', () => {
    const msg = buildInvoiceWhatsAppMessage({ job: baseJob(), biz: baseBiz(), invoiceNumber, dueDate });
    expect(msg).toContain('Hi Mrs. 👋');
  });

  it('includes the combined Invoice/Job/Amount due/Due summary line', () => {
    const msg = buildInvoiceWhatsAppMessage({ job: baseJob({ total: 200 }), biz: baseBiz(), invoiceNumber, dueDate });
    expect(msg).toContain(`Invoice: ${invoiceNumber} · Job: Replace kitchen taps · Amount due: £200.00 · Due:`);
  });

  it('uses "Reference:" (not "Ref:") for the invoice reference line', () => {
    const msg = buildInvoiceWhatsAppMessage({ job: baseJob(), biz: baseBiz(), invoiceNumber, dueDate });
    expect(msg).toContain(`Reference: ${invoiceNumber}`);
  });

  it('still shows the Received/Balance partial-payment block when a deposit was paid', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob({ total: 380, payments: [{ amount: 100 }] }),
      biz: baseBiz(),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('Received: £100.00');
    expect(msg).toContain('Balance: £280.00');
  });
});

// ── buildReviewRequestWhatsAppMessage — post-paid review ask ──────────────────

describe('buildReviewRequestWhatsAppMessage', () => {
  it('includes a warm first-name greeting', () => {
    const msg = buildReviewRequestWhatsAppMessage({
      job: { customer: 'Sarah Jones' },
      biz: { google_review_link: 'https://g.page/r/abc123' },
    });
    expect(msg).toContain('Hi Sarah 👋');
  });

  it('falls back to a generic greeting when there is no customer name', () => {
    const msg = buildReviewRequestWhatsAppMessage({ job: {}, biz: { google_review_link: 'https://g.page/r/abc123' } });
    expect(msg).toContain('Hi 👋');
  });

  it('thanks the customer for their payment', () => {
    const msg = buildReviewRequestWhatsAppMessage({
      job: { customer: 'Sarah' },
      biz: { google_review_link: 'https://g.page/r/abc123' },
    });
    expect(msg).toContain('Thanks so much for your payment');
  });

  it('includes the review link with a star marker when google_review_link is set', () => {
    const msg = buildReviewRequestWhatsAppMessage({
      job: { customer: 'Sarah' },
      biz: { google_review_link: 'https://g.page/r/abc123' },
    });
    expect(msg).toContain('⭐ https://g.page/r/abc123');
  });

  it('omits the review-link line entirely when no review link is configured (no broken/blank link shipped)', () => {
    const msg = buildReviewRequestWhatsAppMessage({ job: { customer: 'Sarah' }, biz: {} });
    expect(msg).not.toContain('⭐');
    expect(msg).not.toContain('undefined');
  });

  it('includes the business name in the sign-off when present', () => {
    const msg = buildReviewRequestWhatsAppMessage({
      job: { customer: 'Sarah' },
      biz: { google_review_link: 'https://g.page/r/abc123', name: 'Alan Plumbing Ltd' },
    });
    expect(msg).toContain('Alan Plumbing Ltd');
  });

  it('omits a dangling blank sign-off line when no business name is set', () => {
    const msg = buildReviewRequestWhatsAppMessage({ job: { customer: 'Sarah' }, biz: { google_review_link: 'https://g.page/r/abc123' } });
    const lines = msg.split('\n');
    expect(lines[lines.length - 1]).not.toBe('');
  });
});
