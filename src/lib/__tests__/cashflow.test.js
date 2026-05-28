import { describe, it, expect } from 'vitest';
import {
  monthKey,
  monthLabel,
  monthsAgo,
  buildDateRange,
  getCashflowByMonth,
  getMonthSummary,
  getOutstandingSummary,
  getProfitPerHour,
  getMarginTrend,
  getOverheadTotal,
  taxYearStart,
  taxYearLabel,
  getTaxYearSummary,
  getJobProfit,
  getBestWorstJobs,
} from '../cashflow.js';

// ─── Fixture builders ────────────────────────────────────────────────────────

// Cloud-shape job (mapCloudJobToToday output from store.js)
function cloudJob(overrides = {}) {
  return {
    id: 'uuid-cloud-1',
    name: 'Sarah Mitchell',
    customer: 'Sarah Mitchell',
    amount: 500,
    paid: true,
    date: '2026-03-10',
    createdAt: '2026-03-10T09:00:00.000Z',
    payments: [],
    cloud: true,
    ...overrides,
  };
}

// Legacy-shape job (addTodayJob output from store.js)
function legacyJob(overrides = {}) {
  return {
    id: 'J-0001',
    customer: 'Dave Builders',
    summary: 'Bathroom refit',
    total: 800,
    amount: 800,
    paymentStatus: 'paid',
    paymentDate: '2026-03-15',
    date: '2026-03-15',
    createdAt: '2026-03-15T10:00:00.000Z',
    ...overrides,
  };
}

// Open/unpaid job (cloud shape)
function openJob(overrides = {}) {
  return {
    id: 'uuid-open-1',
    name: 'Tom Roofing',
    customer: 'Tom Roofing',
    amount: 1200,
    paid: false,
    date: '2026-03-20',
    createdAt: '2026-03-20T09:00:00.000Z',
    payments: [],
    cloud: true,
    ...overrides,
  };
}

// Receipt fixture
function receipt(overrides = {}) {
  return {
    id: 'rcpt-1',
    label: 'Screwfix',
    amount: 120,
    date: '2026-03-12',
    createdAt: '2026-03-12T08:00:00.000Z',
    ...overrides,
  };
}

// Date helpers for range building
const FROM_MAR = new Date(2026, 2, 1); // 2026-03-01
const TO_MAR = new Date(2026, 2, 31);  // 2026-03-31
const FROM_FEB = new Date(2026, 1, 1); // 2026-02-01
const TO_MAR_END = new Date(2026, 2, 31);

// ─── monthKey ────────────────────────────────────────────────────────────────

describe('monthKey', () => {
  it('returns YYYY-MM for a given date', () => {
    expect(monthKey(new Date(2026, 2, 15))).toBe('2026-03');
  });

  it('pads single-digit months', () => {
    expect(monthKey(new Date(2026, 0, 1))).toBe('2026-01');
  });

  it('handles year rollover: December → next year', () => {
    expect(monthKey(new Date(2025, 11, 31))).toBe('2025-12');
    expect(monthKey(new Date(2026, 0, 1))).toBe('2026-01');
  });

  it('returns empty string for invalid/null input', () => {
    expect(monthKey(null)).toBe('');
    expect(monthKey(undefined)).toBe('');
    expect(monthKey(new Date('invalid'))).toBe('');
  });
});

// ─── monthLabel ──────────────────────────────────────────────────────────────

describe('monthLabel', () => {
  it('returns human-readable label for a YYYY-MM key', () => {
    const label = monthLabel('2026-03');
    expect(label).toMatch(/Mar.*2026/);
  });

  it('returns the key unchanged for malformed input', () => {
    expect(monthLabel('')).toBe('');
    expect(monthLabel(null)).toBe('');
  });
});

// ─── monthsAgo ───────────────────────────────────────────────────────────────

describe('monthsAgo', () => {
  it('returns the first day of the month 1 month back', () => {
    const ref = new Date(2026, 2, 15); // 2026-03-15
    const result = monthsAgo(1, ref);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(1);
  });

  it('returns the first day of the month 6 months back', () => {
    const ref = new Date(2026, 5, 1); // 2026-06-01
    const result = monthsAgo(6, ref);
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(11); // December 2025
    expect(result.getDate()).toBe(1);
  });

  it('rolls back across year boundary correctly', () => {
    const ref = new Date(2026, 1, 28); // 2026-02-28
    const result = monthsAgo(3, ref);
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(10); // November 2025
    expect(result.getDate()).toBe(1);
  });

  it('boundary: called on the first day of a month returns first day of prior month', () => {
    const ref = new Date(2026, 2, 1); // 2026-03-01
    const result = monthsAgo(1, ref);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(1);
  });

  it('monthsBack=0 returns first day of current month', () => {
    const ref = new Date(2026, 2, 20);
    const result = monthsAgo(0, ref);
    expect(result.getMonth()).toBe(2);
    expect(result.getDate()).toBe(1);
  });
});

// ─── buildDateRange ──────────────────────────────────────────────────────────

describe('buildDateRange', () => {
  const ref = new Date(2026, 2, 15); // 2026-03-15

  it('1M returns from=this-month-start to=this-month-end', () => {
    const { from, to } = buildDateRange('1M', ref);
    expect(monthKey(from)).toBe('2026-03');
    expect(monthKey(to)).toBe('2026-03');
  });

  it('3M returns 3 months including current', () => {
    const { from, to } = buildDateRange('3M', ref);
    expect(monthKey(from)).toBe('2026-01');
    expect(monthKey(to)).toBe('2026-03');
  });

  it('6M returns 6 months including current', () => {
    const { from, to } = buildDateRange('6M', ref);
    expect(monthKey(from)).toBe('2025-10');
    expect(monthKey(to)).toBe('2026-03');
  });

  it('1Y returns 12 months including current', () => {
    const { from, to } = buildDateRange('1Y', ref);
    expect(monthKey(from)).toBe('2025-04');
    expect(monthKey(to)).toBe('2026-03');
  });

  it('unknown range key defaults to 6M', () => {
    const { from, to } = buildDateRange('CUSTOM', ref);
    expect(monthKey(from)).toBe('2025-10');
    expect(monthKey(to)).toBe('2026-03');
  });
});

// ─── getCashflowByMonth ───────────────────────────────────────────────────────

describe('getCashflowByMonth', () => {
  it('empty data returns month buckets with all-zero values (not undefined/NaN/throws)', () => {
    const result = getCashflowByMonth([], [], FROM_MAR, TO_MAR);
    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.month).toBe('2026-03');
    expect(row.paid).toBe(0);
    expect(row.open).toBe(0);
    expect(row.cost).toBe(0);
    expect(row.profit).toBe(0);
    expect(row.cashIn).toBe(0);
    expect(row.cashOut).toBe(0);
    expect(row.total).toBe(0);
    // No NaN anywhere
    for (const v of Object.values(row)) {
      if (typeof v === 'number') expect(isNaN(v)).toBe(false);
    }
  });

  it('null/undefined arrays do not throw (defensive)', () => {
    expect(() => getCashflowByMonth(null, null, FROM_MAR, TO_MAR)).not.toThrow();
    expect(() => getCashflowByMonth(undefined, undefined, FROM_MAR, TO_MAR)).not.toThrow();
  });

  it('single-month happy path: paid job buckets into correct month', () => {
    const jobs = [cloudJob({ amount: 500, date: '2026-03-10', paid: true })];
    const result = getCashflowByMonth(jobs, [], FROM_MAR, TO_MAR);
    expect(result).toHaveLength(1);
    expect(result[0].paid).toBe(500);
    expect(result[0].open).toBe(0);
  });

  it('single-month happy path: open job buckets into correct month', () => {
    const jobs = [openJob({ amount: 1200, date: '2026-03-20' })];
    const result = getCashflowByMonth(jobs, [], FROM_MAR, TO_MAR);
    expect(result[0].open).toBe(1200);
    expect(result[0].paid).toBe(0);
  });

  it('multi-month happy path: jobs spread across Feb and Mar', () => {
    const jobs = [
      cloudJob({ amount: 500, date: '2026-02-10', paid: true }),
      cloudJob({ id: 'c2', amount: 800, date: '2026-03-05', paid: true }),
      openJob({ amount: 300, date: '2026-02-20' }),
    ];
    const result = getCashflowByMonth(jobs, [], FROM_FEB, TO_MAR_END);
    expect(result).toHaveLength(2);
    const feb = result.find(r => r.month === '2026-02');
    const mar = result.find(r => r.month === '2026-03');
    expect(feb.paid).toBe(500);
    expect(feb.open).toBe(300);
    expect(mar.paid).toBe(800);
    expect(mar.open).toBe(0);
  });

  it('profit = paid - cost per month', () => {
    const jobs = [cloudJob({ amount: 1000, date: '2026-03-10', paid: true })];
    const receipts = [receipt({ amount: 200, date: '2026-03-12' })];
    const result = getCashflowByMonth(jobs, receipts, FROM_MAR, TO_MAR);
    expect(result[0].profit).toBe(800);
    expect(result[0].cost).toBe(200);
  });

  it('months with no activity are still present (all zeros)', () => {
    const jobs = [cloudJob({ amount: 500, date: '2026-01-10', paid: true })];
    const from = new Date(2026, 0, 1);  // Jan
    const to = new Date(2026, 2, 31);   // Mar
    const result = getCashflowByMonth(jobs, [], from, to);
    expect(result).toHaveLength(3);
    const feb = result.find(r => r.month === '2026-02');
    expect(feb.paid).toBe(0);
    expect(feb.open).toBe(0);
    expect(feb.cost).toBe(0);
  });

  it('year-boundary: Dec 2025 → Jan 2026 rolls correctly', () => {
    const from = new Date(2025, 11, 1); // Dec 2025
    const to = new Date(2026, 0, 31);   // Jan 2026
    const jobs = [
      cloudJob({ amount: 400, date: '2025-12-20', paid: true }),
      cloudJob({ id: 'c2', amount: 600, date: '2026-01-05', paid: true }),
    ];
    const result = getCashflowByMonth(jobs, [], from, to);
    expect(result).toHaveLength(2);
    expect(result[0].month).toBe('2025-12');
    expect(result[0].paid).toBe(400);
    expect(result[1].month).toBe('2026-01');
    expect(result[1].paid).toBe(600);
  });

  // Cloud-shape job
  it('cloud-shape job (paid: boolean) buckets correctly', () => {
    const jobs = [cloudJob({ amount: 750, paid: true, date: '2026-03-08' })];
    const result = getCashflowByMonth(jobs, [], FROM_MAR, TO_MAR);
    expect(result[0].paid).toBe(750);
  });

  // Legacy-shape job
  it('legacy-shape job (paymentStatus: "paid") buckets correctly', () => {
    const jobs = [legacyJob({ amount: 800, paymentStatus: 'paid', paymentDate: '2026-03-15', date: '2026-03-15' })];
    const result = getCashflowByMonth(jobs, [], FROM_MAR, TO_MAR);
    expect(result[0].paid).toBe(800);
  });

  // Mixed cloud + legacy
  it('mixed cloud + legacy in same dataset both bucket correctly', () => {
    const jobs = [
      cloudJob({ amount: 500, paid: true, date: '2026-03-10' }),
      legacyJob({ amount: 300, paymentStatus: 'paid', paymentDate: '2026-03-12', date: '2026-03-12' }),
    ];
    const result = getCashflowByMonth(jobs, [], FROM_MAR, TO_MAR);
    expect(result[0].paid).toBe(800);
  });

  // Partial-payment job (jobMeta.payments[] present)
  it('partial-payment job: sums payments[] not job.amount', () => {
    const job = openJob({
      amount: 1000,
      paid: false,
      paymentStatus: 'awaiting',
      payments: [
        { id: 'pay_1', amount: 400, date: '2026-03-05', method: 'bank', note: '', createdAt: '2026-03-05T10:00:00Z' },
      ],
    });
    // This job is still open (balance = 600), so it goes into open bucket
    const result = getCashflowByMonth([job], [], FROM_MAR, TO_MAR);
    // open bucket: outstanding = 1000 - 400 = 600
    expect(result[0].open).toBe(600);
    expect(result[0].paid).toBe(0);
  });

  // Overpaid job treated as paid
  it('overpaid job (balance < 0 via payments[]) is treated as paid', () => {
    const job = cloudJob({
      amount: 500,
      paid: true,
      payments: [
        { id: 'pay_1', amount: 600, date: '2026-03-10', method: 'bank', note: '', createdAt: '2026-03-10T10:00:00Z' },
      ],
    });
    const result = getCashflowByMonth([job], [], FROM_MAR, TO_MAR);
    // paid amount = sum of payments = 600 (not double-counted from amount)
    expect(result[0].paid).toBe(600);
    expect(result[0].open).toBe(0);
  });

  // Future-dated invoice excluded from paid
  it('future-dated paid job is excluded from paid bucket', () => {
    const futureDate = '2099-12-31';
    const jobs = [cloudJob({ amount: 999, paid: true, date: futureDate })];
    const from = new Date(2099, 11, 1);
    const to = new Date(2099, 11, 31);
    const result = getCashflowByMonth(jobs, [], from, to);
    expect(result[0].paid).toBe(0);
  });

  // Cancelled job excluded
  it('cancelled job is excluded from all buckets', () => {
    const jobs = [
      cloudJob({ amount: 999, paid: false, status: 'cancelled', paymentStatus: 'cancelled' }),
    ];
    const result = getCashflowByMonth(jobs, [], FROM_MAR, TO_MAR);
    expect(result[0].open).toBe(0);
    expect(result[0].paid).toBe(0);
  });

  // Draft job excluded
  it('draft job is excluded from all buckets', () => {
    const jobs = [
      cloudJob({ amount: 500, paid: false, status: 'draft' }),
    ];
    const result = getCashflowByMonth(jobs, [], FROM_MAR, TO_MAR);
    expect(result[0].open).toBe(0);
  });

  // Receipt with no date fallback to createdAt
  it('receipt with no date field falls back to createdAt for bucketing', () => {
    const r = { id: 'r1', amount: 75, createdAt: '2026-03-14T10:00:00.000Z' };
    const result = getCashflowByMonth([], [r], FROM_MAR, TO_MAR);
    expect(result[0].cost).toBe(75);
  });

  // Mode: paid-vs-open
  it('mode=paid-vs-open sets total = paid + open', () => {
    const jobs = [
      cloudJob({ amount: 500, paid: true, date: '2026-03-10' }),
      openJob({ amount: 300, date: '2026-03-15' }),
    ];
    const result = getCashflowByMonth(jobs, [], FROM_MAR, TO_MAR, 'paid-vs-open');
    expect(result[0].total).toBe(800);
  });

  // Mode: profit-vs-cost
  it('mode=profit-vs-cost sets total = paid (revenue for scale)', () => {
    const jobs = [cloudJob({ amount: 1000, paid: true, date: '2026-03-10' })];
    const receipts = [receipt({ amount: 300, date: '2026-03-12' })];
    const result = getCashflowByMonth(jobs, receipts, FROM_MAR, TO_MAR, 'profit-vs-cost');
    expect(result[0].profit).toBe(700);
    expect(result[0].cost).toBe(300);
    expect(result[0].total).toBe(1000); // paid used as scale reference
  });

  // Mode: cash-in-vs-out
  it('mode=cash-in-vs-out: cashIn=paid, cashOut=cost, total=paid+cost', () => {
    const jobs = [cloudJob({ amount: 800, paid: true, date: '2026-03-10' })];
    const receipts = [receipt({ amount: 200, date: '2026-03-12' })];
    const result = getCashflowByMonth(jobs, receipts, FROM_MAR, TO_MAR, 'cash-in-vs-out');
    expect(result[0].cashIn).toBe(800);
    expect(result[0].cashOut).toBe(200);
    expect(result[0].total).toBe(1000);
  });

  it('all output rows have the monthLabel field populated', () => {
    const from = new Date(2026, 1, 1);
    const to = new Date(2026, 2, 31);
    const result = getCashflowByMonth([], [], from, to);
    for (const row of result) {
      expect(typeof row.monthLabel).toBe('string');
      expect(row.monthLabel.length).toBeGreaterThan(0);
    }
  });
});

// ─── getMonthSummary ─────────────────────────────────────────────────────────

describe('getMonthSummary', () => {
  it('empty data returns all-zero result', () => {
    const result = getMonthSummary([], [], { month: '2026-03' });
    expect(result).toEqual({ profit: 0, paid: 0, outstanding: 0, jobCount: 0 });
  });

  it('returns correct paid and profit for a paid job in the target month', () => {
    const jobs = [cloudJob({ amount: 1000, paid: true, date: '2026-03-10' })];
    const receipts = [receipt({ amount: 200, date: '2026-03-12' })];
    const result = getMonthSummary(jobs, receipts, { month: '2026-03' });
    expect(result.paid).toBe(1000);
    expect(result.profit).toBe(800);
    expect(result.jobCount).toBe(1);
  });

  it('returns outstanding for unpaid job in target month', () => {
    const jobs = [openJob({ amount: 600, date: '2026-03-20' })];
    const result = getMonthSummary(jobs, [], { month: '2026-03' });
    expect(result.outstanding).toBe(600);
    expect(result.jobCount).toBe(1);
  });

  it('ignores jobs in other months', () => {
    const jobs = [cloudJob({ amount: 500, paid: true, date: '2026-02-10' })];
    const result = getMonthSummary(jobs, [], { month: '2026-03' });
    expect(result.paid).toBe(0);
    expect(result.jobCount).toBe(0);
  });

  it('defaults to current month when month option is omitted', () => {
    // Just ensure it returns a shape without throwing
    const result = getMonthSummary([], []);
    expect(typeof result.profit).toBe('number');
    expect(typeof result.paid).toBe('number');
  });
});

// ─── getOutstandingSummary ───────────────────────────────────────────────────

describe('getOutstandingSummary', () => {
  it('empty array returns all-zero/null result', () => {
    const result = getOutstandingSummary([]);
    expect(result.totalOwed).toBe(0);
    expect(result.invoiceCount).toBe(0);
    expect(result.oldestAgeDays).toBeNull();
    expect(result.oldestCustomerName).toBeNull();
    expect(result.oldestJobId).toBeNull();
  });

  it('returns correct total owed across multiple open jobs', () => {
    const jobs = [
      openJob({ amount: 500 }),
      openJob({ id: 'u2', amount: 300, name: 'Another Client' }),
    ];
    const result = getOutstandingSummary(jobs);
    expect(result.totalOwed).toBe(800);
    expect(result.invoiceCount).toBe(2);
  });

  it('excludes paid jobs from outstanding total', () => {
    const jobs = [
      cloudJob({ amount: 999, paid: true, date: '2026-03-10' }),
      openJob({ amount: 400 }),
    ];
    const result = getOutstandingSummary(jobs);
    expect(result.totalOwed).toBe(400);
    expect(result.invoiceCount).toBe(1);
  });

  it('excludes cancelled jobs', () => {
    const jobs = [
      openJob({ amount: 999, status: 'cancelled' }),
    ];
    const result = getOutstandingSummary(jobs);
    expect(result.totalOwed).toBe(0);
  });

  it('identifies the oldest unpaid job correctly', () => {
    const olderDate = '2026-01-10';
    const newerDate = '2026-03-15';
    const jobs = [
      openJob({ id: 'newer', amount: 300, date: newerDate, createdAt: `${newerDate}T09:00:00.000Z` }),
      openJob({ id: 'older', amount: 500, name: 'Old Client', date: olderDate, createdAt: `${olderDate}T09:00:00.000Z` }),
    ];
    const result = getOutstandingSummary(jobs);
    expect(result.oldestJobId).toBe('older');
    expect(result.oldestCustomerName).toBe('Old Client');
    expect(result.oldestAgeDays).toBeGreaterThan(0);
  });

  it('oldestAgeDays is a non-negative integer', () => {
    const jobs = [openJob({ date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' })];
    const result = getOutstandingSummary(jobs);
    expect(Number.isInteger(result.oldestAgeDays)).toBe(true);
    expect(result.oldestAgeDays).toBeGreaterThanOrEqual(0);
  });

  it('partial-payment job contributes outstanding balance, not full amount', () => {
    const job = openJob({
      amount: 1000,
      paid: false,
      paymentStatus: 'awaiting',
      payments: [
        { id: 'pay_1', amount: 400, date: '2026-03-05', method: 'bank', note: '', createdAt: '2026-03-05T10:00:00Z' },
      ],
    });
    const result = getOutstandingSummary([job]);
    expect(result.totalOwed).toBe(600);
  });
});

// ─── getProfitPerHour ────────────────────────────────────────────────────────

describe('getProfitPerHour', () => {
  // Fixed reference: Monday 2026-03-16 (a Monday)
  const REF = new Date(2026, 2, 16, 12, 0, 0);

  it('returns null values when hourlyRate is 0', () => {
    const result = getProfitPerHour([cloudJob()], { hourlyRate: 0 }, REF);
    expect(result.value).toBeNull();
    expect(result.comparisonValue).toBeNull();
    expect(result.deltaSign).toBeNull();
  });

  it('returns null values when hourlyRate is null/undefined', () => {
    const r1 = getProfitPerHour([cloudJob()], { hourlyRate: null }, REF);
    const r2 = getProfitPerHour([cloudJob()], {}, REF);
    expect(r1.value).toBeNull();
    expect(r2.value).toBeNull();
  });

  it('does not return NaN or Infinity for any valid input', () => {
    const jobs = [cloudJob({ amount: 400, paid: true, date: '2026-03-16' })];
    const result = getProfitPerHour(jobs, { hourlyRate: 25 }, REF);
    if (result.value !== null) {
      expect(isNaN(result.value)).toBe(false);
      expect(isFinite(result.value)).toBe(true);
    }
  });

  it('returns null value when no paid jobs exist this week', () => {
    // No jobs in the current week
    const jobs = [cloudJob({ amount: 400, paid: true, date: '2025-01-10' })];
    const result = getProfitPerHour(jobs, { hourlyRate: 30 }, REF);
    expect(result.value).toBeNull();
  });

  it('computes a positive value when there are paid jobs this week', () => {
    const jobs = [cloudJob({ amount: 300, paid: true, date: '2026-03-16' })];
    const result = getProfitPerHour(jobs, { hourlyRate: 30 }, REF);
    // implied hours = 300 / 30 = 10; profit = 300 (no costs); pph = 30
    expect(result.value).toBeCloseTo(30, 1);
  });

  it('deltaSign is "up" when this week > last week', () => {
    // pph = (amount - expenses) / (amount / rate)
    // Without job.expenses[], pph always equals the hourly rate (no difference).
    // Add expenses to the last-week job to lower its pph.
    // This week: job £1000, no expenses → pph = 25
    // Last week: job £1000, expenses £500 → profit £500, implied hrs = 40 → pph = 12.5
    const jobs = [
      cloudJob({ id: 'tw', amount: 1000, paid: true, date: '2026-03-16',
        createdAt: '2026-03-16T10:00:00Z', expenses: [] }),
      cloudJob({ id: 'lw', amount: 1000, paid: true, date: '2026-03-09',
        createdAt: '2026-03-09T10:00:00Z',
        expenses: [{ id: 'e1', amount: 500 }] }),
    ];
    const result = getProfitPerHour(jobs, { hourlyRate: 25 }, REF);
    expect(result.deltaSign).toBe('up');
  });

  it('deltaSign is "down" when this week < last week', () => {
    // This week: job £1000, expenses £500 → pph = 12.5
    // Last week: job £1000, no expenses → pph = 25
    const jobs = [
      cloudJob({ id: 'tw', amount: 1000, paid: true, date: '2026-03-16',
        createdAt: '2026-03-16T10:00:00Z',
        expenses: [{ id: 'e1', amount: 500 }] }),
      cloudJob({ id: 'lw', amount: 1000, paid: true, date: '2026-03-09',
        createdAt: '2026-03-09T10:00:00Z', expenses: [] }),
    ];
    const result = getProfitPerHour(jobs, { hourlyRate: 25 }, REF);
    expect(result.deltaSign).toBe('down');
  });

  it('deltaSign is null when one week has no data', () => {
    const jobs = [
      cloudJob({ id: 'tw', amount: 300, paid: true, date: '2026-03-16', createdAt: '2026-03-16T10:00:00Z' }),
    ];
    const result = getProfitPerHour(jobs, { hourlyRate: 30 }, REF);
    // lastWeek has no jobs → comparisonValue = null
    expect(result.comparisonValue).toBeNull();
    expect(result.deltaSign).toBeNull();
  });

  it('empty job array returns all null', () => {
    const result = getProfitPerHour([], { hourlyRate: 30 }, REF);
    expect(result.value).toBeNull();
    expect(result.comparisonValue).toBeNull();
    expect(result.deltaSign).toBeNull();
  });

  it('excludes excluded (cancelled) jobs', () => {
    const jobs = [
      cloudJob({ id: 'c', amount: 9999, paid: true, status: 'cancelled', date: '2026-03-16' }),
    ];
    const result = getProfitPerHour(jobs, { hourlyRate: 30 }, REF);
    expect(result.value).toBeNull();
  });
});

// ─── getMarginTrend ──────────────────────────────────────────────────────────

describe('getMarginTrend', () => {
  // REF: Monday 2026-03-16
  const REF = new Date(2026, 2, 16, 12, 0, 0);

  it('empty data returns all zeros and "flat"', () => {
    const result = getMarginTrend([], [], {}, REF);
    expect(result.thisWeek).toBe(0);
    expect(result.lastWeek).toBe(0);
    expect(result.deltaPct).toBe(0);
    expect(result.deltaSign).toBe('flat');
  });

  it('returns 100% margin when there are no costs', () => {
    const jobs = [cloudJob({ amount: 500, paid: true, date: '2026-03-16' })];
    const result = getMarginTrend(jobs, [], {}, REF);
    expect(result.thisWeek).toBeCloseTo(100, 1);
  });

  it('returns correct margin when costs exist', () => {
    const jobs = [cloudJob({ amount: 1000, paid: true, date: '2026-03-16' })];
    const receipts = [receipt({ amount: 300, date: '2026-03-16' })];
    const result = getMarginTrend(jobs, receipts, {}, REF);
    // margin = (1000 - 300) / 1000 * 100 = 70%
    expect(result.thisWeek).toBeCloseTo(70, 1);
  });

  it('deltaSign is "up" when this week margin is higher than last', () => {
    const jobs = [
      cloudJob({ id: 'tw', amount: 1000, paid: true, date: '2026-03-16' }),
      cloudJob({ id: 'lw', amount: 1000, paid: true, date: '2026-03-09' }),
    ];
    const receipts = [
      receipt({ id: 'r_tw', amount: 100, date: '2026-03-16' }), // 90% margin this week
      receipt({ id: 'r_lw', amount: 500, date: '2026-03-09' }), // 50% margin last week
    ];
    const result = getMarginTrend(jobs, receipts, {}, REF);
    expect(result.deltaSign).toBe('up');
  });

  it('deltaSign is "down" when this week margin is lower than last', () => {
    const jobs = [
      cloudJob({ id: 'tw', amount: 1000, paid: true, date: '2026-03-16' }),
      cloudJob({ id: 'lw', amount: 1000, paid: true, date: '2026-03-09' }),
    ];
    const receipts = [
      receipt({ id: 'r_tw', amount: 700, date: '2026-03-16' }), // 30% margin this week
      receipt({ id: 'r_lw', amount: 100, date: '2026-03-09' }), // 90% margin last week
    ];
    const result = getMarginTrend(jobs, receipts, {}, REF);
    expect(result.deltaSign).toBe('down');
  });

  it('deltaSign is "flat" when margins are equal', () => {
    const jobs = [
      cloudJob({ id: 'tw', amount: 1000, paid: true, date: '2026-03-16' }),
      cloudJob({ id: 'lw', amount: 1000, paid: true, date: '2026-03-09' }),
    ];
    const receipts = [
      receipt({ id: 'r_tw', amount: 200, date: '2026-03-16' }),
      receipt({ id: 'r_lw', amount: 200, date: '2026-03-09' }),
    ];
    const result = getMarginTrend(jobs, receipts, {}, REF);
    expect(result.deltaSign).toBe('flat');
  });

  it('no paid jobs this week returns 0% this-week margin', () => {
    const jobs = [
      cloudJob({ id: 'lw', amount: 1000, paid: true, date: '2026-03-09' }),
    ];
    const result = getMarginTrend(jobs, [], {}, REF);
    expect(result.thisWeek).toBe(0);
  });

  it('deltaPct sign matches deltaSign direction', () => {
    const jobs = [
      cloudJob({ id: 'tw', amount: 1000, paid: true, date: '2026-03-16' }),
      cloudJob({ id: 'lw', amount: 1000, paid: true, date: '2026-03-09' }),
    ];
    const receipts = [
      receipt({ id: 'r_tw', amount: 100, date: '2026-03-16' }),
      receipt({ id: 'r_lw', amount: 600, date: '2026-03-09' }),
    ];
    const result = getMarginTrend(jobs, receipts, {}, REF);
    expect(result.deltaSign).toBe('up');
    expect(result.deltaPct).toBeGreaterThan(0);
  });

  it('excludes cancelled jobs from margin calculation', () => {
    const jobs = [
      cloudJob({ id: 'tw', amount: 1000, paid: true, date: '2026-03-16' }),
      cloudJob({ id: 'cancelled', amount: 9999, paid: true, status: 'cancelled', date: '2026-03-16' }),
    ];
    const result = getMarginTrend(jobs, [], {}, REF);
    // Only the 1000 job counts; margin should be 100% (no receipts)
    expect(result.thisWeek).toBeCloseTo(100, 1);
  });
});

// ─── getOverheadTotal ────────────────────────────────────────────────────────

describe('getOverheadTotal', () => {
  it('returns 0 for an empty array', () => {
    expect(getOverheadTotal([])).toBe(0);
  });

  it('returns 0 for null input (null-safe)', () => {
    expect(getOverheadTotal(null)).toBe(0);
  });

  it('returns 0 for undefined input (null-safe)', () => {
    expect(getOverheadTotal(undefined)).toBe(0);
  });

  it('returns 0 for a non-array value', () => {
    expect(getOverheadTotal('not-an-array')).toBe(0);
    expect(getOverheadTotal(42)).toBe(0);
    expect(getOverheadTotal({})).toBe(0);
  });

  it('sums all active items when all are active', () => {
    const overheads = [
      { id: '1', name: 'Van', amount: 450, category: 'Vehicle', is_active: true },
      { id: '2', name: 'Insurance', amount: 280, category: 'Insurance', is_active: true },
      { id: '3', name: 'Phone', amount: 45, category: 'Phone', is_active: true },
    ];
    expect(getOverheadTotal(overheads)).toBe(775);
  });

  it('excludes items where is_active is explicitly false', () => {
    const overheads = [
      { id: '1', name: 'Van', amount: 450, is_active: true },
      { id: '2', name: 'Insurance', amount: 280, is_active: false },
      { id: '3', name: 'Phone', amount: 45, is_active: true },
    ];
    // Only 450 + 45 = 495
    expect(getOverheadTotal(overheads)).toBe(495);
  });

  it('treats is_active undefined as active (opt-out model)', () => {
    const overheads = [
      { id: '1', name: 'Van', amount: 300 }, // no is_active field → treated as active
      { id: '2', name: 'Phone', amount: 50, is_active: undefined },
    ];
    expect(getOverheadTotal(overheads)).toBe(350);
  });

  it('treats is_active null as active (opt-out model)', () => {
    const overheads = [{ id: '1', name: 'Van', amount: 200, is_active: null }];
    expect(getOverheadTotal(overheads)).toBe(200);
  });

  it('ignores non-numeric amounts (treats as 0)', () => {
    const overheads = [
      { id: '1', name: 'Bad', amount: 'not-a-number', is_active: true },
      { id: '2', name: 'Good', amount: 100, is_active: true },
    ];
    expect(getOverheadTotal(overheads)).toBe(100);
  });

  it('handles decimal amounts correctly', () => {
    const overheads = [
      { id: '1', amount: 99.99, is_active: true },
      { id: '2', amount: 0.01, is_active: true },
    ];
    expect(getOverheadTotal(overheads)).toBeCloseTo(100, 5);
  });

  it('returns 0 when all items are inactive', () => {
    const overheads = [
      { id: '1', amount: 500, is_active: false },
      { id: '2', amount: 200, is_active: false },
    ];
    expect(getOverheadTotal(overheads)).toBe(0);
  });

  it('skips null/undefined items in the array without throwing', () => {
    const overheads = [
      null,
      undefined,
      { id: '1', amount: 100, is_active: true },
    ];
    expect(getOverheadTotal(overheads)).toBe(100);
  });
});

// ─── True Profit calculation ──────────────────────────────────────────────────
// True Profit = getMonthSummary(...).profit - getOverheadTotal(overheads)
// These tests verify the combined calc used by the FinanceScreen True Profit card.

describe('True Profit calculation', () => {
  function paidJobFx(overrides = {}) {
    return {
      id: 'j1',
      amount: 1000,
      paid: true,
      date: '2026-03-10',
      createdAt: '2026-03-10T09:00:00.000Z',
      ...overrides,
    };
  }
  function receiptFx(overrides = {}) {
    return { id: 'r1', amount: 200, date: '2026-03-12', ...overrides };
  }

  const FROM = new Date(2026, 2, 1);
  const TO   = new Date(2026, 2, 31);

  it('true profit = paid - materials - overheads (happy path)', () => {
    const jobs     = [paidJobFx({ amount: 1000 })];
    const receipts = [receiptFx({ amount: 200 })];
    const overheads = [
      { id: 'oh1', amount: 300, is_active: true },
      { id: 'oh2', amount: 100, is_active: true },
    ];
    const { profit } = getMonthSummary(jobs, receipts, { month: '2026-03' });
    const trueProfit = profit - getOverheadTotal(overheads);
    // profit = 1000 - 200 = 800; overheads = 400; trueProfit = 400
    expect(profit).toBe(800);
    expect(trueProfit).toBe(400);
  });

  it('true profit can go negative when overheads exceed materials profit', () => {
    const jobs      = [paidJobFx({ amount: 500 })];
    const overheads = [{ id: 'oh1', amount: 600, is_active: true }];
    const { profit } = getMonthSummary(jobs, [], { month: '2026-03' });
    const trueProfit = profit - getOverheadTotal(overheads);
    // profit = 500; overheads = 600; trueProfit = -100
    expect(trueProfit).toBe(-100);
  });

  it('true profit equals profit when no overheads are set', () => {
    const jobs = [paidJobFx({ amount: 800 })];
    const { profit } = getMonthSummary(jobs, [], { month: '2026-03' });
    const trueProfit = profit - getOverheadTotal([]);
    expect(trueProfit).toBe(profit);
  });

  it('inactive overheads do not reduce true profit', () => {
    const jobs      = [paidJobFx({ amount: 1000 })];
    const overheads = [
      { id: 'oh1', amount: 300, is_active: true },
      { id: 'oh2', amount: 200, is_active: false }, // inactive — excluded
    ];
    const { profit } = getMonthSummary(jobs, [], { month: '2026-03' });
    const trueProfit = profit - getOverheadTotal(overheads);
    // profit = 1000; active overheads = 300; trueProfit = 700
    expect(trueProfit).toBe(700);
  });

  it('null overheads list is safe (treated as empty)', () => {
    const jobs = [paidJobFx({ amount: 500 })];
    const { profit } = getMonthSummary(jobs, [], { month: '2026-03' });
    const trueProfit = profit - getOverheadTotal(null);
    expect(trueProfit).toBe(profit);
  });
});

// ─── taxYearStart ─────────────────────────────────────────────────────────────

describe('taxYearStart', () => {
  it('date well within the year (May) → 6 April same year', () => {
    const now = new Date(2026, 4, 28); // 2026-05-28
    const start = taxYearStart(now);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(3); // April = 3
    expect(start.getDate()).toBe(6);
  });

  it('date before 6 April (February) → 6 April prior year', () => {
    const now = new Date(2026, 1, 10); // 2026-02-10
    const start = taxYearStart(now);
    expect(start.getFullYear()).toBe(2025);
    expect(start.getMonth()).toBe(3);
    expect(start.getDate()).toBe(6);
  });

  it('exactly on 6 April → 6 April same year (new tax year starts)', () => {
    const now = new Date(2026, 3, 6); // 2026-04-06
    const start = taxYearStart(now);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(3);
    expect(start.getDate()).toBe(6);
  });

  it('5 April (one day before) → 6 April prior year (still old tax year)', () => {
    const now = new Date(2026, 3, 5); // 2026-04-05
    const start = taxYearStart(now);
    expect(start.getFullYear()).toBe(2025);
    expect(start.getMonth()).toBe(3);
    expect(start.getDate()).toBe(6);
  });

  it('time component is 00:00:00 local', () => {
    const now = new Date(2026, 4, 1, 15, 30, 0);
    const start = taxYearStart(now);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
  });
});

// ─── taxYearLabel ─────────────────────────────────────────────────────────────

describe('taxYearLabel', () => {
  it('returns "2026/27" for a date in the 2026/27 tax year', () => {
    const now = new Date(2026, 4, 28); // 2026-05-28 → tax year starts 2026-04-06
    expect(taxYearLabel(now)).toBe('2026/27');
  });

  it('returns "2025/26" for a date before 6 April 2026', () => {
    const now = new Date(2026, 1, 10); // 2026-02-10 → tax year starts 2025-04-06
    expect(taxYearLabel(now)).toBe('2025/26');
  });

  it('returns "2026/27" on 6 April 2026 exactly', () => {
    const now = new Date(2026, 3, 6); // 2026-04-06
    expect(taxYearLabel(now)).toBe('2026/27');
  });

  it('returns "2025/26" on 5 April 2026', () => {
    const now = new Date(2026, 3, 5); // 2026-04-05
    expect(taxYearLabel(now)).toBe('2025/26');
  });

  it('end year is always two digits', () => {
    const label = taxYearLabel(new Date(2026, 4, 1));
    expect(label).toMatch(/^\d{4}\/\d{2}$/);
  });
});

// ─── getTaxYearSummary ────────────────────────────────────────────────────────

describe('getTaxYearSummary', () => {
  // Reference: 2026-05-28. Tax year started 2026-04-06.

  const NOW = new Date(2026, 4, 28); // 2026-05-28

  function paidJobTY(overrides = {}) {
    return {
      id: overrides.id ?? 'ty-j1',
      amount: overrides.amount ?? 500,
      paid: true,
      date: overrides.date ?? '2026-05-10',
      ...overrides,
    };
  }

  function receiptTY(overrides = {}) {
    return {
      id: overrides.id ?? 'ty-r1',
      amount: overrides.amount ?? 100,
      date: overrides.date ?? '2026-05-08',
      ...overrides,
    };
  }

  it('includes a paid job dated within the tax year', () => {
    const jobs = [paidJobTY({ amount: 500, date: '2026-04-10' })];
    const { paid, profit } = getTaxYearSummary(jobs, [], NOW);
    expect(paid).toBe(500);
    expect(profit).toBe(500);
  });

  it('excludes a paid job dated before the tax year start', () => {
    const jobs = [paidJobTY({ amount: 999, date: '2026-04-05' })]; // 5 April — last year
    const { paid } = getTaxYearSummary(jobs, [], NOW);
    expect(paid).toBe(0);
  });

  it('includes a job dated exactly on 6 April (first day of tax year)', () => {
    const jobs = [paidJobTY({ amount: 400, date: '2026-04-06' })];
    const { paid } = getTaxYearSummary(jobs, [], NOW);
    expect(paid).toBe(400);
  });

  it('profit = paid − cost', () => {
    const jobs = [paidJobTY({ amount: 1000, date: '2026-05-01' })];
    const receipts = [receiptTY({ amount: 300, date: '2026-04-20' })];
    const { profit, paid } = getTaxYearSummary(jobs, receipts, NOW);
    expect(paid).toBe(1000);
    expect(profit).toBe(700);
  });

  it('excludes a receipt dated before the tax year start', () => {
    const jobs = [paidJobTY({ amount: 500, date: '2026-05-01' })];
    const receipts = [receiptTY({ amount: 200, date: '2026-04-04' })]; // before tax year
    const { profit } = getTaxYearSummary(jobs, receipts, NOW);
    // Receipt excluded → profit = 500
    expect(profit).toBe(500);
  });

  it('null-safe: non-array inputs return zeros', () => {
    const result = getTaxYearSummary(null, null, NOW);
    expect(result.paid).toBe(0);
    expect(result.profit).toBe(0);
  });

  it('null-safe: undefined inputs return zeros', () => {
    const result = getTaxYearSummary(undefined, undefined, NOW);
    expect(result.paid).toBe(0);
    expect(result.profit).toBe(0);
  });

  it('empty arrays return zeros', () => {
    const result = getTaxYearSummary([], [], NOW);
    expect(result.paid).toBe(0);
    expect(result.profit).toBe(0);
  });

  it('profit can be negative when costs exceed paid', () => {
    const jobs = [paidJobTY({ amount: 200, date: '2026-05-01' })];
    const receipts = [receiptTY({ amount: 500, date: '2026-05-05' })];
    const { profit } = getTaxYearSummary(jobs, receipts, NOW);
    expect(profit).toBe(-300);
    expect(profit).toBeLessThan(0);
  });

  it('excludes cancelled jobs', () => {
    const jobs = [paidJobTY({ amount: 9999, date: '2026-05-01', status: 'cancelled' })];
    const { paid } = getTaxYearSummary(jobs, [], NOW);
    expect(paid).toBe(0);
  });

  it('sums multiple jobs and receipts within the tax year', () => {
    const jobs = [
      paidJobTY({ id: 'j1', amount: 600, date: '2026-04-15' }),
      paidJobTY({ id: 'j2', amount: 400, date: '2026-05-20' }),
    ];
    const receipts = [
      receiptTY({ id: 'r1', amount: 100, date: '2026-04-20' }),
      receiptTY({ id: 'r2', amount: 50, date: '2026-05-10' }),
    ];
    const { paid, profit } = getTaxYearSummary(jobs, receipts, NOW);
    expect(paid).toBe(1000);
    expect(profit).toBe(850);
  });
});

// ─── getJobProfit ─────────────────────────────────────────────────────────────

describe('getJobProfit', () => {
  // Reuse the cloud/legacy/receipt fixtures defined above the first describe.

  it('returns zeros for null job (null-safe)', () => {
    const result = getJobProfit(null, []);
    expect(result).toEqual({ quote: 0, materials: 0, profit: 0, margin: 0 });
  });

  it('uses job.total as quote when present', () => {
    const job = { id: 'j1', total: 1000, amount: 500 };
    const { quote } = getJobProfit(job, []);
    expect(quote).toBe(1000);
  });

  it('falls back to job.amount when job.total is absent', () => {
    const job = { id: 'j1', amount: 800 };
    const { quote } = getJobProfit(job, []);
    expect(quote).toBe(800);
  });

  it('quote is 0 when both total and amount are absent', () => {
    const job = { id: 'j1' };
    const { quote, profit, margin } = getJobProfit(job, []);
    expect(quote).toBe(0);
    expect(profit).toBe(0);
    expect(margin).toBe(0);
  });

  it('sums only receipts linked by job.id', () => {
    const job = { id: 'j1', amount: 500 };
    const receipts = [
      { id: 'r1', jobId: 'j1', amount: 100 },
      { id: 'r2', jobId: 'j2', amount: 999 }, // different job — excluded
    ];
    const { materials, profit } = getJobProfit(job, receipts);
    expect(materials).toBe(100);
    expect(profit).toBe(400);
  });

  it('also matches receipts linked by job.cloudId', () => {
    const job = { id: 42, cloudId: 'uuid-cloud-abc', amount: 600 };
    const receipts = [
      { id: 'r1', jobId: 'uuid-cloud-abc', amount: 150 },
    ];
    const { materials, profit } = getJobProfit(job, receipts);
    expect(materials).toBe(150);
    expect(profit).toBe(450);
  });

  it('matches receipt jobId as number against string job.id (type-coercion)', () => {
    const job = { id: '7', amount: 300 };
    const receipts = [{ id: 'r1', jobId: 7, amount: 50 }]; // numeric jobId
    const { materials } = getJobProfit(job, receipts);
    expect(materials).toBe(50);
  });

  it('margin = Math.round(profit / quote * 100)', () => {
    const job = { id: 'j1', amount: 1000 };
    const receipts = [{ id: 'r1', jobId: 'j1', amount: 300 }];
    const { margin } = getJobProfit(job, receipts);
    // profit = 700, margin = round(700/1000*100) = 70
    expect(margin).toBe(70);
  });

  it('margin is 0 when quote is 0 (no divide-by-zero)', () => {
    const job = { id: 'j1', amount: 0 };
    const { margin } = getJobProfit(job, []);
    expect(margin).toBe(0);
    expect(isNaN(margin)).toBe(false);
  });

  it('profit is negative when materials exceed quote', () => {
    const job = { id: 'j1', amount: 200 };
    const receipts = [{ id: 'r1', jobId: 'j1', amount: 350 }];
    const { profit, margin } = getJobProfit(job, receipts);
    expect(profit).toBe(-150);
    expect(margin).toBeLessThan(0);
  });

  it('null-safe: non-array receipts treated as empty', () => {
    const job = { id: 'j1', amount: 500 };
    expect(() => getJobProfit(job, null)).not.toThrow();
    expect(() => getJobProfit(job, undefined)).not.toThrow();
    expect(getJobProfit(job, null).materials).toBe(0);
  });

  it('null cloudId on job does not match receipts with null jobId', () => {
    const job = { id: 'j1', cloudId: null, amount: 400 };
    const receipts = [{ id: 'r1', jobId: null, amount: 100 }];
    const { materials } = getJobProfit(job, receipts);
    expect(materials).toBe(0);
  });
});

// ─── getBestWorstJobs ─────────────────────────────────────────────────────────

describe('getBestWorstJobs', () => {
  // Reference date: 2026-05-28 (tax year 2026/27 started 2026-04-06)
  const NOW = new Date(2026, 4, 28); // 2026-05-28

  function doneJob(overrides = {}) {
    return {
      id: overrides.id ?? 'j1',
      name: overrides.name ?? 'Test Job',
      amount: overrides.amount ?? 500,
      paid: true,
      date: overrides.date ?? '2026-05-10',
      ...overrides,
    };
  }

  it('returns both null when jobs array is empty', () => {
    const result = getBestWorstJobs([], [], NOW);
    expect(result.best).toBeNull();
    expect(result.worst).toBeNull();
  });

  it('returns both null when jobs is not an array (null-safe)', () => {
    expect(getBestWorstJobs(null, [], NOW)).toEqual({ best: null, worst: null });
    expect(getBestWorstJobs(undefined, [], NOW)).toEqual({ best: null, worst: null });
  });

  it('returns best only (worst=null) when there is exactly one qualifying job', () => {
    const jobs = [doneJob({ id: 'j1', amount: 400 })];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.best).not.toBeNull();
    expect(result.worst).toBeNull();
  });

  it('best is highest-profit job, worst is lowest-profit job', () => {
    const jobs = [
      doneJob({ id: 'low',  name: 'Cheap Job',  amount: 200 }),
      doneJob({ id: 'high', name: 'Big Job',    amount: 1000 }),
      doneJob({ id: 'mid',  name: 'Middle Job', amount: 500 }),
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.best.id).toBe('high');
    expect(result.worst.id).toBe('low');
  });

  it('receipts reduce profit for worst-job ranking', () => {
    // j1: quote 500, materials 400 → profit 100
    // j2: quote 500, materials 0   → profit 500
    const jobs = [
      doneJob({ id: 'j1', name: 'Heavy materials', amount: 500 }),
      doneJob({ id: 'j2', name: 'No materials',    amount: 500 }),
    ];
    const receipts = [{ id: 'r1', jobId: 'j1', amount: 400 }];
    const result = getBestWorstJobs(jobs, receipts, NOW);
    expect(result.best.id).toBe('j2');
    expect(result.worst.id).toBe('j1');
    expect(result.worst.profit).toBe(100);
  });

  it('excludes lead-status jobs (not done yet)', () => {
    const jobs = [
      doneJob({ id: 'done', amount: 500 }),
      { id: 'lead', name: 'Lead Job', amount: 400, status: 'lead', date: '2026-05-10' },
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.best.id).toBe('done');
    expect(result.worst).toBeNull(); // only one qualifying job
  });

  it('excludes quoted-only jobs', () => {
    const jobs = [
      doneJob({ id: 'done', amount: 500 }),
      { id: 'quoted', name: 'Quoted', amount: 400, status: 'quoted', date: '2026-05-10' },
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.worst).toBeNull();
  });

  it('excludes cancelled jobs', () => {
    const jobs = [
      doneJob({ id: 'done', amount: 500 }),
      doneJob({ id: 'cancelled', amount: 1, status: 'cancelled' }),
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.best.id).toBe('done');
    expect(result.worst).toBeNull();
  });

  it('includes jobs with invoiced status (work done, awaiting payment)', () => {
    const jobs = [
      { id: 'j1', name: 'Invoiced', amount: 800, paid: false, status: 'invoiced', date: '2026-05-10' },
      doneJob({ id: 'j2', amount: 400 }),
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.best.id).toBe('j1');
    expect(result.worst.id).toBe('j2');
  });

  it('includes jobs with awaiting paymentStatus', () => {
    const jobs = [
      { id: 'j1', name: 'Awaiting', amount: 600, paid: false, paymentStatus: 'awaiting', date: '2026-05-10' },
      doneJob({ id: 'j2', amount: 300 }),
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.best.id).toBe('j1');
  });

  it('excludes jobs with quote=0 (no revenue means no ranking)', () => {
    const jobs = [
      doneJob({ id: 'has-quote', amount: 500 }),
      doneJob({ id: 'no-quote',  amount: 0 }),
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.worst).toBeNull(); // only one qualifies
  });

  it('tax-year boundary: excludes job dated before 6 April', () => {
    const jobs = [
      doneJob({ id: 'this-year', amount: 500, date: '2026-04-10' }),
      doneJob({ id: 'last-year', amount: 9999, date: '2026-04-05' }), // 5 April — last tax year
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.best.id).toBe('this-year');
    expect(result.worst).toBeNull();
  });

  it('tax-year boundary: includes job dated exactly 6 April (start day inclusive)', () => {
    const jobs = [
      doneJob({ id: 'j1', amount: 300, date: '2026-04-06' }),
      doneJob({ id: 'j2', amount: 100, date: '2026-05-01' }),
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.best.id).toBe('j1');
    expect(result.worst.id).toBe('j2');
  });

  it('result entries include id, label, customer, profit, margin fields', () => {
    const jobs = [doneJob({ id: 'j1', name: 'Loft conversion', customer: 'Alice', amount: 600 })];
    const result = getBestWorstJobs(jobs, [], NOW);
    const { best } = result;
    expect(best).toHaveProperty('id');
    expect(best).toHaveProperty('label');
    expect(best).toHaveProperty('customer');
    expect(best).toHaveProperty('profit');
    expect(best).toHaveProperty('margin');
    expect(best.label).toBe('Loft conversion');
    expect(best.customer).toBe('Alice');
  });

  it('label falls back: name → customer → customerName → "Job"', () => {
    const noNameJob = doneJob({ id: 'j1', amount: 300 });
    delete noNameJob.name;
    noNameJob.customer = 'Bob Plumbing';
    const result = getBestWorstJobs([noNameJob], [], NOW);
    expect(result.best.label).toBe('Bob Plumbing');
  });

  it('returns both null when all jobs are outside the tax year', () => {
    const jobs = [
      doneJob({ id: 'old', amount: 500, date: '2025-03-01' }), // last tax year
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.best).toBeNull();
    expect(result.worst).toBeNull();
  });
});
