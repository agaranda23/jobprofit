/**
 * Tests for netlify/functions/_lib/weeklyDigestCalc.js
 *
 * Pure computation — no mocks needed. All three exports are exercised:
 *   priorWeekRange    — correct Mon–Sun UTC boundaries
 *   computeWeekSummary — paidIn, jobCount, costs, overheads, trueProfit
 *   buildDigestMessage — message variants
 */

import { describe, it, expect } from 'vitest';
import {
  priorWeekRange,
  computeWeekSummary,
  buildDigestMessage,
} from '../_lib/weeklyDigestCalc.js';

// ─── A. priorWeekRange ────────────────────────────────────────────────────────

describe('A. priorWeekRange', () => {
  it('returns the prior Mon–Sun when called on a Monday', () => {
    // 2026-06-01 is a Monday
    const now = new Date('2026-06-01T08:00:00.000Z');
    const { start, end } = priorWeekRange(now);

    // Prior week: Mon 2026-05-25 → Sun 2026-05-31
    expect(start.toISOString()).toBe('2026-05-25T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-31T23:59:59.999Z');
  });

  it('returns the prior Mon–Sun when called on a Wednesday', () => {
    // 2026-06-03 is a Wednesday
    const now = new Date('2026-06-03T12:00:00.000Z');
    const { start, end } = priorWeekRange(now);

    expect(start.toISOString()).toBe('2026-05-25T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-31T23:59:59.999Z');
  });

  it('returns the prior Mon–Sun when called on a Sunday', () => {
    // 2026-05-31 is a Sunday — the function fires the prior Monday
    const now = new Date('2026-05-31T23:00:00.000Z');
    const { start, end } = priorWeekRange(now);

    // Current week started Mon 2026-05-25; prior week: Mon 2026-05-18 → Sun 2026-05-24
    expect(start.toISOString()).toBe('2026-05-18T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-24T23:59:59.999Z');
  });

  it('start is always a Monday (UTC day-of-week === 1)', () => {
    const nows = [
      new Date('2026-06-01T08:00:00.000Z'), // Mon
      new Date('2026-06-03T08:00:00.000Z'), // Wed
      new Date('2026-06-07T08:00:00.000Z'), // Sun
    ];
    for (const now of nows) {
      const { start } = priorWeekRange(now);
      expect(start.getUTCDay()).toBe(1); // 1 = Monday
    }
  });

  it('end is always a Sunday (UTC day-of-week === 0)', () => {
    const nows = [
      new Date('2026-06-01T08:00:00.000Z'),
      new Date('2026-06-05T08:00:00.000Z'),
    ];
    for (const now of nows) {
      const { end } = priorWeekRange(now);
      expect(end.getUTCDay()).toBe(0); // 0 = Sunday
    }
  });

  it('end is 1ms before midnight Sunday → Monday', () => {
    const now = new Date('2026-06-01T08:00:00.000Z');
    const { end } = priorWeekRange(now);
    // end should be Sunday 23:59:59.999 UTC
    expect(end.getUTCHours()).toBe(23);
    expect(end.getUTCMinutes()).toBe(59);
    expect(end.getUTCSeconds()).toBe(59);
    expect(end.getUTCMilliseconds()).toBe(999);
  });
});

// ─── B. computeWeekSummary ───────────────────────────────────────────────────

// Reference range: Mon 2026-05-25 → Sun 2026-05-31 UTC
const RANGE = {
  start: new Date('2026-05-25T00:00:00.000Z'),
  end:   new Date('2026-05-31T23:59:59.999Z'),
};

function paidJob(overrides = {}) {
  return {
    amount: 500,
    paid: true,
    payment_date: '2026-05-27', // Tuesday in range
    date: '2026-05-27',
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    amount: 100,
    date: '2026-05-26',
    ...overrides,
  };
}

describe('B. computeWeekSummary', () => {
  it('returns all-zero summary when there are no jobs', () => {
    const summary = computeWeekSummary([], [], [], RANGE);
    expect(summary.paidIn).toBe(0);
    expect(summary.jobCount).toBe(0);
    expect(summary.trueProfit).toBe(0);
    expect(summary.hasOverheads).toBe(false);
  });

  it('sums paid jobs in the range', () => {
    const jobs = [
      paidJob({ amount: 400 }),
      paidJob({ amount: 200 }),
    ];
    const { paidIn, jobCount } = computeWeekSummary(jobs, [], [], RANGE);
    expect(paidIn).toBe(600);
    expect(jobCount).toBe(2);
  });

  it('excludes unpaid jobs', () => {
    const jobs = [
      paidJob({ amount: 500 }),
      { amount: 300, paid: false, payment_date: '2026-05-27', date: '2026-05-27' },
    ];
    const { paidIn, jobCount } = computeWeekSummary(jobs, [], [], RANGE);
    expect(paidIn).toBe(500);
    expect(jobCount).toBe(1);
  });

  it('excludes jobs whose payment_date is before the range', () => {
    const outOfRange = paidJob({ payment_date: '2026-05-24' }); // Sunday before range
    const { paidIn, jobCount } = computeWeekSummary([outOfRange], [], [], RANGE);
    expect(paidIn).toBe(0);
    expect(jobCount).toBe(0);
  });

  it('excludes jobs whose payment_date is after the range', () => {
    const future = paidJob({ payment_date: '2026-06-01' }); // Monday after range
    const { paidIn, jobCount } = computeWeekSummary([future], [], [], RANGE);
    expect(paidIn).toBe(0);
    expect(jobCount).toBe(0);
  });

  it('includes jobs on exactly the start boundary (Monday)', () => {
    const job = paidJob({ payment_date: '2026-05-25' });
    const { jobCount } = computeWeekSummary([job], [], [], RANGE);
    expect(jobCount).toBe(1);
  });

  it('includes jobs on exactly the end boundary (Sunday)', () => {
    const job = paidJob({ payment_date: '2026-05-31' });
    const { jobCount } = computeWeekSummary([job], [], [], RANGE);
    expect(jobCount).toBe(1);
  });

  it('sums receipt costs in the range', () => {
    const jobs = [paidJob({ amount: 500 })];
    const receipts = [receipt({ amount: 80 }), receipt({ amount: 20 })];
    const { receiptCost } = computeWeekSummary(jobs, receipts, [], RANGE);
    expect(receiptCost).toBe(100);
  });

  it('excludes receipts outside the range', () => {
    const jobs = [paidJob({ amount: 500 })];
    const receipts = [
      receipt({ amount: 100, date: '2026-05-24' }), // before range
      receipt({ amount: 50, date: '2026-06-01' }),   // after range
    ];
    const { receiptCost } = computeWeekSummary(jobs, receipts, [], RANGE);
    expect(receiptCost).toBe(0);
  });

  it('computes weeklyOverhead from active overheads (monthly / 4.333)', () => {
    const overheads = [
      { amount: 433.3, is_active: true },
    ];
    const { weeklyOverhead, hasOverheads } = computeWeekSummary([], [], overheads, RANGE);
    // 433.3 / (365.25 / 12 / 7) ≈ 433.3 / 4.348 ≈ 99.66
    expect(weeklyOverhead).toBeCloseTo(433.3 / (365.25 / 12 / 7), 4);
    expect(hasOverheads).toBe(true);
  });

  it('skips inactive overheads', () => {
    const overheads = [
      { amount: 500, is_active: false },
      { amount: 200, is_active: true },
    ];
    const { weeklyOverhead } = computeWeekSummary([], [], overheads, RANGE);
    expect(weeklyOverhead).toBeCloseTo(200 / (365.25 / 12 / 7), 4);
  });

  it('trueProfit = paidIn - receiptCost - weeklyOverhead', () => {
    const jobs = [paidJob({ amount: 840 })];
    const receipts = [receipt({ amount: 40 })];
    const overheads = [{ amount: 200, is_active: true }];
    const { paidIn, receiptCost, weeklyOverhead, trueProfit } =
      computeWeekSummary(jobs, receipts, overheads, RANGE);

    expect(paidIn).toBe(840);
    expect(receiptCost).toBe(40);
    expect(trueProfit).toBeCloseTo(paidIn - receiptCost - weeklyOverhead, 6);
  });

  it('handles null/undefined gracefully', () => {
    const summary = computeWeekSummary(null, undefined, null, RANGE);
    expect(summary.paidIn).toBe(0);
    expect(summary.jobCount).toBe(0);
    expect(summary.hasOverheads).toBe(false);
  });

  it('falls back to job.date when payment_date is absent', () => {
    const job = { amount: 300, paid: true, date: '2026-05-28' }; // no payment_date
    const { jobCount } = computeWeekSummary([job], [], [], RANGE);
    expect(jobCount).toBe(1);
  });
});

// ─── C. buildDigestMessage ───────────────────────────────────────────────────

describe('C. buildDigestMessage', () => {
  it('returns the £ headline in the title', () => {
    const { title } = buildDigestMessage({
      paidIn: 840, jobCount: 6, trueProfit: 840, hasOverheads: false,
    });
    expect(title).toBe('You made £840 across 6 jobs last week');
  });

  it('uses "job" (singular) when jobCount is 1', () => {
    const { title } = buildDigestMessage({
      paidIn: 200, jobCount: 1, trueProfit: 200, hasOverheads: false,
    });
    expect(title).toContain('1 job last week');
    expect(title).not.toContain('1 jobs');
  });

  it('uses "jobs" (plural) when jobCount > 1', () => {
    const { title } = buildDigestMessage({
      paidIn: 600, jobCount: 3, trueProfit: 600, hasOverheads: false,
    });
    expect(title).toContain('3 jobs last week');
  });

  it('shows generic body when no overheads are set', () => {
    const { body } = buildDigestMessage({
      paidIn: 840, jobCount: 6, trueProfit: 800, hasOverheads: false,
    });
    expect(body).toBe('Tap to see your Money tab.');
  });

  it('shows true-profit body when overheads differ from paidIn by more than £1', () => {
    const { body } = buildDigestMessage({
      paidIn: 840, jobCount: 6, trueProfit: 720, hasOverheads: true,
    });
    expect(body).toContain('£720');
    expect(body).toContain('true profit');
  });

  it('shows generic body when overheads make difference <= £1 (rounding noise)', () => {
    const { body } = buildDigestMessage({
      paidIn: 840, jobCount: 6, trueProfit: 839.5, hasOverheads: true,
    });
    expect(body).toBe('Tap to see your Money tab.');
  });

  it('shows negative profit correctly', () => {
    const { body } = buildDigestMessage({
      paidIn: 100, jobCount: 2, trueProfit: -50, hasOverheads: true,
    });
    expect(body).toContain('-£50');
    expect(body).toContain('after costs');
  });

  it('formats pence correctly (no trailing .00)', () => {
    const { title } = buildDigestMessage({
      paidIn: 840, jobCount: 1, trueProfit: 840, hasOverheads: false,
    });
    expect(title).toContain('£840');
    expect(title).not.toContain('£840.00');
  });

  it('formats non-round pence correctly', () => {
    const { title } = buildDigestMessage({
      paidIn: 840.50, jobCount: 1, trueProfit: 840.50, hasOverheads: false,
    });
    expect(title).toContain('£840.50');
  });
});
