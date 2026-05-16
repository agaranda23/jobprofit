import { describe, it, expect } from 'vitest';
import {
  validateAmount,
  validateDate,
  validateMethod,
  addPayment,
  editPayment,
  deletePayment,
  computeAmountPaid,
  computeBalance,
  isFullyPaid,
  isOverpaid,
  applyAutoFlip,
} from '../payments.js';

// Local-tz today for boundary tests. Computed once per test run.
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Past date safe for years to come — used everywhere a "definitely-not-future" date is needed.
const PAST_DATE = '2024-01-15';

function freshAwaitingJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Sarah Mitchell',
    amount: 250,
    status: 'awaiting',
    paymentStatus: 'awaiting',
    invoiceSentAt: '2026-05-10T10:00:00Z',
    payments: [],
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────
describe('addPayment', () => {
  it('appends a payment and returns a new job (input not mutated)', () => {
    const job = freshAwaitingJob();
    const result = addPayment(job, { amount: 100, date: PAST_DATE, method: 'cash' });
    expect(result).not.toBe(job);
    expect(job.payments).toEqual([]); // input untouched
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]).toMatchObject({
      amount: 100, date: PAST_DATE, method: 'cash', note: '',
    });
  });

  it('generates a payment id matching pay_<ts>_<random>', () => {
    const job = freshAwaitingJob();
    const result = addPayment(job, { amount: 100, date: PAST_DATE, method: 'cash' });
    expect(result.payments[0].id).toMatch(/^pay_\d+_[a-z0-9]+$/);
  });

  it('sets createdAt to a valid ISO datetime', () => {
    const before = new Date().toISOString();
    const result = addPayment(freshAwaitingJob(), { amount: 100, date: PAST_DATE, method: 'cash' });
    const after = new Date().toISOString();
    expect(result.payments[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(result.payments[0].createdAt >= before).toBe(true);
    expect(result.payments[0].createdAt <= after).toBe(true);
  });

  it('defaults note to empty string when omitted', () => {
    const result = addPayment(freshAwaitingJob(), { amount: 100, date: PAST_DATE, method: 'cash' });
    expect(result.payments[0].note).toBe('');
  });

  it('accepts a non-empty note string', () => {
    const result = addPayment(freshAwaitingJob(), { amount: 100, date: PAST_DATE, method: 'cash', note: '50% deposit' });
    expect(result.payments[0].note).toBe('50% deposit');
  });

  it('throws when amount is zero, negative, NaN, Infinity, string, or missing', () => {
    const j = freshAwaitingJob();
    expect(() => addPayment(j, { amount: 0, date: PAST_DATE, method: 'cash' })).toThrow(/positive number/);
    expect(() => addPayment(j, { amount: -10, date: PAST_DATE, method: 'cash' })).toThrow(/positive number/);
    expect(() => addPayment(j, { amount: NaN, date: PAST_DATE, method: 'cash' })).toThrow(/positive number/);
    expect(() => addPayment(j, { amount: Infinity, date: PAST_DATE, method: 'cash' })).toThrow(/positive number/);
    expect(() => addPayment(j, { amount: '100', date: PAST_DATE, method: 'cash' })).toThrow(/positive number/);
    expect(() => addPayment(j, { date: PAST_DATE, method: 'cash' })).toThrow(/positive number/);
  });

  it('throws when date is malformed or in the future', () => {
    const j = freshAwaitingJob();
    expect(() => addPayment(j, { amount: 100, date: '2026/05/15', method: 'cash' })).toThrow(/YYYY-MM-DD/);
    expect(() => addPayment(j, { amount: 100, date: '15-05-2026', method: 'cash' })).toThrow(/YYYY-MM-DD/);
    expect(() => addPayment(j, { amount: 100, date: '', method: 'cash' })).toThrow(/YYYY-MM-DD/);
    expect(() => addPayment(j, { amount: 100, date: 12345, method: 'cash' })).toThrow(/YYYY-MM-DD/);
    expect(() => addPayment(j, { amount: 100, date: '2099-12-31', method: 'cash' })).toThrow(/future/);
  });

  it('accepts today as a valid date (boundary)', () => {
    const result = addPayment(freshAwaitingJob(), { amount: 100, date: todayLocal(), method: 'cash' });
    expect(result.payments[0].date).toBe(todayLocal());
  });

  it('accepts each valid method', () => {
    for (const method of ['cash', 'bank', 'card', 'other', 'unknown']) {
      const result = addPayment(freshAwaitingJob(), { amount: 100, date: PAST_DATE, method });
      expect(result.payments[0].method).toBe(method);
    }
  });

  it('throws on invalid or missing method', () => {
    const j = freshAwaitingJob();
    expect(() => addPayment(j, { amount: 100, date: PAST_DATE, method: 'cheque' })).toThrow(/method/);
    expect(() => addPayment(j, { amount: 100, date: PAST_DATE, method: '' })).toThrow(/method/);
    expect(() => addPayment(j, { amount: 100, date: PAST_DATE })).toThrow(/method/);
  });

  it('throws when note is not a string', () => {
    const j = freshAwaitingJob();
    expect(() => addPayment(j, { amount: 100, date: PAST_DATE, method: 'cash', note: null })).toThrow(/note/);
    expect(() => addPayment(j, { amount: 100, date: PAST_DATE, method: 'cash', note: 42 })).toThrow(/note/);
  });

  it('throws when job is null/undefined/non-object', () => {
    expect(() => addPayment(null, { amount: 100, date: PAST_DATE, method: 'cash' })).toThrow(/job/);
    expect(() => addPayment(undefined, { amount: 100, date: PAST_DATE, method: 'cash' })).toThrow(/job/);
    expect(() => addPayment('hello', { amount: 100, date: PAST_DATE, method: 'cash' })).toThrow(/job/);
  });

  it('triggers auto-flip to paid when payment fully clears balance', () => {
    const job = freshAwaitingJob({ amount: 100 });
    const result = addPayment(job, { amount: 100, date: PAST_DATE, method: 'bank' });
    expect(result.status).toBe('paid');
    expect(result.paymentStatus).toBe('paid');
  });

  it('preserves awaiting state when payment is partial', () => {
    const result = addPayment(freshAwaitingJob({ amount: 250 }), { amount: 100, date: PAST_DATE, method: 'bank' });
    expect(result.status).toBe('awaiting');
    expect(result.paymentStatus).toBe('awaiting');
  });

  it('handles job with no payments field (treats as empty)', () => {
    const job = { id: 'j2', amount: 100, status: 'awaiting', paymentStatus: 'awaiting', invoiceSentAt: '2026-01-01T00:00:00Z' };
    const result = addPayment(job, { amount: 50, date: PAST_DATE, method: 'cash' });
    expect(result.payments).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('editPayment', () => {
  function jobWithOnePayment() {
    return freshAwaitingJob({
      payments: [
        { id: 'pay_seed', date: PAST_DATE, amount: 100, method: 'cash', note: '', createdAt: '2026-05-01T10:00:00Z' },
      ],
    });
  }

  it('updates amount and returns a new job', () => {
    const job = jobWithOnePayment();
    const result = editPayment(job, 'pay_seed', { amount: 150 });
    expect(result).not.toBe(job);
    expect(result.payments[0].amount).toBe(150);
    expect(job.payments[0].amount).toBe(100); // input untouched
  });

  it('updates date', () => {
    const result = editPayment(jobWithOnePayment(), 'pay_seed', { date: '2024-06-01' });
    expect(result.payments[0].date).toBe('2024-06-01');
  });

  it('updates method', () => {
    const result = editPayment(jobWithOnePayment(), 'pay_seed', { method: 'card' });
    expect(result.payments[0].method).toBe('card');
  });

  it('updates note', () => {
    const result = editPayment(jobWithOnePayment(), 'pay_seed', { note: 'Updated note' });
    expect(result.payments[0].note).toBe('Updated note');
  });

  it('supports multi-field updates in one call', () => {
    const result = editPayment(jobWithOnePayment(), 'pay_seed', { amount: 75, method: 'card', note: 'reduced' });
    expect(result.payments[0]).toMatchObject({ amount: 75, method: 'card', note: 'reduced' });
  });

  it('ignores attempts to mutate id or createdAt', () => {
    const result = editPayment(jobWithOnePayment(), 'pay_seed', { id: 'evil', createdAt: '1970-01-01T00:00:00Z' });
    expect(result.payments[0].id).toBe('pay_seed');
    expect(result.payments[0].createdAt).toBe('2026-05-01T10:00:00Z');
  });

  it('re-validates merged result and throws on invalid amount', () => {
    expect(() => editPayment(jobWithOnePayment(), 'pay_seed', { amount: -1 })).toThrow(/positive number/);
  });

  it('re-validates merged result and throws on future date', () => {
    expect(() => editPayment(jobWithOnePayment(), 'pay_seed', { date: '2099-01-01' })).toThrow(/future/);
  });

  it('throws when paymentId not found', () => {
    expect(() => editPayment(jobWithOnePayment(), 'pay_unknown', { amount: 50 })).toThrow(/not found/);
  });

  it('throws when paymentId is empty or missing', () => {
    expect(() => editPayment(jobWithOnePayment(), '', { amount: 50 })).toThrow(/paymentId/);
    expect(() => editPayment(jobWithOnePayment())).toThrow(/paymentId/);
  });

  it('handles undefined updates as no-op (still revalidates)', () => {
    const result = editPayment(jobWithOnePayment(), 'pay_seed', undefined);
    expect(result.payments[0]).toMatchObject({ amount: 100, method: 'cash' });
  });

  it('auto-flips to paid when edit brings balance to zero', () => {
    const job = freshAwaitingJob({
      amount: 200,
      payments: [{ id: 'pay_seed', date: PAST_DATE, amount: 100, method: 'cash', note: '', createdAt: '2026-05-01T10:00:00Z' }],
    });
    const result = editPayment(job, 'pay_seed', { amount: 200 });
    expect(result.status).toBe('paid');
  });

  it('auto-flips back to awaiting when edit pushes balance above zero on a paid job', () => {
    const job = {
      id: 'j1', amount: 200, status: 'paid', paymentStatus: 'paid',
      invoiceSentAt: '2026-05-01T10:00:00Z',
      payments: [{ id: 'pay_seed', date: PAST_DATE, amount: 200, method: 'cash', note: '', createdAt: '2026-05-01T10:00:00Z' }],
    };
    const result = editPayment(job, 'pay_seed', { amount: 100 });
    expect(result.status).toBe('awaiting');
    expect(result.paymentStatus).toBe('awaiting');
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('deletePayment', () => {
  function jobWithTwoPayments() {
    return freshAwaitingJob({
      amount: 300,
      payments: [
        { id: 'pay_a', date: PAST_DATE, amount: 100, method: 'cash', note: '', createdAt: '2026-05-01T10:00:00Z' },
        { id: 'pay_b', date: PAST_DATE, amount: 50, method: 'bank', note: '', createdAt: '2026-05-02T10:00:00Z' },
      ],
    });
  }

  it('removes the payment and returns a new job', () => {
    const job = jobWithTwoPayments();
    const result = deletePayment(job, 'pay_a');
    expect(result).not.toBe(job);
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0].id).toBe('pay_b');
    expect(job.payments).toHaveLength(2); // input untouched
  });

  it('throws when paymentId not found', () => {
    expect(() => deletePayment(jobWithTwoPayments(), 'pay_missing')).toThrow(/not found/);
  });

  it('throws when paymentId is empty or missing', () => {
    expect(() => deletePayment(jobWithTwoPayments(), '')).toThrow(/paymentId/);
    expect(() => deletePayment(jobWithTwoPayments())).toThrow(/paymentId/);
  });

  it('deleting last payment leaves an empty array', () => {
    const job = freshAwaitingJob({
      amount: 100,
      payments: [{ id: 'pay_only', date: PAST_DATE, amount: 50, method: 'cash', note: '', createdAt: '2026-05-01T10:00:00Z' }],
    });
    const result = deletePayment(job, 'pay_only');
    expect(result.payments).toEqual([]);
  });

  it('triggers auto-flip back to awaiting when delete pushes balance above zero on a paid job', () => {
    const job = {
      id: 'j1', amount: 200, status: 'paid', paymentStatus: 'paid',
      invoiceSentAt: '2026-05-01T10:00:00Z',
      payments: [{ id: 'pay_full', date: PAST_DATE, amount: 200, method: 'cash', note: '', createdAt: '2026-05-01T10:00:00Z' }],
    };
    const result = deletePayment(job, 'pay_full');
    expect(result.status).toBe('awaiting');
    expect(result.paymentStatus).toBe('awaiting');
  });

  it('throws when job is null/missing', () => {
    expect(() => deletePayment(null, 'pay_a')).toThrow(/job/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('computeAmountPaid', () => {
  it('sums amounts across all payments', () => {
    const job = freshAwaitingJob({
      payments: [
        { id: 'a', amount: 100, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' },
        { id: 'b', amount: 50, date: PAST_DATE, method: 'bank', note: '', createdAt: 'x' },
        { id: 'c', amount: 25, date: PAST_DATE, method: 'card', note: '', createdAt: 'x' },
      ],
    });
    expect(computeAmountPaid(job)).toBe(175);
  });

  it('returns 0 for empty payments array', () => {
    expect(computeAmountPaid(freshAwaitingJob({ payments: [] }))).toBe(0);
  });

  it('returns 0 when payments field is missing', () => {
    expect(computeAmountPaid({ id: 'j', amount: 100 })).toBe(0);
  });

  it('returns 0 when job is null/undefined', () => {
    expect(computeAmountPaid(null)).toBe(0);
    expect(computeAmountPaid(undefined)).toBe(0);
  });

  it('returns 0 when payments is not an array (defensive)', () => {
    expect(computeAmountPaid({ id: 'j', payments: 'malformed' })).toBe(0);
    expect(computeAmountPaid({ id: 'j', payments: null })).toBe(0);
  });

  it('handles decimal amounts', () => {
    const job = freshAwaitingJob({
      payments: [
        { id: 'a', amount: 10.50, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' },
        { id: 'b', amount: 20.25, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' },
      ],
    });
    expect(computeAmountPaid(job)).toBe(30.75);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('computeBalance', () => {
  it('returns amount minus amountPaid', () => {
    const job = freshAwaitingJob({
      amount: 250,
      payments: [{ id: 'a', amount: 100, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    });
    expect(computeBalance(job)).toBe(150);
  });

  it('returns full amount when no payments', () => {
    expect(computeBalance(freshAwaitingJob({ amount: 250 }))).toBe(250);
  });

  it('returns 0 when fully paid', () => {
    const job = freshAwaitingJob({
      amount: 100,
      payments: [{ id: 'a', amount: 100, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    });
    expect(computeBalance(job)).toBe(0);
  });

  it('returns negative when overpaid', () => {
    const job = freshAwaitingJob({
      amount: 100,
      payments: [{ id: 'a', amount: 150, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    });
    expect(computeBalance(job)).toBe(-50);
  });

  it('treats missing amount as 0', () => {
    const job = { id: 'j', payments: [{ id: 'a', amount: 50, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }] };
    expect(computeBalance(job)).toBe(-50);
  });

  it('returns 0 for null/undefined job', () => {
    expect(computeBalance(null)).toBe(0);
    expect(computeBalance(undefined)).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('isFullyPaid', () => {
  it('true when balance is exactly 0', () => {
    const job = freshAwaitingJob({
      amount: 100,
      payments: [{ id: 'a', amount: 100, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    });
    expect(isFullyPaid(job)).toBe(true);
  });

  it('true when overpaid (balance < 0)', () => {
    const job = freshAwaitingJob({
      amount: 100,
      payments: [{ id: 'a', amount: 150, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    });
    expect(isFullyPaid(job)).toBe(true);
  });

  it('false when balance > 0', () => {
    const job = freshAwaitingJob({
      amount: 100,
      payments: [{ id: 'a', amount: 50, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    });
    expect(isFullyPaid(job)).toBe(false);
  });

  it('false when no payments yet', () => {
    expect(isFullyPaid(freshAwaitingJob({ amount: 100 }))).toBe(false);
  });

  it('true when amount is 0 and no payments (edge: zero-amount job)', () => {
    expect(isFullyPaid({ id: 'j', amount: 0, payments: [] })).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('isOverpaid', () => {
  it('true when balance is strictly < 0', () => {
    const job = freshAwaitingJob({
      amount: 100,
      payments: [{ id: 'a', amount: 150, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    });
    expect(isOverpaid(job)).toBe(true);
  });

  it('false when balance is exactly 0 (paid in full, not overpaid)', () => {
    const job = freshAwaitingJob({
      amount: 100,
      payments: [{ id: 'a', amount: 100, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    });
    expect(isOverpaid(job)).toBe(false);
  });

  it('false when balance > 0 (partial)', () => {
    const job = freshAwaitingJob({
      amount: 100,
      payments: [{ id: 'a', amount: 50, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    });
    expect(isOverpaid(job)).toBe(false);
  });

  it('false when no payments', () => {
    expect(isOverpaid(freshAwaitingJob({ amount: 100 }))).toBe(false);
  });

  it('false when amount=0 and no payments (edge: zero-amount, zero-paid)', () => {
    expect(isOverpaid({ id: 'j', amount: 0, payments: [] })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('applyAutoFlip', () => {
  // Branch 1: isFullyPaid → 'paid' / 'paid'
  it('branch 1: flips to paid when fully paid (exact)', () => {
    const job = {
      id: 'j', amount: 100, status: 'awaiting', paymentStatus: 'awaiting',
      invoiceSentAt: '2026-05-01T00:00:00Z',
      payments: [{ id: 'a', amount: 100, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    };
    const result = applyAutoFlip(job);
    expect(result.status).toBe('paid');
    expect(result.paymentStatus).toBe('paid');
  });

  it('branch 1: flips to paid when overpaid', () => {
    const job = {
      id: 'j', amount: 100, status: 'awaiting', paymentStatus: 'awaiting',
      invoiceSentAt: '2026-05-01T00:00:00Z',
      payments: [{ id: 'a', amount: 200, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    };
    expect(applyAutoFlip(job).status).toBe('paid');
  });

  // Branch 2: was paid, balance > 0, invoiceSentAt → 'awaiting' / 'awaiting'
  it("branch 2: was paid + balance > 0 + invoiceSentAt → reverts to 'awaiting'", () => {
    const job = {
      id: 'j', amount: 200, status: 'paid', paymentStatus: 'paid',
      invoiceSentAt: '2026-05-01T00:00:00Z',
      payments: [{ id: 'a', amount: 50, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    };
    const result = applyAutoFlip(job);
    expect(result.status).toBe('awaiting');
    expect(result.paymentStatus).toBe('awaiting');
  });

  // Branch 3: was paid, balance > 0, NO invoiceSentAt → 'completed' / 'awaiting'
  // This is the regression test the spec called out by name: Mark-as-Paid
  // shortcut from completed, then delete the synthetic payment, status reverts
  // to 'completed' (not 'paid', not 'awaiting').
  it("branch 3: Mark-as-Paid shortcut from completed, then delete payment → status reverts to 'completed', paymentStatus to 'awaiting'", () => {
    // Setup: job in 'completed' state, no invoice ever sent. User taps
    // Mark-as-Paid shortcut → payment recorded for full amount → autoflip
    // sets status='paid'. We simulate the state AFTER that shortcut here.
    const afterShortcut = {
      id: 'j', amount: 250, status: 'paid', paymentStatus: 'paid',
      // intentionally NO invoiceSentAt — Mark-as-Paid shortcut was used
      // directly from 'completed' state without sending an invoice.
      payments: [
        { id: 'pay_shortcut', amount: 250, date: PAST_DATE, method: 'unknown', note: 'Marked paid via shortcut', createdAt: 'x' },
      ],
    };
    // Now user realises they shouldn't have marked paid yet — delete the entry.
    const afterDelete = deletePayment(afterShortcut, 'pay_shortcut');
    expect(afterDelete.status).toBe('completed');
    expect(afterDelete.paymentStatus).toBe('awaiting');
    expect(afterDelete.payments).toEqual([]);
  });

  // Branch 4: never paid, balance > 0 → return same reference (no change)
  it('branch 4: partial payment on never-paid job → returns same reference (no change)', () => {
    const job = {
      id: 'j', amount: 250, status: 'completed', paymentStatus: 'unpaid',
      payments: [{ id: 'a', amount: 100, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    };
    expect(applyAutoFlip(job)).toBe(job);
  });

  it('branch 4: same-reference return for awaiting + partial', () => {
    const job = freshAwaitingJob({
      amount: 250,
      payments: [{ id: 'a', amount: 100, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    });
    expect(applyAutoFlip(job)).toBe(job);
  });

  it('idempotent: applying twice yields the same result', () => {
    const job = {
      id: 'j', amount: 100, status: 'awaiting', paymentStatus: 'awaiting',
      invoiceSentAt: '2026-05-01T00:00:00Z',
      payments: [{ id: 'a', amount: 100, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    };
    const once = applyAutoFlip(job);
    const twice = applyAutoFlip(once);
    expect(twice).toEqual(once);
  });

  it('input job is not mutated (branches 1, 2, 3)', () => {
    const job1 = {
      id: 'j', amount: 100, status: 'awaiting', paymentStatus: 'awaiting',
      payments: [{ id: 'a', amount: 100, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    };
    applyAutoFlip(job1);
    expect(job1.status).toBe('awaiting'); // unchanged

    const job2 = {
      id: 'j', amount: 200, status: 'paid', paymentStatus: 'paid',
      invoiceSentAt: '2026-05-01T00:00:00Z',
      payments: [{ id: 'a', amount: 50, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    };
    applyAutoFlip(job2);
    expect(job2.status).toBe('paid'); // unchanged
  });

  it('wasPaid path triggered by status=paid alone (no paymentStatus)', () => {
    const job = {
      id: 'j', amount: 200, status: 'paid',
      // no paymentStatus, no invoiceSentAt
      payments: [{ id: 'a', amount: 50, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    };
    expect(applyAutoFlip(job).status).toBe('completed');
  });

  it('wasPaid path triggered by paymentStatus=paid alone (no status)', () => {
    const job = {
      id: 'j', amount: 200, paymentStatus: 'paid',
      invoiceSentAt: '2026-05-01T00:00:00Z',
      payments: [{ id: 'a', amount: 50, date: PAST_DATE, method: 'cash', note: '', createdAt: 'x' }],
    };
    expect(applyAutoFlip(job).status).toBe('awaiting');
  });
});
