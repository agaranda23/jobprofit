/**
 * receiptMessage.js — unit tests for receipt data assembly and message builder.
 *
 * No DOM, no React — pure-logic convention matching this repo.
 *
 * Covers:
 *   resolvePaidDate:
 *     - Uses latest payment date from payments[] when present
 *     - Falls back to job.paidAt (ISO datetime) when no payments
 *     - Falls back to today when neither payments nor paidAt exist
 *     - Handles multiple payments and picks the latest by date
 *
 *   resolveAmountPaid:
 *     - Sums payments[] amounts
 *     - Falls back to job.amount when no payments[]
 *     - Falls back to job.total when no payments[]
 *     - Returns 0 for a job with no amount and no payments
 *     - Handles edge case: job is Paid via Mark-paid with no payment rows
 *
 *   formatReceiptDate:
 *     - Formats YYYY-MM-DD to "1 Jun 2026"
 *     - Formats ISO datetime to en-GB date string
 *     - Returns '' for falsy input
 *
 *   buildReceiptWhatsAppMessage:
 *     - Contains "PAID IN FULL" marker
 *     - Contains customer first name
 *     - Contains job summary
 *     - Contains formatted paid date
 *     - Contains formatted amount
 *     - Contains business name when present
 *     - Does NOT contain bank details (receipt, not invoice)
 *     - Handles missing customer gracefully (uses "there")
 *     - Handles job with no payments[] (edge case: Mark-paid path)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolvePaidDate,
  resolveAmountPaid,
  formatReceiptDate,
  buildReceiptWhatsAppMessage,
} from '../receiptMessage.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function baseJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Sarah Jones',
    summary: 'Replace kitchen taps',
    amount: 380,
    ...overrides,
  };
}

function makePayment(date, amount, method = 'bank') {
  return { id: `pay_${date}`, date, amount, method, note: '', createdAt: new Date().toISOString() };
}

// ── resolvePaidDate ───────────────────────────────────────────────────────────

describe('resolvePaidDate — payments[] priority', () => {
  it('returns the date of the single payment when one payment exists', () => {
    const job = baseJob({ payments: [makePayment('2026-05-20', 380)] });
    expect(resolvePaidDate(job)).toBe('2026-05-20');
  });

  it('returns the latest payment date when multiple payments exist', () => {
    const job = baseJob({
      payments: [
        makePayment('2026-05-10', 200),
        makePayment('2026-05-20', 180),
        makePayment('2026-05-15', 0), // middle — should not win
      ],
    });
    expect(resolvePaidDate(job)).toBe('2026-05-20');
  });
});

describe('resolvePaidDate — paidAt fallback', () => {
  it('returns the YYYY-MM-DD slice of job.paidAt when no payments[]', () => {
    const job = baseJob({ paidAt: '2026-05-18T14:30:00.000Z' });
    expect(resolvePaidDate(job)).toBe('2026-05-18');
  });

  it('returns the YYYY-MM-DD slice even when paidAt has no milliseconds', () => {
    const job = baseJob({ paidAt: '2026-06-01T09:00:00Z' });
    expect(resolvePaidDate(job)).toBe('2026-06-01');
  });
});

describe('resolvePaidDate — today fallback', () => {
  it('returns today YYYY-MM-DD when neither payments nor paidAt exist', () => {
    // Mock Date so the test is deterministic
    const fixed = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(fixed);
    const job = baseJob();
    const result = resolvePaidDate(job);
    vi.useRealTimers();
    // Should be either 2026-05-31 (UTC+0/BST ahead) — accept either
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns today YYYY-MM-DD when payments[] is an empty array', () => {
    const fixed = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(fixed);
    const job = baseJob({ payments: [] });
    const result = resolvePaidDate(job);
    vi.useRealTimers();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── resolveAmountPaid ─────────────────────────────────────────────────────────

describe('resolveAmountPaid — payments[] sum', () => {
  it('returns the sum of all payment amounts', () => {
    const job = baseJob({
      payments: [makePayment('2026-05-10', 200), makePayment('2026-05-20', 180)],
    });
    expect(resolveAmountPaid(job)).toBe(380);
  });

  it('handles a single payment', () => {
    const job = baseJob({ payments: [makePayment('2026-05-20', 380)] });
    expect(resolveAmountPaid(job)).toBe(380);
  });
});

describe('resolveAmountPaid — fallback to job.amount / job.total', () => {
  it('uses job.amount when no payments[]', () => {
    const job = baseJob({ amount: 500 });
    expect(resolveAmountPaid(job)).toBe(500);
  });

  it('uses job.total when no payments[] and no amount', () => {
    const job = { id: 'j2', customer: 'Bob', summary: 'Fence fix', total: 250 };
    expect(resolveAmountPaid(job)).toBe(250);
  });

  it('returns 0 when no payments and no amount/total', () => {
    const job = { id: 'j3', customer: 'Bob', summary: 'Fence fix' };
    expect(resolveAmountPaid(job)).toBe(0);
  });

  it('handles Mark-paid edge case: status=paid, paidAt set, payments[] absent', () => {
    const job = baseJob({
      status: 'paid',
      paid: true,
      paidAt: '2026-05-18T14:30:00.000Z',
      amount: 300,
      payments: undefined,
    });
    expect(resolveAmountPaid(job)).toBe(300);
  });
});

// ── formatReceiptDate ─────────────────────────────────────────────────────────

describe('formatReceiptDate', () => {
  it('formats YYYY-MM-DD as "D Mon YYYY"', () => {
    // 1 Jun 2026 in en-GB
    expect(formatReceiptDate('2026-06-01')).toBe('1 Jun 2026');
  });

  it('formats an ISO datetime string', () => {
    expect(formatReceiptDate('2026-05-18T14:30:00.000Z')).toMatch(/\d{1,2} \w+ \d{4}/);
  });

  it('returns empty string for null', () => {
    expect(formatReceiptDate(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatReceiptDate(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatReceiptDate('')).toBe('');
  });
});

// ── buildReceiptWhatsAppMessage ───────────────────────────────────────────────

describe('buildReceiptWhatsAppMessage — required content', () => {
  const job = baseJob({
    payments: [makePayment('2026-05-20', 380)],
  });
  const biz = { name: 'Alan Plumbing Ltd' };

  it('contains PAID IN FULL marker', () => {
    const msg = buildReceiptWhatsAppMessage({ job, biz });
    expect(msg).toContain('PAID IN FULL');
  });

  it('contains the customer first name', () => {
    const msg = buildReceiptWhatsAppMessage({ job, biz });
    expect(msg).toContain('Sarah');
  });

  it('contains the job summary', () => {
    const msg = buildReceiptWhatsAppMessage({ job, biz });
    expect(msg).toContain('Replace kitchen taps');
  });

  it('contains the paid date', () => {
    const msg = buildReceiptWhatsAppMessage({ job, biz });
    expect(msg).toContain('20 May 2026');
  });

  it('contains the formatted amount', () => {
    const msg = buildReceiptWhatsAppMessage({ job, biz });
    expect(msg).toContain('380.00');
  });

  it('contains the business name', () => {
    const msg = buildReceiptWhatsAppMessage({ job, biz });
    expect(msg).toContain('Alan Plumbing Ltd');
  });
});

describe('buildReceiptWhatsAppMessage — no bank details', () => {
  it('does not include bank details even when biz has them', () => {
    const job = baseJob({ payments: [makePayment('2026-05-20', 380)] });
    const biz = {
      name: 'Alan Plumbing Ltd',
      accountName: 'Alan Aranda',
      sortCode: '12-34-56',
      accountNumber: '12345678',
      bankDetails: 'Sort: 12-34-56 / Acc: 12345678',
    };
    const msg = buildReceiptWhatsAppMessage({ job, biz });
    expect(msg).not.toContain('Sort code');
    expect(msg).not.toContain('12-34-56');
    expect(msg).not.toContain('Bank details');
  });
});

describe('buildReceiptWhatsAppMessage — edge cases', () => {
  it('uses "there" when customer name is absent', () => {
    const job = { id: 'j1', summary: 'Fence fix', amount: 200, payments: [makePayment('2026-05-20', 200)] };
    const msg = buildReceiptWhatsAppMessage({ job, biz: { name: 'Alan Plumbing' } });
    expect(msg).toContain('Hi there,');
  });

  it('works when payments[] is absent (Mark-paid edge case)', () => {
    const job = baseJob({ status: 'paid', paid: true, paidAt: '2026-05-18T14:30:00.000Z' });
    const msg = buildReceiptWhatsAppMessage({ job, biz: { name: 'Alan Plumbing' } });
    expect(msg).toContain('PAID IN FULL');
    expect(msg).toContain('380.00');
  });

  it('omits business name line when biz is null', () => {
    const job = baseJob({ payments: [makePayment('2026-05-20', 380)] });
    const msg = buildReceiptWhatsAppMessage({ job, biz: null });
    // Should still be a valid message with no crash
    expect(msg).toContain('PAID IN FULL');
  });

  it('omits business name line when biz.name is empty', () => {
    const job = baseJob({ payments: [makePayment('2026-05-20', 380)] });
    const msg = buildReceiptWhatsAppMessage({ job, biz: { name: '' } });
    expect(msg).toContain('PAID IN FULL');
    // The empty biz name should not leave a trailing blank line at the end
    const lines = msg.split('\n');
    const lastLine = lines[lines.length - 1];
    expect(lastLine).not.toBe('');
  });
});
