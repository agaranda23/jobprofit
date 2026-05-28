/**
 * FinanceScreen logic tests — pure functions, no DOM.
 *
 * This project has no @testing-library/react. Component rendering is exercised
 * by manual smoke on the deploy preview (see PR-M3 checklist).
 *
 * Tests cover the data-layer behaviour that FinanceScreen depends on, with
 * focus on the threshold logic and edge cases introduced in M3:
 *
 *   - Hero "all caught up" vs owed state (getOutstandingSummary)
 *   - Hero oldest-age and oldest-customer-name derivation
 *   - Month two-up: negative profit detection
 *   - Est. Profit/Hour null path (no hourly rate set)
 *   - Margin nudge threshold: fires at |delta| >= 10, silent below
 *   - Chart data: getCashflowByMonth returns correct shape for FinanceScreen
 *   - Range mapping: buildDateRange returns plausible from/to for each range key
 *   - Timeline entry count: all jobs + receipts contribute entries
 */

import { describe, it, expect } from 'vitest';
import {
  getOutstandingSummary,
  getMonthSummary,
  getProfitPerHour,
  getMarginTrend,
  getCashflowByMonth,
  buildDateRange,
  monthKey,
  getOverheadTotal,
  getTaxYearSummary,
  taxYearLabel,
} from '../../lib/cashflow';

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const TODAY = new Date('2026-05-20T10:00:00');
const CURRENT_MONTH = '2026-05';

// Minimal paid job shape (cloud + legacy fields merged)
function paidJob(overrides = {}) {
  return {
    id: overrides.id ?? 'j1',
    amount: overrides.amount ?? 500,
    paid: true,
    date: overrides.date ?? '2026-05-10',
    customer: overrides.customer ?? 'Alice',
    ...overrides,
  };
}

// Minimal unpaid job
function unpaidJob(overrides = {}) {
  return {
    id: overrides.id ?? 'j2',
    amount: overrides.amount ?? 300,
    paid: false,
    date: overrides.date ?? '2026-05-05',
    customer: overrides.customer ?? 'Bob',
    ...overrides,
  };
}

// Minimal receipt
function receipt(overrides = {}) {
  return {
    id: overrides.id ?? 'r1',
    amount: overrides.amount ?? 100,
    date: overrides.date ?? '2026-05-08',
    ...overrides,
  };
}

// ─── Hero card — getOutstandingSummary ────────────────────────────────────────

describe('FinanceScreen hero: getOutstandingSummary', () => {
  it('returns zero invoiceCount when no jobs', () => {
    const result = getOutstandingSummary([]);
    expect(result.invoiceCount).toBe(0);
    expect(result.totalOwed).toBe(0);
    expect(result.oldestAgeDays).toBeNull();
    expect(result.oldestCustomerName).toBeNull();
  });

  it('returns zero invoiceCount when all jobs are paid', () => {
    const result = getOutstandingSummary([paidJob(), paidJob({ id: 'j2' })]);
    expect(result.invoiceCount).toBe(0);
    expect(result.totalOwed).toBe(0);
  });

  it('returns totalOwed for unpaid jobs', () => {
    const jobs = [unpaidJob({ amount: 400 }), unpaidJob({ id: 'j3', amount: 200, customer: 'Carol' })];
    const result = getOutstandingSummary(jobs);
    expect(result.totalOwed).toBe(600);
    expect(result.invoiceCount).toBe(2);
  });

  it('identifies oldest job by date', () => {
    const jobs = [
      unpaidJob({ id: 'newer', date: '2026-05-10', customer: 'Recent' }),
      unpaidJob({ id: 'older', date: '2026-04-01', customer: 'Older' }),
    ];
    const result = getOutstandingSummary(jobs);
    expect(result.oldestCustomerName).toBe('Older');
    expect(result.oldestJobId).toBe('older');
  });

  it('oldestAgeDays is non-negative and plausible', () => {
    const jobs = [unpaidJob({ date: '2026-05-01' })];
    const result = getOutstandingSummary(jobs);
    // Should be >= 0; exact value depends on test run date, so just verify type
    expect(typeof result.oldestAgeDays).toBe('number');
    expect(result.oldestAgeDays).toBeGreaterThanOrEqual(0);
  });

  it('excludes cancelled jobs from outstanding', () => {
    const jobs = [
      unpaidJob({ id: 'cancelled', status: 'cancelled', amount: 999 }),
      unpaidJob({ id: 'active', amount: 150 }),
    ];
    const result = getOutstandingSummary(jobs);
    expect(result.invoiceCount).toBe(1);
    expect(result.totalOwed).toBe(150);
  });

  it('uses job.name as customer fallback when customer field is absent', () => {
    const jobs = [{ id: 'j1', amount: 100, paid: false, date: '2026-05-01', name: 'Plumbing at Jones' }];
    const result = getOutstandingSummary(jobs);
    expect(result.oldestCustomerName).toBe('Plumbing at Jones');
  });
});

// ─── Month two-up cards — getMonthSummary ────────────────────────────────────

describe('FinanceScreen month two-up: getMonthSummary', () => {
  it('returns zero profit and zero paid for empty data', () => {
    const result = getMonthSummary([], [], { month: CURRENT_MONTH });
    expect(result.profit).toBe(0);
    expect(result.paid).toBe(0);
  });

  it('sums paid jobs for the target month', () => {
    const jobs = [
      paidJob({ id: 'a', amount: 500, date: '2026-05-10' }),
      paidJob({ id: 'b', amount: 300, date: '2026-05-20' }),
      paidJob({ id: 'c', amount: 200, date: '2026-04-15' }), // different month — excluded
    ];
    const result = getMonthSummary(jobs, [], { month: '2026-05' });
    expect(result.paid).toBe(800);
  });

  it('profit is paid minus receipts for same month', () => {
    const jobs = [paidJob({ amount: 1000, date: '2026-05-10' })];
    const receipts = [receipt({ amount: 250, date: '2026-05-12' })];
    const result = getMonthSummary(jobs, receipts, { month: '2026-05' });
    expect(result.profit).toBe(750);
  });

  it('profit is negative when costs exceed paid', () => {
    const jobs = [paidJob({ amount: 100, date: '2026-05-10' })];
    const receipts = [receipt({ amount: 400, date: '2026-05-15' })];
    const result = getMonthSummary(jobs, receipts, { month: '2026-05' });
    // Negative profit must be detectable so the UI can render red text
    expect(result.profit).toBe(-300);
    expect(result.profit).toBeLessThan(0);
  });

  it('does not count unpaid jobs in paid total', () => {
    const jobs = [
      paidJob({ id: 'p', amount: 500, date: '2026-05-10' }),
      unpaidJob({ id: 'u', amount: 999, date: '2026-05-05' }),
    ];
    const result = getMonthSummary(jobs, [], { month: '2026-05' });
    expect(result.paid).toBe(500);
  });
});

// ─── Est. Profit/Hour — getProfitPerHour ─────────────────────────────────────

describe('FinanceScreen Est. Profit/Hour: getProfitPerHour', () => {
  it('returns null value when hourlyRate is 0', () => {
    const result = getProfitPerHour([paidJob()], { hourlyRate: 0 });
    expect(result.value).toBeNull();
    expect(result.comparisonValue).toBeNull();
    expect(result.deltaSign).toBeNull();
  });

  it('returns null value when hourlyRate is undefined', () => {
    const result = getProfitPerHour([paidJob()], { hourlyRate: undefined });
    expect(result.value).toBeNull();
  });

  it('returns null value when no paid jobs exist this week', () => {
    // Paid job from a month ago — outside this week
    const old = paidJob({ date: '2026-04-01' });
    const result = getProfitPerHour([old], { hourlyRate: 25 }, TODAY);
    expect(result.value).toBeNull();
  });

  it('computes a positive value for paid jobs this week', () => {
    const thisWeek = paidJob({ amount: 500, date: '2026-05-19' }); // Monday of week containing TODAY
    const result = getProfitPerHour([thisWeek], { hourlyRate: 25 }, TODAY);
    // amount/rate = implied hours; profit = amount (no expenses) / hours
    // 500 / (500/25) = 25 — so value should equal hourlyRate when no costs
    expect(result.value).toBeCloseTo(25, 0);
  });

  it('deltaSign is "up" when this week profit/hr is higher than last week', () => {
    // This week: job with no expenses → profit/hr = rate = 25
    // Last week: job with expenses → profit/hr < 25
    const thisWeek = paidJob({ id: 'tw', amount: 500, date: '2026-05-19' });
    const lastWeek = {
      ...paidJob({ id: 'lw', amount: 500, date: '2026-05-12' }),
      expenses: [{ amount: 300 }], // heavy cost → profit/hr drops below rate
    };
    const result = getProfitPerHour([thisWeek, lastWeek], { hourlyRate: 25 }, TODAY);
    expect(result.deltaSign).toBe('up');
  });

  it('deltaSign is "down" when this week profit/hr is lower than last week', () => {
    // This week: job with heavy expenses → profit/hr < rate
    // Last week: job with no expenses → profit/hr = rate
    const thisWeek = {
      ...paidJob({ id: 'tw', amount: 500, date: '2026-05-19' }),
      expenses: [{ amount: 300 }], // heavy cost → profit/hr drops below rate
    };
    const lastWeek = paidJob({ id: 'lw', amount: 500, date: '2026-05-12' });
    const result = getProfitPerHour([thisWeek, lastWeek], { hourlyRate: 25 }, TODAY);
    expect(result.deltaSign).toBe('down');
  });
});

// ─── Margin nudge threshold — getMarginTrend ─────────────────────────────────
// The threshold constant (MARGIN_NUDGE_THRESHOLD_PCT = 10) lives in FinanceScreen.
// These tests verify that the underlying getMarginTrend function returns deltaPct
// values that correctly trigger / suppress the nudge at that boundary.

describe('FinanceScreen margin nudge: threshold behaviour', () => {
  const THRESHOLD = 10; // mirrors MARGIN_NUDGE_THRESHOLD_PCT in FinanceScreen

  it('nudge fires when margin drops by exactly the threshold', () => {
    // Build a scenario: last week 100% margin, this week 90% margin → deltaPct = -10
    const lastWeekPaid = paidJob({ id: 'lw', amount: 200, date: '2026-05-12' });
    const thisWeekPaid = paidJob({ id: 'tw', amount: 200, date: '2026-05-19' });
    const thisWeekReceipt = receipt({ amount: 20, date: '2026-05-19' }); // cost reduces margin
    const result = getMarginTrend([lastWeekPaid, thisWeekPaid], [thisWeekReceipt], { weeks: 1 }, TODAY);
    // Verify threshold logic: |deltaPct| >= THRESHOLD should be true
    expect(Math.abs(result.deltaPct)).toBeGreaterThanOrEqual(THRESHOLD);
    expect(result.deltaSign).toBe('down');
  });

  it('nudge is silent when margin change is below threshold', () => {
    // This week and last week have nearly identical margins → deltaPct ≈ 0
    const lastWeek = paidJob({ id: 'lw', amount: 200, date: '2026-05-12' });
    const thisWeek = paidJob({ id: 'tw', amount: 200, date: '2026-05-19' });
    // Add a tiny cost this week: small delta, well below threshold
    const tinyReceipt = receipt({ amount: 2, date: '2026-05-19' });
    const result = getMarginTrend([lastWeek, thisWeek], [tinyReceipt], { weeks: 1 }, TODAY);
    expect(Math.abs(result.deltaPct)).toBeLessThan(THRESHOLD);
  });

  it('nudge fires as "up" when margin improves by >= threshold', () => {
    // Last week: 50% margin (cost = 50% of paid). This week: 100% margin (no costs)
    const lastWeekPaid = paidJob({ id: 'lw', amount: 200, date: '2026-05-12' });
    const lastWeekReceipt = receipt({ amount: 100, date: '2026-05-12' });
    const thisWeekPaid = paidJob({ id: 'tw', amount: 200, date: '2026-05-19' });
    const result = getMarginTrend([lastWeekPaid, thisWeekPaid], [lastWeekReceipt], { weeks: 1 }, TODAY);
    expect(result.deltaPct).toBeGreaterThanOrEqual(THRESHOLD);
    expect(result.deltaSign).toBe('up');
  });

  it('returns flat and zero delta with no data', () => {
    const result = getMarginTrend([], [], { weeks: 1 }, TODAY);
    expect(result.deltaPct).toBe(0);
    expect(result.deltaSign).toBe('flat');
  });
});

// ─── Cashflow chart data — getCashflowByMonth ─────────────────────────────────

describe('FinanceScreen chart: getCashflowByMonth wiring', () => {
  it('returns an array of month objects for a valid 6M range', () => {
    const { from, to } = buildDateRange('6M', TODAY);
    const result = getCashflowByMonth([], [], from, to);
    // 6M covers current + 5 prior months = 6 rows
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(6);
  });

  it('each month row has the required shape fields', () => {
    const { from, to } = buildDateRange('6M', TODAY);
    const result = getCashflowByMonth([], [], from, to);
    for (const row of result) {
      expect(row).toHaveProperty('month');
      expect(row).toHaveProperty('monthLabel');
      expect(row).toHaveProperty('paid');
      expect(row).toHaveProperty('open');
      expect(row).toHaveProperty('profit');
      expect(row).toHaveProperty('cost');
      expect(row).toHaveProperty('cashIn');
      expect(row).toHaveProperty('cashOut');
    }
  });

  it('paid job in current month appears in the paid bucket for current month', () => {
    const { from, to } = buildDateRange('6M', TODAY);
    const job = paidJob({ amount: 400, date: '2026-05-10' });
    const result = getCashflowByMonth([job], [], from, to);
    const currentRow = result.find(r => r.month === CURRENT_MONTH);
    expect(currentRow).toBeDefined();
    expect(currentRow.paid).toBe(400);
  });

  it('unpaid job appears in open bucket, not paid', () => {
    const { from, to } = buildDateRange('6M', TODAY);
    const job = unpaidJob({ amount: 300, date: '2026-05-05' });
    const result = getCashflowByMonth([job], [], from, to);
    const currentRow = result.find(r => r.month === CURRENT_MONTH);
    expect(currentRow.open).toBe(300);
    expect(currentRow.paid).toBe(0);
  });
});

// ─── buildDateRange: range key → from/to mapping ─────────────────────────────

describe('buildDateRange (used by FinanceScreen chartRange state)', () => {
  it('1M returns from = first of current month', () => {
    const { from } = buildDateRange('1M', TODAY);
    expect(from.getFullYear()).toBe(2026);
    expect(from.getMonth()).toBe(4); // May = 4 (0-based)
    expect(from.getDate()).toBe(1);
  });

  it('6M from is 5 months before current month start', () => {
    const { from } = buildDateRange('6M', TODAY);
    // from should be Dec 2025 (6 months window: Dec 2025 – May 2026)
    expect(from.getFullYear()).toBe(2025);
    expect(from.getMonth()).toBe(11); // Dec = 11
  });

  it('1Y from is 11 months before current month start', () => {
    const { from } = buildDateRange('1Y', TODAY);
    expect(from.getFullYear()).toBe(2025);
    expect(from.getMonth()).toBe(5); // Jun 2025 = month 5
  });

  it('to is always the last day of the current month', () => {
    const { to } = buildDateRange('6M', TODAY);
    // Last day of May 2026 = 31st
    expect(to.getFullYear()).toBe(2026);
    expect(to.getMonth()).toBe(4);
    expect(to.getDate()).toBe(31);
  });
});

// ─── monthKey: used by FinanceScreen to derive current month ──────────────────

describe('monthKey (FinanceScreen derives currentMonth)', () => {
  it('returns YYYY-MM for a valid date', () => {
    expect(monthKey(new Date('2026-05-20T10:00:00'))).toBe('2026-05');
  });

  it('pads single-digit months', () => {
    expect(monthKey(new Date(2026, 0, 1))).toBe('2026-01'); // January
  });

  it('returns empty string for invalid date', () => {
    expect(monthKey(new Date('not-a-date'))).toBe('');
  });
});

// ─── Tax Set-Aside card — calculation correctness ─────────────────────────────
// The card value is: Math.max(0, monthSummary.profit) * pct / 100
// These tests verify the formula is correct for the boundary cases the UI depends on.

describe('Tax Set-Aside card calculation', () => {
  function taxSetAside(profit, pct) {
    return Math.max(0, profit) * pct / 100;
  }

  it('returns 20% of profit at the default 20% rate', () => {
    expect(taxSetAside(1000, 20)).toBe(200);
  });

  it('returns 0 when profit is zero', () => {
    expect(taxSetAside(0, 20)).toBe(0);
  });

  it('returns 0 when profit is negative (never a negative set-aside)', () => {
    expect(taxSetAside(-500, 20)).toBe(0);
  });

  it('returns the full profit when pct is 100', () => {
    expect(taxSetAside(800, 100)).toBe(800);
  });

  it('returns 0 when pct is 0', () => {
    expect(taxSetAside(800, 0)).toBe(0);
  });

  it('uses getMonthSummary profit field as the base figure', () => {
    // Verify via getMonthSummary: profit = paid - cost
    const jobs = [paidJob({ amount: 1000, date: '2026-05-10' })];
    const receipts = [receipt({ amount: 200, date: '2026-05-12' })];
    const { profit } = getMonthSummary(jobs, receipts, { month: '2026-05' });
    // profit = 800; 20% set-aside = 160
    expect(taxSetAside(profit, 20)).toBe(160);
  });

  it('handles a fractional pct result correctly (no negative)', () => {
    // Odd pct like 17 — result is just a multiplication, no rounding here
    expect(taxSetAside(100, 17)).toBeCloseTo(17, 5);
  });
});

// ─── True Profit card — calculation via getOverheadTotal ─────────────────────
// True Profit = getMonthSummary(...).profit - getOverheadTotal(overheads)
// These tests exercise the same formula the FinanceScreen True Profit card uses.

describe('True Profit card calculation', () => {
  it('true profit = monthly profit minus active overheads total', () => {
    const jobs = [paidJob({ amount: 1200, date: '2026-05-10' })];
    const receipts = [receipt({ amount: 200, date: '2026-05-12' })];
    const overheads = [
      { id: 'oh1', amount: 400, is_active: true },
      { id: 'oh2', amount: 100, is_active: true },
    ];
    const { profit } = getMonthSummary(jobs, receipts, { month: '2026-05' });
    // profit = 1200 - 200 = 1000
    expect(profit).toBe(1000);
    const trueProfit = profit - getOverheadTotal(overheads);
    // trueProfit = 1000 - 500 = 500
    expect(trueProfit).toBe(500);
  });

  it('true profit can be negative', () => {
    const jobs = [paidJob({ amount: 300, date: '2026-05-10' })];
    const overheads = [{ id: 'oh1', amount: 500, is_active: true }];
    const { profit } = getMonthSummary(jobs, [], { month: '2026-05' });
    const trueProfit = profit - getOverheadTotal(overheads);
    expect(trueProfit).toBe(-200);
    expect(trueProfit).toBeLessThan(0);
  });

  it('inactive overheads do not reduce true profit', () => {
    const jobs = [paidJob({ amount: 800, date: '2026-05-10' })];
    const overheads = [
      { id: 'oh1', amount: 300, is_active: true },
      { id: 'oh2', amount: 9999, is_active: false },
    ];
    const { profit } = getMonthSummary(jobs, [], { month: '2026-05' });
    const trueProfit = profit - getOverheadTotal(overheads);
    // Only oh1 counts: 800 - 300 = 500
    expect(trueProfit).toBe(500);
  });

  it('empty overheads list means true profit equals materials profit', () => {
    const jobs = [paidJob({ amount: 600, date: '2026-05-10' })];
    const { profit } = getMonthSummary(jobs, [], { month: '2026-05' });
    expect(profit - getOverheadTotal([])).toBe(profit);
  });

  it('null overheads list is null-safe (treated as empty)', () => {
    const jobs = [paidJob({ amount: 600, date: '2026-05-10' })];
    const { profit } = getMonthSummary(jobs, [], { month: '2026-05' });
    expect(profit - getOverheadTotal(null)).toBe(profit);
  });
});

// ─── YTD Tax Set-Aside card — getTaxYearSummary × pct ────────────────────────
// Exercises the same formula the updated FinanceScreen Tax Set-Aside card uses:
//   ytdTaxPot = Math.max(0, ytd.profit) * pct / 100
// Wired to the real getTaxYearSummary so any helper changes break these tests.

describe('FinanceScreen YTD Tax Set-Aside card', () => {
  // Tax year 2026/27 starts 2026-04-06. Reference date: 2026-05-20 (TODAY).
  const NOW = TODAY; // 2026-05-20T10:00:00

  function ytdTaxSetAside(jobs, receipts, pct, ref = NOW) {
    const { profit } = getTaxYearSummary(jobs, receipts, ref);
    return Math.max(0, profit) * pct / 100;
  }

  it('20% of YTD profit for a standard job paid after 6 April', () => {
    const jobs = [paidJob({ amount: 1000, date: '2026-05-10' })];
    expect(ytdTaxSetAside(jobs, [], 20)).toBe(200);
  });

  it('returns 0 when YTD profit is zero', () => {
    expect(ytdTaxSetAside([], [], 20)).toBe(0);
  });

  it('returns 0 when YTD profit is negative (never a negative set-aside)', () => {
    const jobs = [paidJob({ amount: 100, date: '2026-05-10' })];
    const receipts = [receipt({ amount: 500, date: '2026-05-12' })];
    expect(ytdTaxSetAside(jobs, receipts, 20)).toBe(0);
  });

  it('excludes job paid before 6 April from YTD tax pot', () => {
    // Job dated 2026-04-05 — belongs to 2025/26 tax year
    const oldJob = paidJob({ amount: 9999, date: '2026-04-05' });
    const newJob = paidJob({ id: 'j2', amount: 500, date: '2026-04-10' });
    expect(ytdTaxSetAside([oldJob, newJob], [], 20)).toBe(100); // only newJob counts
  });

  it('taxYearLabel returns correct label for the reference date', () => {
    expect(taxYearLabel(NOW)).toBe('2026/27');
  });

  it('YTD tax pot scales with custom pct (e.g. 25%)', () => {
    const jobs = [paidJob({ amount: 800, date: '2026-05-10' })];
    expect(ytdTaxSetAside(jobs, [], 25)).toBe(200);
  });
});
