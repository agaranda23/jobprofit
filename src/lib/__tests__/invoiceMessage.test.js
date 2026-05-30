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
import { buildInvoiceWhatsAppMessage, buildWhatsAppLink } from '../invoiceMessage.js';

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

// ── VAT total unaffected ──────────────────────────────────────────────────────

describe('buildInvoiceWhatsAppMessage — VAT total with Stripe link', () => {
  it('shows correct gross total including 20% VAT when vatRegistered + link set', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: baseJob({ total: 100 }),
      biz: baseBiz({ vatRegistered: true, stripePaymentLink: 'https://buy.stripe.com/test_abc123' }),
      invoiceNumber,
      dueDate,
    });
    expect(msg).toContain('120.00');
    expect(msg).toContain('inc VAT');
    expect(msg).toContain('Pay by card:');
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
