/**
 * booksSummaryCalc.test.js
 *
 * Unit tests for the pure calc + response allow-lists behind the accountant
 * "books link" (feat/accountant-books-link). No network, no Supabase — these
 * exercise computeBooksSummary()/pickAllowed()/isProNow() directly with plain
 * JS fixtures shaped like raw Supabase rows.
 *
 * Coverage:
 *   A. Income/expenses/profit arithmetic
 *   B. VAT summary (registered vs not, cash-accounting basis)
 *   C. Tax estimate (mirrors the Tax Pot definition, scaled to the period)
 *   D. Invoiced-jobs filtering (only jobs with an invoiceNumber, in period)
 *   E. Receipts filtering + totals
 *   F. Customer aggregation
 *   G. Excluded jobs (cancelled/draft) never contribute
 *   H. WHITELIST-SHAPE — every response object's keys are a SUBSET of the
 *      hardcoded allow-list, at top level AND for every nested job/receipt/
 *      customer item. This is the mandatory security assertion QAE flagged.
 *   I. isProNow — pro / active trial / expired trial / free / null profile
 */

import { describe, it, expect } from 'vitest';
import {
  computeBooksSummary,
  pickAllowed,
  isProNow,
  isValidBooksPeriod,
  TOP_LEVEL_ALLOWED_KEYS,
  BUSINESS_ALLOWED_KEYS,
  PERIOD_ALLOWED_KEYS,
  INCOME_ALLOWED_KEYS,
  EXPENSES_ALLOWED_KEYS,
  VAT_ALLOWED_KEYS,
  JOB_ALLOWED_KEYS,
  RECEIPT_ALLOWED_KEYS,
  CUSTOMER_ALLOWED_KEYS,
} from '../_lib/booksSummaryCalc.js';

const NOW = new Date('2026-07-06T12:00:00.000Z'); // within tax year 2026-27 (6 Apr 2026 – 5 Apr 2027)

function job(overrides = {}) {
  return {
    id: 'job-1',
    customer_name: 'Jane Smith',
    summary: 'Fix boiler',
    amount: 240,
    paid: true,
    date: '2026-06-01',
    payment_date: '2026-06-01',
    meta: {},
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    id: 'r1',
    merchant: 'Screwfix',
    amount: 60,
    vat: 10,
    date: '2026-06-02',
    ...overrides,
  };
}

function keysSubsetOf(obj, allowed) {
  return Object.keys(obj).every((k) => allowed.includes(k));
}

// ── A. Income / expenses / profit arithmetic ────────────────────────────────

describe('A. computeBooksSummary — income/expenses/profit', () => {
  it('sums paid job amounts into income.paidTotal and receipts into expenses.total', () => {
    const jobs = [job({ amount: 240, meta: { invoiceNumber: 'INV-1', total: 240 } })];
    const receipts = [receipt({ amount: 60, vat: 10 })];
    const summary = computeBooksSummary({ profile: {}, jobs, receipts, period: 'this_tax_year', now: NOW });

    expect(summary.income.paidTotal).toBe(240);
    expect(summary.income.invoicedTotal).toBe(240);
    expect(summary.expenses.total).toBe(60);
    expect(summary.expenses.vatTotal).toBe(10);
    expect(summary.profit).toBe(180);
  });

  it('unpaid, non-invoiced jobs contribute nothing to income', () => {
    const jobs = [job({ paid: false, meta: {} })];
    const summary = computeBooksSummary({ profile: {}, jobs, receipts: [], period: 'this_tax_year', now: NOW });
    expect(summary.income.paidTotal).toBe(0);
    expect(summary.income.invoicedTotal).toBe(0);
    expect(summary.invoicedJobs).toHaveLength(0);
  });

  it('a job outside the selected period is excluded from both income and the invoiced list', () => {
    const jobs = [job({ date: '2025-01-01', payment_date: '2025-01-01', meta: { invoiceNumber: 'INV-OLD', total: 500 } })];
    const summary = computeBooksSummary({ profile: {}, jobs, receipts: [], period: 'this_tax_year', now: NOW });
    expect(summary.income.paidTotal).toBe(0);
    expect(summary.income.invoicedTotal).toBe(0);
    expect(summary.invoicedJobs).toHaveLength(0);
  });
});

// ── B. VAT summary ───────────────────────────────────────────────────────────

describe('B. computeBooksSummary — VAT summary (cash-accounting basis)', () => {
  it('derives output VAT from paid gross income when the trader is VAT-registered', () => {
    const jobs = [job({ amount: 1200, meta: { invoiceNumber: 'INV-1', total: 1200 } })];
    const summary = computeBooksSummary({
      profile: { vat_number: 'GB123456789' },
      jobs,
      receipts: [],
      period: 'this_tax_year',
      now: NOW,
    });
    // splitVatInclusive(1200, 0.2) => net 1000, vat 200
    expect(summary.vat.netSales).toBeCloseTo(1000, 2);
    expect(summary.vat.outputVat).toBeCloseTo(200, 2);
  });

  it('output VAT is zero when the trader is not VAT-registered (no vat_number)', () => {
    const jobs = [job({ amount: 1200, meta: { invoiceNumber: 'INV-1', total: 1200 } })];
    const summary = computeBooksSummary({ profile: {}, jobs, receipts: [], period: 'this_tax_year', now: NOW });
    expect(summary.vat.outputVat).toBe(0);
    expect(summary.vat.netSales).toBe(1200);
  });

  it('netVat = outputVat - inputVat (positive = owed to HMRC)', () => {
    const jobs = [job({ amount: 1200, meta: { invoiceNumber: 'INV-1', total: 1200 } })];
    const receipts = [receipt({ amount: 120, vat: 20 })];
    const summary = computeBooksSummary({
      profile: { vat_number: 'GB123456789' },
      jobs,
      receipts,
      period: 'this_tax_year',
      now: NOW,
    });
    expect(summary.vat.inputVat).toBe(20);
    expect(summary.vat.netVat).toBeCloseTo(180, 2); // 200 - 20
  });
});

// ── C. Tax estimate ──────────────────────────────────────────────────────────

describe('C. computeBooksSummary — taxEstimate', () => {
  it('applies tax_set_aside_pct to positive profit for the period', () => {
    const jobs = [job({ amount: 500, meta: { invoiceNumber: 'INV-1', total: 500 } })];
    const receipts = [receipt({ amount: 100, vat: 0 })];
    const summary = computeBooksSummary({
      profile: { tax_set_aside_pct: 25 },
      jobs,
      receipts,
      period: 'this_tax_year',
      now: NOW,
    });
    // profit = 400, taxEstimate = 400 * 0.25 = 100
    expect(summary.profit).toBe(400);
    expect(summary.taxEstimate).toBeCloseTo(100, 2);
  });

  it('clamps at 0 when profit for the period is negative (never a negative tax estimate)', () => {
    const jobs = [job({ amount: 100, meta: { invoiceNumber: 'INV-1', total: 100 } })];
    const receipts = [receipt({ amount: 500, vat: 0 })];
    const summary = computeBooksSummary({ profile: { tax_set_aside_pct: 20 }, jobs, receipts, period: 'this_tax_year', now: NOW });
    expect(summary.profit).toBeLessThan(0);
    expect(summary.taxEstimate).toBe(0);
  });

  it('defaults to 20% when tax_set_aside_pct is absent from the profile', () => {
    const jobs = [job({ amount: 1000, meta: { invoiceNumber: 'INV-1', total: 1000 } })];
    const summary = computeBooksSummary({ profile: {}, jobs, receipts: [], period: 'this_tax_year', now: NOW });
    expect(summary.taxEstimate).toBeCloseTo(200, 2);
  });
});

// ── D. Invoiced-jobs filtering ───────────────────────────────────────────────

describe('D. computeBooksSummary — invoicedJobs list', () => {
  it('only includes jobs that carry an invoiceNumber in meta', () => {
    const jobs = [
      job({ id: 'a', meta: { invoiceNumber: 'INV-1', total: 240 } }),
      job({ id: 'b', meta: {} }), // quote/lead only — never invoiced
    ];
    const summary = computeBooksSummary({ profile: {}, jobs, receipts: [], period: 'this_tax_year', now: NOW });
    expect(summary.invoicedJobs).toHaveLength(1);
    expect(summary.invoicedJobs[0].invoiceNumber).toBe('INV-1');
  });

  it('cancelled/draft jobs never contribute even with an invoiceNumber', () => {
    const jobs = [job({ status: 'cancelled', meta: { invoiceNumber: 'INV-1', total: 240 } })];
    const summary = computeBooksSummary({ profile: {}, jobs, receipts: [], period: 'this_tax_year', now: NOW });
    expect(summary.invoicedJobs).toHaveLength(0);
    expect(summary.income.invoicedTotal).toBe(0);
  });
});

// ── F. Customer aggregation ──────────────────────────────────────────────────

describe('F. computeBooksSummary — customers list', () => {
  it('aggregates paid totals + job count per customer name', () => {
    const jobs = [
      job({ id: 'a', customer_name: 'Jane Smith', amount: 100, meta: { total: 100 } }),
      job({ id: 'b', customer_name: 'Jane Smith', amount: 50, meta: { total: 50 } }),
      job({ id: 'c', customer_name: 'Bob Jones', amount: 30, meta: { total: 30 } }),
    ];
    const summary = computeBooksSummary({ profile: {}, jobs, receipts: [], period: 'this_tax_year', now: NOW });
    const jane = summary.customers.find((c) => c.name === 'Jane Smith');
    const bob = summary.customers.find((c) => c.name === 'Bob Jones');
    expect(jane.paidTotal).toBe(150);
    expect(jane.jobCount).toBe(2);
    expect(bob.paidTotal).toBe(30);
  });
});

// ── H. WHITELIST-SHAPE — the mandatory security assertion ───────────────────

describe('H. Whitelist-shape — response keys are always a SUBSET of the allow-list', () => {
  const jobs = [
    job({ id: 'a', meta: { invoiceNumber: 'INV-1', total: 240 } }),
    job({ id: 'b', customer_name: 'Bob Jones', amount: 90, meta: { invoiceNumber: 'INV-2', total: 90 } }),
  ];
  const receipts = [receipt(), receipt({ id: 'r2', merchant: 'Toolstation' })];
  const profile = {
    business_name: 'Jane the Plumber',
    address: '1 Test St',
    vat_number: 'GB999000111',
    logo_url: 'https://example.com/logo.png',
    tax_set_aside_pct: 20,
    payment_terms_days: 14,
    // Secrets that must NEVER leak into the summary even if present on the row.
    // Deliberately no digit-substring overlap with vat_number above, so the
    // "never contains X" assertions below can't accidentally pass/fail on a
    // fixture coincidence rather than real leakage.
    sort_code: '12-34-56',
    account_number: '55554444',
    account_name: 'Jane the Plumber Ltd',
    stripe_user_id: 'acct_fake',
    stripe_customer_id: 'cus_fake',
    stripe_subscription_id: 'sub_fake',
    stripe_connect_status: 'connected',
    id: 'user-uuid-should-not-leak',
  };

  const summary = computeBooksSummary({ profile, jobs, receipts, period: 'this_tax_year', now: NOW });

  it('top level keys ⊆ TOP_LEVEL_ALLOWED_KEYS', () => {
    expect(keysSubsetOf(summary, TOP_LEVEL_ALLOWED_KEYS)).toBe(true);
  });

  it('business keys ⊆ BUSINESS_ALLOWED_KEYS (no sort_code/account_number/stripe_*/id)', () => {
    expect(keysSubsetOf(summary.business, BUSINESS_ALLOWED_KEYS)).toBe(true);
  });

  it('period keys ⊆ PERIOD_ALLOWED_KEYS', () => {
    expect(keysSubsetOf(summary.period, PERIOD_ALLOWED_KEYS)).toBe(true);
  });

  it('income keys ⊆ INCOME_ALLOWED_KEYS', () => {
    expect(keysSubsetOf(summary.income, INCOME_ALLOWED_KEYS)).toBe(true);
  });

  it('expenses keys ⊆ EXPENSES_ALLOWED_KEYS', () => {
    expect(keysSubsetOf(summary.expenses, EXPENSES_ALLOWED_KEYS)).toBe(true);
  });

  it('vat keys ⊆ VAT_ALLOWED_KEYS', () => {
    expect(keysSubsetOf(summary.vat, VAT_ALLOWED_KEYS)).toBe(true);
  });

  it('every invoicedJobs item ⊆ JOB_ALLOWED_KEYS', () => {
    expect(summary.invoicedJobs.length).toBeGreaterThan(0);
    for (const item of summary.invoicedJobs) {
      expect(keysSubsetOf(item, JOB_ALLOWED_KEYS)).toBe(true);
    }
  });

  it('every receipts item ⊆ RECEIPT_ALLOWED_KEYS', () => {
    expect(summary.receipts.length).toBeGreaterThan(0);
    for (const item of summary.receipts) {
      expect(keysSubsetOf(item, RECEIPT_ALLOWED_KEYS)).toBe(true);
    }
  });

  it('every customers item ⊆ CUSTOMER_ALLOWED_KEYS', () => {
    expect(summary.customers.length).toBeGreaterThan(0);
    for (const item of summary.customers) {
      expect(keysSubsetOf(item, CUSTOMER_ALLOWED_KEYS)).toBe(true);
    }
  });

  it('the serialized JSON never contains sort_code/account_number/account_name/stripe_/user_id text', () => {
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toMatch(/sort_code|sort code|12-34-56/i);
    expect(serialized).not.toMatch(/account_number|12345678/i);
    expect(serialized).not.toMatch(/account_name/i);
    expect(serialized).not.toMatch(/stripe_/i);
    expect(serialized).not.toMatch(/acct_fake|cus_fake|sub_fake/);
    expect(serialized).not.toMatch(/user-uuid-should-not-leak/);
  });
});

describe('pickAllowed', () => {
  it('drops any key not in the allow-list', () => {
    const out = pickAllowed({ a: 1, b: 2, secret: 'nope' }, ['a', 'b']);
    expect(out).toEqual({ a: 1, b: 2 });
    expect(out.secret).toBeUndefined();
  });

  it('returns {} for a null/undefined object', () => {
    expect(pickAllowed(null, ['a'])).toEqual({});
    expect(pickAllowed(undefined, ['a'])).toEqual({});
  });
});

describe('isValidBooksPeriod', () => {
  it('accepts the four known period ids', () => {
    for (const p of ['this_tax_year', 'last_tax_year', 'this_quarter', 'custom']) {
      expect(isValidBooksPeriod(p)).toBe(true);
    }
  });
  it('rejects anything else', () => {
    expect(isValidBooksPeriod('all_time')).toBe(false);
    expect(isValidBooksPeriod('')).toBe(false);
    expect(isValidBooksPeriod(undefined)).toBe(false);
  });
});

// ── I. isProNow ──────────────────────────────────────────────────────────────

describe('I. isProNow — fetch-time Pro re-check', () => {
  it('true for plan=pro', () => {
    expect(isProNow({ plan: 'pro' }, NOW)).toBe(true);
  });

  it('true for an active trial (trial_ends_at in the future)', () => {
    expect(isProNow({ plan: 'trial', trial_ends_at: '2026-08-01T00:00:00Z' }, NOW)).toBe(true);
  });

  it('false for an expired trial', () => {
    expect(isProNow({ plan: 'trial', trial_ends_at: '2026-01-01T00:00:00Z' }, NOW)).toBe(false);
  });

  it('false for plan=free', () => {
    expect(isProNow({ plan: 'free' }, NOW)).toBe(false);
  });

  it('false for a null/undefined profile', () => {
    expect(isProNow(null, NOW)).toBe(false);
    expect(isProNow(undefined, NOW)).toBe(false);
  });
});
