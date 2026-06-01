/**
 * depositNetting.test.js
 *
 * Tests for G3 — deposit-on-acceptance netting behaviour.
 *
 * The webhook (stripe-connect-webhook.js) appends a 'Deposit on acceptance'
 * payment to job.payments[] after a successful deposit checkout. These tests
 * verify that the existing payments.js machinery then correctly:
 *   - nets the deposit off the outstanding balance
 *   - does NOT auto-flip the job to Paid (invoice hasn't been sent yet)
 *   - DOES auto-flip to Paid when the invoice is sent and the remaining balance is cleared
 *   - 100% deposit on a pre-invoice job flags _depositFullyClearsQuote but does
 *     NOT auto-mark-Paid (the invoice step is still required)
 *
 * All tests run against src/lib/payments.js (pure, no I/O).
 */

import { describe, it, expect } from 'vitest';
import { addPayment, computeBalance, computeAmountPaid, applyAutoFlip } from '../payments.js';

const PAST_DATE = '2024-06-01';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simulates the webhook appending a deposit payment to the job's payments[]. */
function appendDepositPayment(job, depositGbp, paidAtDate = PAST_DATE) {
  return addPayment(job, {
    amount: depositGbp,
    date:   paidAtDate,
    method: 'card',
    note:   'Deposit on acceptance',
  });
}

/** A quoted job (pre-invoice) ready to receive a deposit. */
function quotedJob(total, overrides = {}) {
  return {
    id:          'job-123',
    amount:      total,
    total:       total,
    status:      'quoted',
    paymentStatus: 'unpaid',
    payments:    [],
    ...overrides,
  };
}

/** An active job that has had its invoice sent. */
function invoicedJob(total, depositPayment = null, overrides = {}) {
  return {
    id:           'job-123',
    amount:       total,
    total:        total,
    status:       'invoice_sent',
    paymentStatus: 'awaiting',
    invoiceSentAt: '2026-06-01T10:00:00Z',
    payments:     depositPayment ? [depositPayment] : [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('G3 — deposit netting: partial deposit on quoted job', () => {
  it('reduces the outstanding balance by the deposit amount', () => {
    const job    = quotedJob(1000);
    const result = appendDepositPayment(job, 250); // 25% deposit
    expect(computeBalance(result)).toBe(750);
  });

  it('records the deposit payment with the correct shape', () => {
    const job    = quotedJob(1000);
    const result = appendDepositPayment(job, 250);
    const pay    = result.payments[0];
    expect(pay.amount).toBe(250);
    expect(pay.method).toBe('card');
    expect(pay.note).toBe('Deposit on acceptance');
    expect(pay.date).toBe(PAST_DATE);
    expect(pay.id).toMatch(/^pay_/);
    expect(pay.createdAt).toBeDefined();
  });

  it('does NOT auto-flip a pre-invoice (quoted) job to Paid on partial deposit', () => {
    const job    = quotedJob(1000);
    const result = appendDepositPayment(job, 250);
    // Balance is 750 (positive) — branch 4: no wasPaid, no flip
    expect(result.status).toBe('quoted');
    expect(result.paymentStatus).toBe('unpaid');
  });

  it('amountPaid equals the deposit amount', () => {
    const job    = quotedJob(800);
    const result = appendDepositPayment(job, 200);
    expect(computeAmountPaid(result)).toBe(200);
  });
});

describe('G3 — deposit netting: 100% deposit must NOT auto-mark Paid (guard)', () => {
  it('sets _depositFullyClearsQuote flag, not status=paid, when deposit = full quote on pre-invoice job', () => {
    const job    = quotedJob(500);
    const result = appendDepositPayment(job, 500); // full amount
    // applyAutoFlip fires inside addPayment — pre-invoice guard must catch this.
    expect(result.status).not.toBe('paid');
    expect(result._depositFullyClearsQuote).toBe(true);
  });

  it('does not flip on 100% deposit when job is active (pre-invoice)', () => {
    const job    = { ...quotedJob(400), status: 'active', paymentStatus: 'unpaid' };
    const result = appendDepositPayment(job, 400);
    expect(result.status).toBe('active');
    expect(result._depositFullyClearsQuote).toBe(true);
  });
});

describe('G3 — deposit netting: invoice path after deposit paid', () => {
  it('chases only the remaining balance (quote total minus deposit) after invoice sent', () => {
    // Simulate: deposit paid, then invoice sent, then remaining balance due.
    const deposit = { id: 'pay_dep', date: PAST_DATE, amount: 250, method: 'card', note: 'Deposit on acceptance', createdAt: '2026-06-01T00:00:00Z' };
    const job     = invoicedJob(1000, deposit);
    // Outstanding = 1000 - 250 = 750
    expect(computeBalance(job)).toBe(750);
  });

  it('auto-flips to Paid when the full remaining balance is recorded post-invoice', () => {
    const deposit = { id: 'pay_dep', date: PAST_DATE, amount: 250, method: 'card', note: 'Deposit on acceptance', createdAt: '2026-06-01T00:00:00Z' };
    const job     = invoicedJob(1000, deposit);
    // Customer pays the remaining £750
    const result  = addPayment(job, { amount: 750, date: PAST_DATE, method: 'bank', note: 'Final payment' });
    expect(result.status).toBe('paid');
    expect(result.paymentStatus).toBe('paid');
    expect(computeBalance(result)).toBe(0);
  });

  it('100% deposit: after invoice is sent, auto-flips to Paid with no additional payment', () => {
    // Deposit covers 100% of the total. Invoice was then sent. Balance is 0.
    // applyAutoFlip should flip to Paid because invoiceSentAt is now set.
    const deposit = { id: 'pay_dep', date: PAST_DATE, amount: 500, method: 'card', note: 'Deposit on acceptance', createdAt: '2026-06-01T00:00:00Z' };
    const job     = invoicedJob(500, deposit);
    const result  = applyAutoFlip(job);
    expect(result.status).toBe('paid');
    expect(result.paymentStatus).toBe('paid');
  });

  it('partial deposit: invoice NOT yet sent, balance > 0 — status stays as-is', () => {
    // Pre-invoice with partial deposit: no flip, no guard flag.
    const job    = quotedJob(1000);
    const result = appendDepositPayment(job, 300); // 300 of 1000
    expect(result.status).toBe('quoted'); // branch 4: unchanged
    expect(result._depositFullyClearsQuote).toBeUndefined();
  });
});

describe('G3 — deposit refund: removing the deposit payment restores full balance', () => {
  it('after deposit refund, payments[] is empty and balance equals full total', () => {
    // Simulate the webhook removing the Deposit on acceptance row on full refund.
    const deposit = { id: 'pay_dep', date: PAST_DATE, amount: 250, method: 'card', note: 'Deposit on acceptance', createdAt: '2026-06-01T00:00:00Z' };
    const job     = { ...quotedJob(1000), payments: [deposit] };

    // Webhook filters out 'Deposit on acceptance' payments on full refund
    const paymentsAfterRefund = job.payments.filter(p => p.note !== 'Deposit on acceptance');
    const refundedJob         = { ...job, payments: paymentsAfterRefund, deposit_paid_at: null };

    expect(paymentsAfterRefund).toHaveLength(0);
    expect(computeBalance(refundedJob)).toBe(1000); // full balance restored
  });
});
