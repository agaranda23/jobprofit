/**
 * Tests for quoteMessage.js — buildQuoteWhatsAppMessage.
 *
 * Pure logic, no DOM, no React. Follows the project convention of
 * extracting helper logic and testing it in isolation.
 */

import { describe, it, expect } from 'vitest';
import { buildQuoteWhatsAppMessage } from '../quoteMessage';

const QUOTE_URL = 'https://jobprofit.app/quote/tok_abc123';

// ── buildQuoteWhatsAppMessage ─────────────────────────────────────────────

describe('buildQuoteWhatsAppMessage', () => {
  it('includes the customer first name as a greeting', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan Smith', total: 500 },
      biz: { name: 'A Plumbing Co' },
      quoteUrl: QUOTE_URL,
    });
    expect(msg).toContain('Hi Alan,');
  });

  it('uses only the first name even when full name is provided', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Bob Jones-Williams', total: 200 },
      biz: {},
      quoteUrl: QUOTE_URL,
    });
    expect(msg).toContain('Hi Bob,');
    expect(msg).not.toContain('Jones');
  });

  it('falls back to generic greeting when no customer name', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { total: 100 },
      biz: {},
      quoteUrl: QUOTE_URL,
    });
    expect(msg).toContain('Hi,');
  });

  it('includes the job summary', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan', summary: 'Boiler service and flush', total: 350 },
      biz: {},
      quoteUrl: QUOTE_URL,
    });
    expect(msg).toContain('Boiler service and flush');
  });

  it('includes the total when present', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan', total: 1250 },
      biz: {},
      quoteUrl: QUOTE_URL,
    });
    expect(msg).toContain('£1250.00');
  });

  it('omits the total line when total is 0', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan', total: 0 },
      biz: {},
      quoteUrl: QUOTE_URL,
    });
    expect(msg).not.toContain('Total:');
  });

  it('reads total from job.amount as fallback', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan', amount: 400 },
      biz: {},
      quoteUrl: QUOTE_URL,
    });
    expect(msg).toContain('£400.00');
  });

  it('includes the quote URL', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan' },
      biz: {},
      quoteUrl: QUOTE_URL,
    });
    expect(msg).toContain(QUOTE_URL);
  });

  it('includes the business name in the sign-off', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan' },
      biz: { name: 'Top Trades Ltd' },
      quoteUrl: QUOTE_URL,
    });
    expect(msg).toContain('Top Trades Ltd');
  });

  it('reads business name from biz.business_name as fallback', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan' },
      biz: { business_name: 'Fallback Trades' },
      quoteUrl: QUOTE_URL,
    });
    expect(msg).toContain('Fallback Trades');
  });

  it('does NOT include bank details (quote, not invoice)', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan', total: 500 },
      biz: {
        name: 'A Plumbing',
        accountName: 'Alan Aranda',
        sortCode: '12-34-56',
        accountNumber: '12345678',
      },
      quoteUrl: QUOTE_URL,
    });
    expect(msg).not.toContain('Sort code');
    expect(msg).not.toContain('Account:');
    expect(msg).not.toContain('Bank details');
  });

  it('does NOT include VAT information (quote, not invoice)', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan', total: 500 },
      biz: { vatRegistered: true },
      quoteUrl: QUOTE_URL,
    });
    expect(msg).not.toContain('VAT');
    expect(msg).not.toContain('inc VAT');
  });

  it('truncates summary to 200 chars', () => {
    const longSummary = 'x'.repeat(300);
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan', summary: longSummary },
      biz: {},
      quoteUrl: QUOTE_URL,
    });
    // The displayed summary should be at most 200 chars
    const summaryLine = msg.split('\n').find((l) => l.startsWith('🔨'));
    expect(summaryLine.replace('🔨 ', '').length).toBeLessThanOrEqual(200);
  });

  it('handles a null job gracefully (no crash)', () => {
    expect(() =>
      buildQuoteWhatsAppMessage({ job: null, biz: null, quoteUrl: QUOTE_URL })
    ).not.toThrow();
  });

  // Link-first ordering — WhatsApp truncates file-share captions on iOS, so
  // the sign URL must sit ahead of the summary/total lines.
  it('places the quote URL above the summary line', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan', summary: 'Boiler service', total: 500 },
      biz: { name: 'A Plumbing' },
      quoteUrl: QUOTE_URL,
    });
    expect(msg.indexOf(QUOTE_URL)).toBeLessThan(msg.indexOf('🔨'));
  });

  it('places the quote URL above the total line', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan', summary: 'X', total: 500 },
      biz: { name: 'A Plumbing' },
      quoteUrl: QUOTE_URL,
    });
    expect(msg.indexOf(QUOTE_URL)).toBeLessThan(msg.indexOf('💷'));
  });

  it('places the quote URL within the first 4 lines (caption-preview safe)', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan', summary: 'X', total: 500 },
      biz: { name: 'A Plumbing' },
      quoteUrl: QUOTE_URL,
    });
    const firstFour = msg.split('\n').slice(0, 4).join('\n');
    expect(firstFour).toContain(QUOTE_URL);
  });

  it('includes a clear sign-call before the URL', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Alan', total: 500 },
      biz: { name: 'A Plumbing' },
      quoteUrl: QUOTE_URL,
    });
    // "Tap to view and sign" must appear before the URL
    expect(msg.indexOf('sign')).toBeLessThan(msg.indexOf(QUOTE_URL));
  });
});

// ── Bank-transfer deposit branch (V1 bank-transfer-deposits) ──────────────────

describe('buildQuoteWhatsAppMessage — bank-transfer deposit block', () => {
  const BIZ_WITH_BANK = {
    name: 'A Plumbing Co',
    accountName: 'Alan Smith',
    sortCode: '12-34-56',
    accountNumber: '12345678',
  };

  it('appends bank details when deposit_percent > 0 and bank details are present', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Jane', total: 1000, deposit_percent: 25 },
      biz: BIZ_WITH_BANK,
      quoteUrl: QUOTE_URL,
    });
    expect(msg).toContain('Sort code: 12-34-56');
    expect(msg).toContain('Account: 12345678');
    expect(msg).toContain('Name: Alan Smith');
    expect(msg).toContain('£250.00 (25%)');
  });

  it('includes "Pay by bank transfer to:" instruction', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Jane', total: 500, deposit_percent: 50 },
      biz: BIZ_WITH_BANK,
      quoteUrl: QUOTE_URL,
    });
    expect(msg).toContain('Pay by bank transfer to:');
  });

  it('includes reference instruction', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Jane', total: 500, deposit_percent: 25 },
      biz: BIZ_WITH_BANK,
      quoteUrl: QUOTE_URL,
    });
    expect(msg).toContain("Use your name as the reference");
  });

  it('does NOT append bank block when deposit_percent is 0', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Jane', total: 500, deposit_percent: 0 },
      biz: BIZ_WITH_BANK,
      quoteUrl: QUOTE_URL,
    });
    expect(msg).not.toContain('Sort code:');
    expect(msg).not.toContain('Pay by bank transfer');
  });

  it('does NOT append bank block when bank details are absent', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Jane', total: 500, deposit_percent: 25 },
      biz: { name: 'A Plumbing' }, // no sortCode / accountNumber
      quoteUrl: QUOTE_URL,
    });
    expect(msg).not.toContain('Sort code:');
  });

  it('does NOT append bank block when depositPayUrl is set (Stripe path wins)', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Jane', total: 500, deposit_percent: 25 },
      biz: BIZ_WITH_BANK,
      quoteUrl: QUOTE_URL,
      depositPayUrl: 'https://pay.stripe.com/abc',
    });
    // Stripe path fires
    expect(msg).toContain('https://pay.stripe.com/abc');
    // Bank block does NOT fire in parallel
    expect(msg).not.toContain('Pay by bank transfer to:');
  });

  it('reads sortCode from snake_case fallback (biz.sort_code)', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Jane', total: 400, deposit_percent: 25 },
      biz: { name: 'Pipes Ltd', sort_code: '11-22-33', account_number: '87654321' },
      quoteUrl: QUOTE_URL,
    });
    expect(msg).toContain('Sort code: 11-22-33');
    expect(msg).toContain('Account: 87654321');
  });

  it('does not include account name line when accountName is empty', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Jane', total: 400, deposit_percent: 25 },
      biz: { name: 'Pipes Ltd', sortCode: '11-22-33', accountNumber: '87654321' },
      quoteUrl: QUOTE_URL,
    });
    expect(msg).not.toContain('Name:');
    expect(msg).toContain('Sort code: 11-22-33');
  });

  it('quote URL still appears above the bank block', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: { customer: 'Jane', total: 1000, deposit_percent: 25 },
      biz: BIZ_WITH_BANK,
      quoteUrl: QUOTE_URL,
    });
    expect(msg.indexOf(QUOTE_URL)).toBeLessThan(msg.indexOf('Sort code:'));
  });
});
