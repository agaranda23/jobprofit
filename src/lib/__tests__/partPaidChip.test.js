/**
 * Unit tests for the part-paid chip helpers — show/hide condition + label format.
 * No DOM, no React, no Supabase.
 *
 * The chip renders when ALL three are true:
 *   1. job stage is Invoiced or Overdue  (awaiting-payment stages only)
 *   2. computeAmountPaid(job) > 0        (at least one payment recorded)
 *   3. computeBalance(job) > 0           (not yet fully paid)
 *
 * Label format: "70% paid · £300 left"
 *   - percent: Math.round(amountPaid / total * 100)
 *   - balance: rounded to nearest whole pound, formatted en-GB no pence
 */

import { describe, it, expect } from 'vitest';
import { shouldShowPartPaidChip, formatPartPaidLabel } from '../partPaidChip.js';
import { isFullyPaid } from '../payments.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const PAST_DATE = '2024-01-15';

function makePayment(amount, id = 'pay_1') {
  return { id, date: PAST_DATE, amount, method: 'cash', note: '', createdAt: '2026-05-01T10:00:00Z' };
}

function invoicedJob(overrides = {}) {
  return {
    id: 'j1',
    amount: 1000,
    status: 'invoice_sent',
    invoiceSentAt: '2026-05-01T10:00:00Z',
    payments: [],
    ...overrides,
  };
}

// ─── shouldShowPartPaidChip — show/hide condition ─────────────────────────────

describe('shouldShowPartPaidChip — show condition', () => {
  it('shows when Invoiced, partial payment recorded', () => {
    const job = invoicedJob({ payments: [makePayment(300)] });
    expect(shouldShowPartPaidChip(job, 'Invoiced')).toBe(true);
  });

  it('shows when Overdue, partial payment recorded', () => {
    const job = invoicedJob({ payments: [makePayment(700)] });
    expect(shouldShowPartPaidChip(job, 'Overdue')).toBe(true);
  });

  it('hides when no payments at all (untouched invoice)', () => {
    const job = invoicedJob({ payments: [] });
    expect(shouldShowPartPaidChip(job, 'Invoiced')).toBe(false);
  });

  it('hides when payments array is missing', () => {
    const job = { id: 'j1', amount: 500, status: 'invoice_sent', invoiceSentAt: '2026-05-01T10:00:00Z' };
    expect(shouldShowPartPaidChip(job, 'Invoiced')).toBe(false);
  });

  it('hides when fully paid (balance === 0)', () => {
    const job = invoicedJob({ amount: 500, payments: [makePayment(500)] });
    expect(shouldShowPartPaidChip(job, 'Invoiced')).toBe(false);
  });

  it('hides when overpaid (balance < 0)', () => {
    const job = invoicedJob({ amount: 500, payments: [makePayment(600)] });
    expect(shouldShowPartPaidChip(job, 'Invoiced')).toBe(false);
  });

  it('hides on Lead stage regardless of payments', () => {
    const job = invoicedJob({ payments: [makePayment(200)] });
    expect(shouldShowPartPaidChip(job, 'Lead')).toBe(false);
  });

  it('hides on Quoted stage regardless of payments', () => {
    const job = invoicedJob({ payments: [makePayment(200)] });
    expect(shouldShowPartPaidChip(job, 'Quoted')).toBe(false);
  });

  it('hides on On stage regardless of payments', () => {
    const job = invoicedJob({ payments: [makePayment(200)] });
    expect(shouldShowPartPaidChip(job, 'On')).toBe(false);
  });

  it('hides on Paid stage regardless of payments', () => {
    const job = invoicedJob({ amount: 500, payments: [makePayment(500)] });
    expect(shouldShowPartPaidChip(job, 'Paid')).toBe(false);
  });

  it('shows when two payments together are still partial', () => {
    const job = invoicedJob({
      amount: 1000,
      payments: [makePayment(200, 'pay_1'), makePayment(150, 'pay_2')],
    });
    expect(shouldShowPartPaidChip(job, 'Invoiced')).toBe(true);
  });

  it('hides when two payments together fully clear the balance', () => {
    const job = invoicedJob({
      amount: 1000,
      payments: [makePayment(600, 'pay_1'), makePayment(400, 'pay_2')],
    });
    expect(shouldShowPartPaidChip(job, 'Invoiced')).toBe(false);
  });
});

// ─── formatPartPaidLabel — chip copy ─────────────────────────────────────────

describe('formatPartPaidLabel — chip copy', () => {
  it('70% paid · £300 left on a £1,000 job with £700 paid', () => {
    const job = invoicedJob({ amount: 1000, payments: [makePayment(700)] });
    expect(formatPartPaidLabel(job)).toBe('70% paid · £300 left');
  });

  it('50% paid · £250 left on a £500 job with £250 paid', () => {
    const job = invoicedJob({ amount: 500, payments: [makePayment(250)] });
    expect(formatPartPaidLabel(job)).toBe('50% paid · £250 left');
  });

  it('rounds percent to nearest integer (33.33% → 33)', () => {
    const job = invoicedJob({ amount: 300, payments: [makePayment(100)] });
    expect(formatPartPaidLabel(job)).toBe('33% paid · £200 left');
  });

  it('rounds up when percent fractional part is ≥ .5 (16.666% → 17)', () => {
    const job = invoicedJob({ amount: 600, payments: [makePayment(100)] });
    expect(formatPartPaidLabel(job)).toBe('17% paid · £500 left');
  });

  it('formats large balances with comma separator (en-GB)', () => {
    const job = invoicedJob({ amount: 10000, payments: [makePayment(1000)] });
    expect(formatPartPaidLabel(job)).toBe('10% paid · £9,000 left');
  });

  it('uses job.total in preference to job.amount', () => {
    const job = { ...invoicedJob(), total: 800, amount: 999, payments: [makePayment(400)] };
    expect(formatPartPaidLabel(job)).toBe('50% paid · £400 left');
  });

  it('sums multiple payments correctly (35% paid · £650 left)', () => {
    const job = invoicedJob({
      amount: 1000,
      payments: [makePayment(200, 'pay_1'), makePayment(150, 'pay_2')],
    });
    expect(formatPartPaidLabel(job)).toBe('35% paid · £650 left');
  });
});

// ─── isFullyPaid cross-check — chip always hidden when fully paid ─────────────

describe('isFullyPaid guard — chip suppressed when fully paid', () => {
  it('isFullyPaid true at zero balance → chip hidden', () => {
    const job = invoicedJob({ amount: 500, payments: [makePayment(500)] });
    expect(isFullyPaid(job)).toBe(true);
    expect(shouldShowPartPaidChip(job, 'Invoiced')).toBe(false);
  });

  it('isFullyPaid false on partial → chip visible', () => {
    const job = invoicedJob({ amount: 500, payments: [makePayment(499)] });
    expect(isFullyPaid(job)).toBe(false);
    expect(shouldShowPartPaidChip(job, 'Invoiced')).toBe(true);
  });
});
