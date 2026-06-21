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
  vatQuarterRange,
  getVatSummary,
  VAT_RATE,
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

  // Regression: bug #7 cross-device materials fix.
  // A cloud-only job (mapped via mapCloudJobToToday, cloudId === id === UUID)
  // must include receipt costs linked by that UUID — profit must not be overstated.
  it('cloud-only job: receipt linked by UUID is counted in materials (regression #7)', () => {
    // Simulate mapCloudJobToToday output — id and cloudId are both the Supabase UUID.
    // This is exactly what the store returns after the fix.
    const uuid = 'a1b2c3d4-0000-0000-0000-000000000001';
    const job = { id: uuid, cloudId: uuid, amount: 800, cloud: true };
    const receipts = [
      { id: 'r1', jobId: uuid, amount: 200 }, // linked by UUID
      { id: 'r2', jobId: 'other-job-uuid', amount: 999 }, // different job — must be excluded
    ];
    const { materials, profit } = getJobProfit(job, receipts);
    expect(materials).toBe(200);
    expect(profit).toBe(600);
  });

  // Regression: the fix must not double-count a receipt when job.id === job.cloudId.
  // Both branches of the OR would match the same receipt — the filter must not sum it twice.
  it('no double-count when job.id === job.cloudId (post-fix cloud-only shape)', () => {
    const uuid = 'a1b2c3d4-0000-0000-0000-000000000002';
    const job = { id: uuid, cloudId: uuid, amount: 500, cloud: true };
    const receipts = [{ id: 'r1', jobId: uuid, amount: 100 }];
    const { materials } = getJobProfit(job, receipts);
    // Must be 100, not 200, even though jobId matches both job.id and job.cloudId
    expect(materials).toBe(100);
  });

  // Regression: legacy localStorage-synced job (id=numeric, cloudId=UUID) with
  // a receipt whose jobId is the cloud UUID still matches via cloudId branch.
  it('localStorage+cloud hybrid: receipt linked by cloudId UUID matches correctly', () => {
    const uuid = 'a1b2c3d4-0000-0000-0000-000000000003';
    const job = { id: 'J-5', cloudId: uuid, amount: 650 }; // getTodayJobs now passes cloudId through
    const receipts = [
      { id: 'r1', jobId: uuid, amount: 175 }, // saved after cloud sync; jobId is UUID
    ];
    const { materials, profit } = getJobProfit(job, receipts);
    expect(materials).toBe(175);
    expect(profit).toBe(475);
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

// ─── VAT_RATE constant ────────────────────────────────────────────────────────

describe('VAT_RATE', () => {
  it('is 0.2 (20%)', () => {
    expect(VAT_RATE).toBe(0.2);
  });
});

// ─── vatQuarterRange ──────────────────────────────────────────────────────────

describe('vatQuarterRange', () => {
  it('Q1: date in January returns Jan–Mar quarter starting Jan 1', () => {
    const now = new Date(2026, 0, 15); // 2026-01-15
    const { start, label } = vatQuarterRange(now);
    expect(start.getMonth()).toBe(0);  // January
    expect(start.getDate()).toBe(1);
    expect(start.getFullYear()).toBe(2026);
    expect(label).toMatch(/Jan/);
    expect(label).toMatch(/Mar/);
    expect(label).toMatch(/2026/);
  });

  it('Q1: date in March returns Jan–Mar quarter', () => {
    const now = new Date(2026, 2, 31); // 2026-03-31
    const { start, label } = vatQuarterRange(now);
    expect(start.getMonth()).toBe(0);
    expect(label).toMatch(/Jan/);
    expect(label).toMatch(/Mar/);
  });

  it('Q2: date in April returns Apr–Jun quarter starting Apr 1', () => {
    const now = new Date(2026, 3, 1); // 2026-04-01
    const { start, label } = vatQuarterRange(now);
    expect(start.getMonth()).toBe(3);  // April
    expect(start.getDate()).toBe(1);
    expect(label).toMatch(/Apr/);
    expect(label).toMatch(/Jun/);
  });

  it('Q2: date in June returns Apr–Jun quarter', () => {
    const now = new Date(2026, 5, 28); // 2026-06-28
    const { start, label } = vatQuarterRange(now);
    expect(start.getMonth()).toBe(3);
    expect(label).toMatch(/Apr/);
    expect(label).toMatch(/Jun/);
  });

  it('Q3: date in July returns Jul–Sep quarter starting Jul 1', () => {
    const now = new Date(2026, 6, 10); // 2026-07-10
    const { start, label } = vatQuarterRange(now);
    expect(start.getMonth()).toBe(6);  // July
    expect(start.getDate()).toBe(1);
    expect(label).toMatch(/Jul/);
    expect(label).toMatch(/Sep/);
  });

  it('Q4: date in October returns Oct–Dec quarter starting Oct 1', () => {
    const now = new Date(2026, 9, 5); // 2026-10-05
    const { start, label } = vatQuarterRange(now);
    expect(start.getMonth()).toBe(9);  // October
    expect(start.getDate()).toBe(1);
    expect(label).toMatch(/Oct/);
    expect(label).toMatch(/Dec/);
  });

  it('Q4: date in December returns Oct–Dec quarter', () => {
    const now = new Date(2026, 11, 31); // 2026-12-31
    const { start, label } = vatQuarterRange(now);
    expect(start.getMonth()).toBe(9);
    expect(label).toMatch(/Oct/);
    expect(label).toMatch(/Dec/);
  });

  it('end is end-of-day of now, not end of quarter', () => {
    // If now is Apr 15, end should be Apr 15 23:59:59 — not Jun 30
    const now = new Date(2026, 3, 15); // 2026-04-15
    const { end } = vatQuarterRange(now);
    expect(end.getMonth()).toBe(3);      // April, not June
    expect(end.getDate()).toBe(15);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
  });

  it('start is local midnight (00:00:00)', () => {
    const now = new Date(2026, 3, 20, 15, 30);
    const { start } = vatQuarterRange(now);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
  });

  it('label includes the year', () => {
    const now = new Date(2026, 5, 1);
    const { label } = vatQuarterRange(now);
    expect(label).toContain('2026');
  });
});

// ─── getVatSummary ────────────────────────────────────────────────────────────

describe('getVatSummary', () => {
  // Reference: 2026-05-28 (Q2: Apr–Jun 2026 started 2026-04-01)
  const NOW = new Date(2026, 4, 28); // 2026-05-28

  function paidJobQ(overrides = {}) {
    return {
      id: overrides.id ?? 'vat-j1',
      amount: overrides.amount ?? 500,
      total: overrides.total,
      paid: true,
      date: overrides.date ?? '2026-05-10',
      ...overrides,
    };
  }

  function receiptQ(overrides = {}) {
    return {
      id: overrides.id ?? 'vat-r1',
      amount: overrides.amount ?? 100,
      vat: overrides.vat ?? 20,
      date: overrides.date ?? '2026-05-08',
      ...overrides,
    };
  }

  it('grossSales = entered amount (prices are VAT-inclusive)', () => {
    const jobs = [paidJobQ({ amount: 500, date: '2026-05-10' })];
    const { grossSales } = getVatSummary(jobs, [], NOW);
    expect(grossSales).toBe(500);
  });

  it('outputVat = gross / 6 (VAT portion within the gross at 20%)', () => {
    const jobs = [paidJobQ({ amount: 600, date: '2026-05-10' })];
    const { outputVat } = getVatSummary(jobs, [], NOW);
    // gross = 600, net = 600/1.2 = 500, vat = 600 - 500 = 100
    expect(outputVat).toBeCloseTo(100, 10);
  });

  it('netSales = gross / 1.2 (ex-VAT portion at 20%)', () => {
    const jobs = [paidJobQ({ amount: 600, date: '2026-05-10' })];
    const { netSales } = getVatSummary(jobs, [], NOW);
    expect(netSales).toBeCloseTo(500, 10);
  });

  it('uses job.total when present (prefers total over amount)', () => {
    const jobs = [paidJobQ({ total: 1200, amount: 500, date: '2026-05-10' })];
    const { grossSales } = getVatSummary(jobs, [], NOW);
    expect(grossSales).toBe(1200);
  });

  it('inputVat = sum of receipt.vat for in-quarter receipts', () => {
    const receipts = [
      receiptQ({ vat: 20, date: '2026-04-15' }),
      receiptQ({ id: 'r2', vat: 10, date: '2026-05-01' }),
    ];
    const { inputVat } = getVatSummary([], receipts, NOW);
    expect(inputVat).toBe(30);
  });

  it('netVat = outputVat − inputVat (positive = owe HMRC)', () => {
    // gross = £1200; net = £1000; vat = £200; inputVat = £50; netVat = £150
    const jobs = [paidJobQ({ amount: 1200, date: '2026-05-01' })];
    const receipts = [receiptQ({ vat: 50, date: '2026-05-05' })];
    const { outputVat, inputVat, netVat } = getVatSummary(jobs, receipts, NOW);
    expect(netVat).toBeCloseTo(outputVat - inputVat, 10);
    expect(outputVat).toBeCloseTo(200, 10);
    expect(netVat).toBeCloseTo(200 - 50, 10);
  });

  it('netVat is negative when inputVat > outputVat (reclaim scenario)', () => {
    const jobs = [paidJobQ({ amount: 100, date: '2026-05-01' })];
    const receipts = [receiptQ({ vat: 500, date: '2026-05-05' })];
    const { netVat } = getVatSummary(jobs, receipts, NOW);
    expect(netVat).toBeLessThan(0);
  });

  it('out-of-quarter paid jobs are excluded from grossSales', () => {
    // Q1 2026 (Jan–Mar) — should be excluded when now is in Q2
    const jobs = [paidJobQ({ amount: 9999, date: '2026-03-20' })];
    const { grossSales } = getVatSummary(jobs, [], NOW);
    expect(grossSales).toBe(0);
  });

  it('out-of-quarter receipts are excluded from inputVat', () => {
    const receipts = [receiptQ({ vat: 999, date: '2026-03-15' })]; // Q1 — excluded
    const { inputVat } = getVatSummary([], receipts, NOW);
    expect(inputVat).toBe(0);
  });

  it('excluded (cancelled) jobs do not contribute to grossSales', () => {
    const jobs = [paidJobQ({ amount: 9999, date: '2026-05-01', status: 'cancelled' })];
    const { grossSales } = getVatSummary(jobs, [], NOW);
    expect(grossSales).toBe(0);
  });

  it('unpaid jobs do not contribute to grossSales', () => {
    const unpaid = { id: 'u1', amount: 9999, paid: false, date: '2026-05-10' };
    const { grossSales } = getVatSummary([unpaid], [], NOW);
    expect(grossSales).toBe(0);
  });

  it('receipts with no vat field contribute 0 to inputVat (null-safe)', () => {
    const receipts = [{ id: 'r1', amount: 100, date: '2026-05-05' }]; // no vat field
    const { inputVat } = getVatSummary([], receipts, NOW);
    expect(inputVat).toBe(0);
  });

  it('receipts with vat=null contribute 0 (null-safe)', () => {
    const receipts = [receiptQ({ vat: null, date: '2026-05-05' })];
    const { inputVat } = getVatSummary([], receipts, NOW);
    expect(inputVat).toBe(0);
  });

  it('null-safe: non-array jobs returns zeros', () => {
    const result = getVatSummary(null, null, NOW);
    expect(result.grossSales).toBe(0);
    expect(result.netSales).toBe(0);
    expect(result.outputVat).toBe(0);
    expect(result.inputVat).toBe(0);
    expect(result.netVat).toBe(0);
  });

  it('null-safe: undefined inputs return zeros', () => {
    const result = getVatSummary(undefined, undefined, NOW);
    expect(result.grossSales).toBe(0);
    expect(result.netSales).toBe(0);
    expect(result.netVat).toBe(0);
  });

  it('empty arrays return all-zero result', () => {
    const result = getVatSummary([], [], NOW);
    expect(result.grossSales).toBe(0);
    expect(result.outputVat).toBe(0);
    expect(result.inputVat).toBe(0);
    expect(result.netVat).toBe(0);
    expect(result.netSales).toBe(0);
  });

  it('sums multiple in-quarter paid jobs — grossSales is sum, outputVat derived from gross', () => {
    // Two jobs: £480 + £720 = £1200 gross; net = £1000; vat = £200
    const jobs = [
      paidJobQ({ id: 'j1', amount: 480, date: '2026-04-10' }),
      paidJobQ({ id: 'j2', amount: 720, date: '2026-05-20' }),
    ];
    const { grossSales, netSales, outputVat } = getVatSummary(jobs, [], NOW);
    expect(grossSales).toBe(1200);
    expect(netSales).toBeCloseTo(1000, 10);
    expect(outputVat).toBeCloseTo(200, 10);
  });

  it('uses receipt.createdAt as date fallback when receipt.date is absent', () => {
    const receipts = [{ id: 'r1', amount: 50, vat: 10, createdAt: '2026-05-10T09:00:00.000Z' }];
    const { inputVat } = getVatSummary([], receipts, NOW);
    expect(inputVat).toBe(10);
  });

  it('Q4 boundary: jobs in Oct are in quarter when now is in Dec', () => {
    const nowDec = new Date(2026, 11, 15); // 2026-12-15 (Q4)
    const jobs = [paidJobQ({ amount: 300, date: '2026-10-05' })];
    const { grossSales } = getVatSummary(jobs, [], nowDec);
    expect(grossSales).toBe(300);
  });

  it('Q4 boundary: jobs in Sep are out-of-quarter when now is in Oct', () => {
    const nowOct = new Date(2026, 9, 5); // 2026-10-05 (Q4 started)
    const jobs = [paidJobQ({ amount: 300, date: '2026-09-30' })]; // Q3 — excluded
    const { grossSales } = getVatSummary(jobs, [], nowOct);
    expect(grossSales).toBe(0);
  });
});

// ─── getVatSummary — inclusive-price correctness proofs ─────────────────────
// These are the canonical arithmetic proofs for the VAT-inclusive fix
// (ACC decision 2026-06-21). Prices entered in the app are gross-inclusive;
// we derive net and VAT from the gross, never add on top.

describe('getVatSummary — VAT-inclusive arithmetic proofs', () => {
  const NOW = new Date(2026, 4, 28); // 2026-05-28

  function paidJobQ(overrides = {}) {
    return { id: 'vat-proof-j1', amount: 0, paid: true, date: '2026-05-10', ...overrides };
  }

  it('£240 gross → net £200, vat £40', () => {
    const { grossSales, netSales, outputVat } = getVatSummary([paidJobQ({ amount: 240 })], [], NOW);
    expect(grossSales).toBe(240);
    expect(netSales).toBeCloseTo(200, 10);
    expect(outputVat).toBeCloseTo(40, 10);
  });

  it('£1200 gross → net £1000, vat £200', () => {
    const { grossSales, netSales, outputVat } = getVatSummary([paidJobQ({ amount: 1200 })], [], NOW);
    expect(grossSales).toBe(1200);
    expect(netSales).toBeCloseTo(1000, 10);
    expect(outputVat).toBeCloseTo(200, 10);
  });

  it('outputVat + netSales === grossSales (no rounding gap)', () => {
    const { grossSales, netSales, outputVat } = getVatSummary([paidJobQ({ amount: 360 })], [], NOW);
    expect(outputVat + netSales).toBeCloseTo(grossSales, 10);
  });

  it('outputVat is NOT grossSales * 0.2 (that would be the old bug)', () => {
    // At 20% inclusive, outputVat = gross / 6, NOT gross * 0.2
    // gross £120 → vat = £20 (correct), NOT £24 (old bug)
    const { outputVat } = getVatSummary([paidJobQ({ amount: 120 })], [], NOW);
    expect(outputVat).toBeCloseTo(20, 10);
    expect(outputVat).not.toBeCloseTo(24, 5); // guard against regression to old × 0.2
  });

  it('netVat = outputVat − inputVat for inclusive gross', () => {
    // gross £1200 → net £1000, vat £200; inputVat £80 → netVat £120
    const receipts = [{ id: 'r1', amount: 100, vat: 80, date: '2026-05-05' }];
    const { netVat, outputVat } = getVatSummary([paidJobQ({ amount: 1200 })], receipts, NOW);
    expect(outputVat).toBeCloseTo(200, 10);
    expect(netVat).toBeCloseTo(120, 10);
  });
});

// ─── getTaxYearSummary — CIS-aware tests ────────────────────────────────────
// All tests use NOW = 2026-05-31 (tax year 2026/27 started 2026-04-06).

import { resolveCisStatus } from '../cashflow.js';

const CIS_NOW = new Date(2026, 4, 31); // 2026-05-31

// Profile helpers
const cisProfile20 = { is_cis_subcontractor: true, cis_default_rate: 20 };
const cisProfile30 = { is_cis_subcontractor: true, cis_default_rate: 30 };
const cisProfile0  = { is_cis_subcontractor: true, cis_default_rate: 0 };
const nonCisProfile = { is_cis_subcontractor: false, cis_default_rate: 20 };

// Paid job fixture with the tax year (2026-05-10 is in 2026/27)
function cisJob(overrides = {}) {
  return {
    id: 'cis-j1',
    amount: 1000,
    paid: true,
    date: '2026-05-10',
    createdAt: '2026-05-10T09:00:00.000Z',
    payments: [],
    ...overrides,
  };
}

// Receipt linked to cisJob by default
function cisReceipt(overrides = {}) {
  return {
    id: 'cis-r1',
    jobId: 'cis-j1',
    amount: 200,
    date: '2026-05-10',
    ...overrides,
  };
}

describe('resolveCisStatus', () => {
  it('returns isCisJob=false for non-CIS profile regardless of job fields', () => {
    const job = cisJob({ cis: true, cisRate: 20 });
    expect(resolveCisStatus(job, nonCisProfile)).toEqual({ isCisJob: false, rate: 0 });
  });

  it('returns isCisJob=false when job explicitly opts out (cis: false)', () => {
    expect(resolveCisStatus(cisJob({ cis: false }), cisProfile20)).toEqual({ isCisJob: false, rate: 0 });
  });

  it('returns isCisJob=true with profile default rate when job has no cisRate', () => {
    expect(resolveCisStatus(cisJob(), cisProfile20)).toEqual({ isCisJob: true, rate: 20 });
    expect(resolveCisStatus(cisJob(), cisProfile30)).toEqual({ isCisJob: true, rate: 30 });
  });

  it('per-job cisRate overrides the profile default', () => {
    expect(resolveCisStatus(cisJob({ cisRate: 30 }), cisProfile20)).toEqual({ isCisJob: true, rate: 30 });
    expect(resolveCisStatus(cisJob({ cisRate: 0 }), cisProfile20)).toEqual({ isCisJob: true, rate: 0 });
  });

  it('Gross Payment Status (rate=0): isCisJob=true, rate=0', () => {
    expect(resolveCisStatus(cisJob(), cisProfile0)).toEqual({ isCisJob: true, rate: 0 });
  });

  it('null profile → non-CIS', () => {
    expect(resolveCisStatus(cisJob(), null)).toEqual({ isCisJob: false, rate: 0 });
  });
});

describe('getTaxYearSummary — non-CIS users unchanged invariant', () => {
  it('profit and paid are identical to pre-CIS behaviour for non-CIS profile', () => {
    const jobs = [cisJob({ amount: 800 })];
    const receipts = [cisReceipt({ amount: 150 })];
    const result = getTaxYearSummary(jobs, receipts, CIS_NOW, nonCisProfile);
    expect(result.profit).toBe(800 - 150); // headline P&L unchanged
    expect(result.paid).toBe(800);
    expect(result.cisDeductedYtd).toBe(0);
    // nonCisProfit = per-job profit (quote - linked materials) = 800 - 150
    expect(result.nonCisProfit).toBe(650);
    expect(result.excludedFromTax).toBe(0);
  });

  it('null profile behaves the same as non-CIS profile', () => {
    const jobs = [cisJob({ amount: 500 })];
    const result = getTaxYearSummary(jobs, [], CIS_NOW, null);
    expect(result.cisDeductedYtd).toBe(0);
    expect(result.nonCisProfit).toBe(500);
  });

  it('omitting profile argument (3-arg call) stays backward-compatible', () => {
    const jobs = [cisJob({ amount: 600 })];
    const result = getTaxYearSummary(jobs, [], CIS_NOW);
    expect(result.profit).toBe(600);
    expect(result.cisDeductedYtd).toBe(0);
  });
});

describe('getTaxYearSummary — CIS deduction at 20%', () => {
  // quote=1000, materials=200, labour=800, deduction=160
  it('computes cisDeductedYtd correctly for a standard CIS job', () => {
    const jobs = [cisJob({ amount: 1000 })];
    const receipts = [cisReceipt({ amount: 200 })];
    const result = getTaxYearSummary(jobs, receipts, CIS_NOW, cisProfile20);
    expect(result.cisDeductedYtd).toBe(160); // 800 * 20%
    expect(result.nonCisProfit).toBe(0);     // entire job is CIS
    expect(result.paid).toBe(1000);
    expect(result.profit).toBe(1000 - 200);  // headline P&L unchanged
  });

  it('clamps labour to 0 when materials exceed quote (materials > quote edge case)', () => {
    // quote=500, materials=700 → labour=0 → deduction=0
    const jobs = [cisJob({ amount: 500 })];
    const receipts = [cisReceipt({ amount: 700 })];
    const result = getTaxYearSummary(jobs, receipts, CIS_NOW, cisProfile20);
    expect(result.cisDeductedYtd).toBe(0);
    // nonCisProfit is 0 (the job is CIS, just no deduction)
    expect(result.nonCisProfit).toBe(0);
  });
});

describe('getTaxYearSummary — CIS deduction at 30%', () => {
  it('applies 30% rate for unregistered subcontractors', () => {
    // quote=1000, materials=200, labour=800, deduction=240
    const jobs = [cisJob({ amount: 1000 })];
    const receipts = [cisReceipt({ amount: 200 })];
    const result = getTaxYearSummary(jobs, receipts, CIS_NOW, cisProfile30);
    expect(result.cisDeductedYtd).toBe(240);
  });

  it('per-job rate of 30 overrides profile default of 20', () => {
    const jobs = [cisJob({ amount: 1000, cisRate: 30 })];
    const receipts = [cisReceipt({ amount: 0 })];
    const result = getTaxYearSummary(jobs, receipts, CIS_NOW, cisProfile20);
    expect(result.cisDeductedYtd).toBe(300); // 1000 * 30%
  });
});

describe('getTaxYearSummary — Gross Payment Status (0%)', () => {
  it('deduction is £0 for gross jobs but profit counts toward set-aside base', () => {
    const jobs = [cisJob({ amount: 1000 })];
    const receipts = [cisReceipt({ amount: 200 })];
    const result = getTaxYearSummary(jobs, receipts, CIS_NOW, cisProfile0);
    expect(result.cisDeductedYtd).toBe(0);
    // Gross job profit (quote - materials) counts toward nonCisProfit
    expect(result.nonCisProfit).toBe(800); // 1000 - 200
  });
});

describe('getTaxYearSummary — excludeFromTax', () => {
  it('excluded job leaves all tax calc buckets but contributes to paid (cashflow)', () => {
    const jobs = [cisJob({ amount: 1000, excludeFromTax: true })];
    const receipts = [cisReceipt({ amount: 200 })];
    const result = getTaxYearSummary(jobs, receipts, CIS_NOW, cisProfile20);
    expect(result.paid).toBe(1000);          // still in cashflow
    expect(result.cisDeductedYtd).toBe(0);  // excluded before CIS calc
    expect(result.nonCisProfit).toBe(0);    // excluded before set-aside calc
    expect(result.excludedFromTax).toBe(800); // quote - materials
  });

  it('excluded non-CIS job also leaves tax calc for non-CIS user', () => {
    const jobs = [cisJob({ amount: 500, excludeFromTax: true })];
    const result = getTaxYearSummary(jobs, [], CIS_NOW, nonCisProfile);
    expect(result.paid).toBe(500);
    expect(result.nonCisProfit).toBe(0);
    expect(result.excludedFromTax).toBe(500);
  });
});

describe('getTaxYearSummary — mixed CIS + non-CIS jobs', () => {
  it('splits correctly between CIS and set-aside base', () => {
    // Job A: CIS at 20%, quote=1000, materials=200 → labour=800, deduction=160
    // Job B: non-CIS, quote=600, materials=100 → jobProfit=500
    const jobA = cisJob({ id: 'jA', amount: 1000, date: '2026-05-10' });
    const jobB = cisJob({ id: 'jB', amount: 600, date: '2026-05-10', cis: false });
    const rcptA = cisReceipt({ id: 'rA', jobId: 'jA', amount: 200 });
    const rcptB = cisReceipt({ id: 'rB', jobId: 'jB', amount: 100 });
    const result = getTaxYearSummary([jobA, jobB], [rcptA, rcptB], CIS_NOW, cisProfile20);
    expect(result.cisDeductedYtd).toBe(160);  // from jobA only
    expect(result.nonCisProfit).toBe(500);    // from jobB (600 - 100)
    expect(result.paid).toBe(1600);
    expect(result.profit).toBe(1600 - 300);   // headline unchanged
  });

  it('100% CIS edge: nonCisProfit is 0', () => {
    const jobs = [
      cisJob({ id: 'j1', amount: 1000 }),
      cisJob({ id: 'j2', amount: 800, date: '2026-04-20' }),
    ];
    const result = getTaxYearSummary(jobs, [], CIS_NOW, cisProfile20);
    expect(result.nonCisProfit).toBe(0);
    expect(result.cisDeductedYtd).toBe(1000 * 0.2 + 800 * 0.2);
  });
});

describe('getTaxYearSummary — out-of-tax-year jobs excluded', () => {
  it('paid job from last tax year does not contribute to CIS deduction', () => {
    // 2025-04-05 is before the 2025/26 tax year start (2025-04-06) — last year
    const jobs = [cisJob({ amount: 1000, date: '2025-04-05' })];
    const result = getTaxYearSummary(jobs, [], CIS_NOW, cisProfile20);
    expect(result.cisDeductedYtd).toBe(0);
    expect(result.paid).toBe(0);
  });
});

describe('getTaxYearSummary — derived labour for CIS deduction', () => {
  it('no receipts: full quote amount is labour (100% labour job)', () => {
    // quote=500, materials=0, labour=500, deduction=100
    const jobs = [cisJob({ amount: 500 })];
    const result = getTaxYearSummary(jobs, [], CIS_NOW, cisProfile20);
    expect(result.cisDeductedYtd).toBe(100);
  });

  it('sum of multiple receipts for same job correctly reduces labour', () => {
    // quote=1000, materials=300+100=400, labour=600, deduction=120
    const jobs = [cisJob({ amount: 1000 })];
    const receipts = [
      cisReceipt({ id: 'r1', amount: 300 }),
      cisReceipt({ id: 'r2', jobId: 'cis-j1', amount: 100 }),
    ];
    const result = getTaxYearSummary(jobs, receipts, CIS_NOW, cisProfile20);
    expect(result.cisDeductedYtd).toBe(120);
  });
});
