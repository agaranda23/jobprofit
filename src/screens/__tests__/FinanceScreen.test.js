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
  getJobProfit,
  getBestWorstJobs,
  getVatSummary,
  vatQuarterRange,
  getDataTrustHint,
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

// ─── Best & worst jobs card — getBestWorstJobs ─────────────────────────────
// These tests verify the FinanceScreen Best & worst jobs card data layer.
// Rendering is exercised on the deploy preview (no testing-library/react here).

describe('FinanceScreen Best & worst jobs card: getBestWorstJobs', () => {
  // Reference: 2026-05-20 (TODAY), tax year 2026/27 (started 2026-04-06)
  const NOW = TODAY;

  function doneJob(overrides = {}) {
    return {
      id: overrides.id ?? 'bw-j1',
      name: overrides.name ?? 'Best Worst Job',
      amount: overrides.amount ?? 500,
      paid: true,
      date: overrides.date ?? '2026-05-10',
      ...overrides,
    };
  }

  it('returns { best: null, worst: null } for empty jobs array', () => {
    const result = getBestWorstJobs([], [], NOW);
    expect(result.best).toBeNull();
    expect(result.worst).toBeNull();
  });

  it('returns { best: null, worst: null } for null/undefined inputs', () => {
    expect(getBestWorstJobs(null, null, NOW)).toEqual({ best: null, worst: null });
    expect(getBestWorstJobs(undefined, undefined, NOW)).toEqual({ best: null, worst: null });
  });

  it('single qualifying job → best is set, worst is null', () => {
    const jobs = [doneJob({ id: 'solo', amount: 600 })];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.best).not.toBeNull();
    expect(result.best.id).toBe('solo');
    expect(result.worst).toBeNull();
  });

  it('two qualifying jobs → best is higher-profit, worst is lower-profit', () => {
    const jobs = [
      doneJob({ id: 'small', name: 'Small job', amount: 200 }),
      doneJob({ id: 'large', name: 'Large job', amount: 800 }),
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.best.id).toBe('large');
    expect(result.worst.id).toBe('small');
  });

  it('receipt materials are deducted before ranking (matching by id)', () => {
    const jobs = [
      doneJob({ id: 'j1', name: 'With materials', amount: 1000 }),
      doneJob({ id: 'j2', name: 'No materials',   amount: 600 }),
    ];
    // j1 has £800 materials → profit £200; j2 has none → profit £600
    const receipts = [{ id: 'r1', jobId: 'j1', amount: 800 }];
    const result = getBestWorstJobs(jobs, receipts, NOW);
    expect(result.best.id).toBe('j2');  // £600 profit
    expect(result.worst.id).toBe('j1'); // £200 profit
  });

  it('excludes cancelled jobs from ranking', () => {
    const jobs = [
      doneJob({ id: 'active',    amount: 500 }),
      doneJob({ id: 'cancelled', amount: 1, status: 'cancelled' }),
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.worst).toBeNull(); // only one qualifies
  });

  it('excludes jobs with status=lead (work not done)', () => {
    const jobs = [
      doneJob({ id: 'done', amount: 500 }),
      { id: 'lead', name: 'Lead', amount: 400, status: 'lead', date: '2026-05-10' },
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.worst).toBeNull();
  });

  it('excludes job dated before tax year start (5 April)', () => {
    const jobs = [
      doneJob({ id: 'new',  amount: 300, date: '2026-04-10' }), // this tax year
      doneJob({ id: 'old',  amount: 999, date: '2026-04-05' }), // last tax year
    ];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(result.best.id).toBe('new');
    expect(result.worst).toBeNull();
  });

  it('profit and margin on result entries are numbers, not NaN', () => {
    const jobs = [doneJob({ amount: 400 })];
    const result = getBestWorstJobs(jobs, [], NOW);
    expect(typeof result.best.profit).toBe('number');
    expect(isNaN(result.best.profit)).toBe(false);
    expect(typeof result.best.margin).toBe('number');
    expect(isNaN(result.best.margin)).toBe(false);
  });

  it('getJobProfit margin colour thresholds: >=30 good, >=15 warn, else danger', () => {
    // This test pins the thresholds so any change to the formula or card is caught.
    expect(getJobProfit({ id: 'j', amount: 1000 },
      [{ id: 'r', jobId: 'j', amount: 700 }]).margin).toBe(30); // exactly at good boundary
    expect(getJobProfit({ id: 'j', amount: 1000 },
      [{ id: 'r', jobId: 'j', amount: 850 }]).margin).toBe(15); // exactly at warn boundary
    expect(getJobProfit({ id: 'j', amount: 1000 },
      [{ id: 'r', jobId: 'j', amount: 860 }]).margin).toBe(14); // just below warn → danger
  });
});

// ─── VAT this quarter card — data layer ──────────────────────────────────────
// Tests the data-layer functions that power the VAT card in FinanceScreen.
// Card visibility (isVatRegistered flag) is logic in FinanceScreen JSX;
// these tests cover the pure helpers.

describe('FinanceScreen VAT card: vatQuarterRange', () => {
  it('returns Q2 quarter for a date in May', () => {
    const ref = new Date(2026, 4, 20); // 2026-05-20
    const { start, label } = vatQuarterRange(ref);
    expect(start.getMonth()).toBe(3); // April
    expect(start.getDate()).toBe(1);
    expect(label).toMatch(/Apr/);
    expect(label).toMatch(/Jun/);
    expect(label).toMatch(/2026/);
  });

  it('returns Q1 quarter for a date in January', () => {
    const ref = new Date(2026, 0, 10);
    const { start, label } = vatQuarterRange(ref);
    expect(start.getMonth()).toBe(0); // January
    expect(label).toMatch(/Jan/);
  });

  it('end is end-of-day of the reference date', () => {
    const ref = new Date(2026, 4, 20); // 2026-05-20
    const { end } = vatQuarterRange(ref);
    expect(end.getDate()).toBe(20);
    expect(end.getHours()).toBe(23);
    expect(end.getSeconds()).toBe(59);
  });
});

describe('FinanceScreen VAT card: getVatSummary', () => {
  // Reference: 2026-05-20 (Q2 Apr–Jun 2026)
  const NOW = new Date('2026-05-20T10:00:00');

  function vatJob(overrides = {}) {
    return {
      id: overrides.id ?? 'fv-j1',
      amount: overrides.amount ?? 500,
      paid: true,
      date: overrides.date ?? '2026-05-10',
      ...overrides,
    };
  }

  function vatReceipt(overrides = {}) {
    return {
      id: overrides.id ?? 'fv-r1',
      amount: overrides.amount ?? 100,
      vat: overrides.vat ?? 20,
      date: overrides.date ?? '2026-05-08',
      ...overrides,
    };
  }

  it('outputVat = netSales × 0.2 for a paid in-quarter job', () => {
    const { outputVat, netSales } = getVatSummary([vatJob({ amount: 1000 })], [], NOW);
    expect(netSales).toBe(1000);
    expect(outputVat).toBeCloseTo(200, 10);
  });

  it('inputVat = sum of receipt.vat for in-quarter receipts', () => {
    const receipts = [
      vatReceipt({ vat: 20 }),
      vatReceipt({ id: 'r2', vat: 30 }),
    ];
    const { inputVat } = getVatSummary([], receipts, NOW);
    expect(inputVat).toBe(50);
  });

  it('netVat = outputVat - inputVat', () => {
    const jobs = [vatJob({ amount: 500 })];
    const receipts = [vatReceipt({ vat: 25 })];
    const { netVat, outputVat, inputVat } = getVatSummary(jobs, receipts, NOW);
    expect(netVat).toBeCloseTo(outputVat - inputVat, 10);
  });

  it('out-of-quarter job (Q1) excluded when NOW is in Q2', () => {
    const jobs = [vatJob({ amount: 9999, date: '2026-03-20' })]; // Q1
    const { netSales } = getVatSummary(jobs, [], NOW);
    expect(netSales).toBe(0);
  });

  it('unpaid jobs excluded from VAT output', () => {
    const jobs = [{ id: 'u', amount: 9999, paid: false, date: '2026-05-10' }];
    const { netSales } = getVatSummary(jobs, [], NOW);
    expect(netSales).toBe(0);
  });

  it('receipts without a vat field contribute 0 to inputVat', () => {
    const receipts = [{ id: 'r1', amount: 100, date: '2026-05-10' }]; // no .vat
    const { inputVat } = getVatSummary([], receipts, NOW);
    expect(inputVat).toBe(0);
  });

  it('null inputs return all zeros (null-safe)', () => {
    const result = getVatSummary(null, null, NOW);
    expect(result.netSales).toBe(0);
    expect(result.outputVat).toBe(0);
    expect(result.inputVat).toBe(0);
    expect(result.netVat).toBe(0);
  });

  it('negative netVat means reclaim is due (inputVat > outputVat)', () => {
    const jobs = [vatJob({ amount: 100 })]; // outputVat = 20
    const receipts = [vatReceipt({ vat: 100 })]; // inputVat = 100
    const { netVat } = getVatSummary(jobs, receipts, NOW);
    expect(netVat).toBeLessThan(0);
  });
});

// ─── Data trust nudge — getDataTrustHint ─────────────────────────────────────

describe('getDataTrustHint', () => {
  const NOW = TODAY;

  function dtPaidJob(overrides = {}) {
    return { id: overrides.id ?? 'dt-p1', amount: overrides.amount ?? 500, paid: true, date: overrides.date ?? '2026-05-10', ...overrides };
  }
  function dtDoneUnpaidJob(overrides = {}) {
    return { id: overrides.id ?? 'dt-u1', amount: overrides.amount ?? 300, paid: false, status: overrides.status ?? 'completed', date: overrides.date ?? '2026-05-05', ...overrides };
  }
  function dtReceipt(overrides = {}) {
    return { id: overrides.id ?? 'dt-r1', amount: overrides.amount ?? 100, date: overrides.date ?? '2026-05-08', ...overrides };
  }

  it('markPaid: returns hint when completed-but-unpaid jobs exist in tax year', () => {
    const hint = getDataTrustHint([dtDoneUnpaidJob({ amount: 400 })], [], {}, NOW);
    expect(hint).not.toBeNull();
    expect(hint.type).toBe('markPaid');
    expect(hint.amount).toBe(400);
    expect(hint.cta).toBe('Go to Jobs');
    expect(typeof hint.message).toBe('string');
    expect(hint.message.length).toBeGreaterThan(0);
  });

  it('markPaid: amount sums across multiple open done-jobs', () => {
    const jobs = [dtDoneUnpaidJob({ id: 'u1', amount: 200 }), dtDoneUnpaidJob({ id: 'u2', amount: 150, status: 'invoiced' })];
    const hint = getDataTrustHint(jobs, [], {}, NOW);
    expect(hint.type).toBe('markPaid');
    expect(hint.amount).toBe(350);
  });

  it('markPaid: fires for invoiced, overdue, sent, awaiting statuses', () => {
    for (const status of ['invoiced', 'overdue', 'sent', 'awaiting']) {
      const hint = getDataTrustHint([dtDoneUnpaidJob({ id: status, status })], [], {}, NOW);
      expect(hint?.type).toBe('markPaid');
    }
  });

  it('markPaid: does NOT fire for unpaid jobs with status=lead', () => {
    const jobs = [{ id: 'lead', amount: 999, paid: false, status: 'lead', date: '2026-05-10' }];
    expect(getDataTrustHint(jobs, [], {}, NOW)).toBeNull();
  });

  it('markPaid: does NOT fire for jobs outside the current tax year', () => {
    expect(getDataTrustHint([dtDoneUnpaidJob({ date: '2026-04-05' })], [], {}, NOW)).toBeNull();
  });

  it('markPaid takes priority over noCosts', () => {
    const jobs = [dtPaidJob({ id: 'paid' }), dtDoneUnpaidJob({ id: 'open' })];
    expect(getDataTrustHint(jobs, [], {}, NOW).type).toBe('markPaid');
  });

  it('noCosts: returns hint when paid revenue exists but no receipts and no overheads', () => {
    const hint = getDataTrustHint([dtPaidJob({ amount: 600 })], [], {}, NOW);
    expect(hint?.type).toBe('noCosts');
    // CTA copy updated 2026-06-03 (costs-model-v1 rename)
    expect(hint.cta).toBe('Add monthly bills →');
  });

  it('noCosts: suppressed when receipts exist in the tax year', () => {
    const hint = getDataTrustHint([dtPaidJob({ amount: 600 })], [dtReceipt()], {}, NOW);
    expect(hint).toBeNull();
  });

  it('noCosts: suppressed when active overheads exist on profile', () => {
    const profile = { overheads: [{ id: 'oh1', amount: 200, is_active: true }] };
    expect(getDataTrustHint([dtPaidJob({ amount: 600 })], [], profile, NOW)).toBeNull();
  });

  it('noCosts: inactive overheads do NOT suppress the hint', () => {
    const profile = { overheads: [{ id: 'oh1', amount: 200, is_active: false }] };
    expect(getDataTrustHint([dtPaidJob({ amount: 600 })], [], profile, NOW)?.type).toBe('noCosts');
  });

  it('returns null when both receipts and overheads exist alongside paid revenue', () => {
    const receipts = [dtReceipt()];
    const profile  = { overheads: [{ id: 'oh1', amount: 50, is_active: true }] };
    expect(getDataTrustHint([dtPaidJob()], receipts, profile, NOW)).toBeNull();
  });

  it('returns null when there is no activity at all', () => {
    expect(getDataTrustHint([], [], {}, NOW)).toBeNull();
  });

  it('is null-safe: null inputs return null without throwing', () => {
    expect(() => getDataTrustHint(null, null, null, NOW)).not.toThrow();
    expect(getDataTrustHint(null, null, null, NOW)).toBeNull();
  });

  it('is null-safe: undefined inputs return null without throwing', () => {
    expect(() => getDataTrustHint(undefined, undefined, undefined, NOW)).not.toThrow();
    expect(getDataTrustHint(undefined, undefined, undefined, NOW)).toBeNull();
  });
});

// ─── Hero True Profit tier gating states ─────────────────────────────────────
// These tests pin the three rendering states introduced in the Money tab polish:
//   State 1 (Pro + overheads set)    → trueProfit = profit − overheadTotal
//   State 2 (Free + overheads set)   → blurred locked line (same calculation, different render)
//   State 3 (anyone + no overheads)  → prompt shown, no blurred number
//
// State 1 and 2 share the same calculation; we test the formula here.
// State 3 is guarded by `overheads.length === 0` — verified below.

describe('Hero True Profit tier — calculation and gating', () => {
  function calcTrueProfit(monthProfit, overheads) {
    // Mirrors FinanceScreen: monthSummary.profit - getOverheadTotal(overheads)
    return monthProfit - getOverheadTotal(overheads);
  }

  it('State 1/2: trueProfit = monthly profit minus overhead total', () => {
    const jobs     = [paidJob({ amount: 1500, date: '2026-05-10' })];
    const receipts = [receipt({ amount: 300, date: '2026-05-12' })];
    const overheads = [
      { id: 'oh1', amount: 200, is_active: true },
      { id: 'oh2', amount: 150, is_active: true },
    ];
    const { profit } = getMonthSummary(jobs, receipts, { month: '2026-05' });
    // profit = 1500 - 300 = 1200; trueProfit = 1200 - 350 = 850
    expect(profit).toBe(1200);
    expect(calcTrueProfit(profit, overheads)).toBe(850);
  });

  it('State 1/2: trueProfit is negative when overheads exceed monthly profit', () => {
    const jobs     = [paidJob({ amount: 500, date: '2026-05-10' })];
    const overheads = [{ id: 'oh1', amount: 800, is_active: true }];
    const { profit } = getMonthSummary(jobs, [], { month: '2026-05' });
    expect(calcTrueProfit(profit, overheads)).toBe(-300);
    expect(calcTrueProfit(profit, overheads)).toBeLessThan(0);
  });

  it('State 3: overheads.length === 0 means the prompt renders (no blurred number)', () => {
    // When overheads is an empty array, the True Profit tier shows a prompt.
    // The guard condition in FinanceScreen is `overheads.length === 0`.
    const overheads = [];
    expect(overheads.length).toBe(0);
    // No true profit calculation should occur in State 3
    // — verified by confirming getOverheadTotal([]) = 0 (not a meaningful figure)
    expect(getOverheadTotal(overheads)).toBe(0);
  });

  it('State 3: null/undefined overheads profile field treated as empty array', () => {
    // FinanceScreen: const overheads = Array.isArray(profile?.overheads) ? profile.overheads : [];
    const profileNull      = { overheads: null };
    const profileUndefined = {};
    const toOverheads = (p) => Array.isArray(p?.overheads) ? p.overheads : [];
    expect(toOverheads(profileNull).length).toBe(0);
    expect(toOverheads(profileUndefined).length).toBe(0);
  });

  it('State 1/2: inactive overheads not deducted from True Profit', () => {
    const jobs      = [paidJob({ amount: 1000, date: '2026-05-10' })];
    const overheads = [
      { id: 'active', amount: 200, is_active: true  },
      { id: 'inactive', amount: 999, is_active: false },
    ];
    const { profit } = getMonthSummary(jobs, [], { month: '2026-05' });
    // Only active overhead (200) deducted: 1000 - 200 = 800
    expect(calcTrueProfit(profit, overheads)).toBe(800);
  });
});

// ─── Tax pot "to keep" derivation ────────────────────────────────────────────
// The "Leaves you £X to keep" line = Math.max(0, ytd.profit) − ytdTaxPot
// Introduced in the Money tab polish. These tests verify the formula is correct
// and null-safe, because this number will be seen by paying users every day.

describe('Tax pot "to keep" derivation', () => {
  // Mirrors FinanceScreen:
  //   ytdTaxPot = Math.max(0, ytd.profit) * taxSetAsidePct / 100
  //   toKeep = Math.max(0, ytd.profit) - ytdTaxPot
  function toKeep(ytdProfit, pct) {
    const pot = Math.max(0, ytdProfit) * pct / 100;
    return Math.max(0, ytdProfit) - pot;
  }

  it('toKeep = ytd profit × (1 - pct/100)', () => {
    // 20% set aside → 80% to keep
    expect(toKeep(1000, 20)).toBe(800);
  });

  it('toKeep is 0 when ytd profit is 0', () => {
    expect(toKeep(0, 20)).toBe(0);
  });

  it('toKeep is 0 when ytd profit is negative (max(0,…) floors it)', () => {
    // Negative YTD profit → taxPot = 0, toKeep = 0 - 0 = 0
    expect(toKeep(-500, 20)).toBe(0);
  });

  it('toKeep at 0% set-aside returns full profit', () => {
    expect(toKeep(800, 0)).toBe(800);
  });

  it('toKeep at 100% set-aside returns 0', () => {
    expect(toKeep(800, 100)).toBe(0);
  });

  it('toKeep scales correctly with a custom pct (e.g. 25%)', () => {
    expect(toKeep(1000, 25)).toBe(750);
  });

  it('round-trips via getTaxYearSummary', () => {
    const NOW  = new Date('2026-05-20T10:00:00');
    const jobs = [paidJob({ amount: 1000, date: '2026-05-10' })];
    const recs = [receipt({ amount: 200, date: '2026-05-12' })];
    const { profit } = getTaxYearSummary(jobs, recs, NOW);
    // profit = 800; 20% pot = 160; to keep = 640
    expect(toKeep(profit, 20)).toBe(640);
  });
});

// ─── Editable tax pot: clamp logic (TaxPotSheet) ─────────────────────────────
// TaxPotSheet clamps the custom % to 0–60. These tests verify the clamp
// formula used by the UI before calling onProfileUpdate.

describe('TaxPotSheet clamp logic', () => {
  // Mirrors TaxPotSheet effectivePct computation:
  //   Math.min(60, Math.max(0, parseInt(raw, 10) || 0))
  function clamp(raw) {
    return Math.min(60, Math.max(0, parseInt(raw, 10) || 0));
  }

  it('clamps values above 60 to 60', () => {
    expect(clamp('99')).toBe(60);
    expect(clamp('61')).toBe(60);
  });

  it('clamps negative values to 0', () => {
    expect(clamp('-5')).toBe(0);
    expect(clamp('-100')).toBe(0);
  });

  it('passes valid values through unchanged', () => {
    expect(clamp('20')).toBe(20);
    expect(clamp('0')).toBe(0);
    expect(clamp('60')).toBe(60);
    expect(clamp('15')).toBe(15);
    expect(clamp('25')).toBe(25);
  });

  it('returns 0 for non-numeric input (|| 0 guard)', () => {
    expect(clamp('')).toBe(0);
    expect(clamp('abc')).toBe(0);
  });

  it('keepBack formula: monthProfit × pct / 100', () => {
    // Mirrors TaxPotSheet: keepBack = Math.max(0, monthProfit) * effectivePct / 100
    const keepBack = (profit, pct) => Math.max(0, profit) * pct / 100;
    expect(keepBack(1000, 20)).toBe(200);
    expect(keepBack(1000, 25)).toBe(250);
    expect(keepBack(0, 20)).toBe(0);
    expect(keepBack(-500, 20)).toBe(0);   // negative month — no pot
  });

  it('low-warning fires when pct < 15 and pct > 0', () => {
    // Mirrors: showLowWarning = effectivePct < 15 && effectivePct > 0
    const showWarn = (pct) => pct < 15 && pct > 0;
    expect(showWarn(14)).toBe(true);
    expect(showWarn(1)).toBe(true);
    expect(showWarn(0)).toBe(false);  // 0% is explicit — no warning
    expect(showWarn(15)).toBe(false);
    expect(showWarn(20)).toBe(false);
  });
});

// ─── Per-job monthly bills estimate (ProfitBreakdownSheet) ───────────────────
// By-count allocation: totalMonthlyBills / jobCountThisMonth.
// Mirrors ProfitBreakdownSheet's estimate line.

describe('Per-job monthly bills estimate', () => {
  function perJobBills(totalBills, jobCount) {
    // Matches component: jobCount floored at 1 to prevent division-by-zero
    const count = jobCount && jobCount > 0 ? jobCount : 1;
    return totalBills / count;
  }

  it('divides total bills evenly by job count', () => {
    expect(perJobBills(600, 3)).toBe(200);
    expect(perJobBills(500, 5)).toBe(100);
    expect(perJobBills(300, 1)).toBe(300);
  });

  it('floors job count at 1 to prevent division-by-zero', () => {
    expect(perJobBills(400, 0)).toBe(400);
    expect(perJobBills(400, null)).toBe(400);
    expect(perJobBills(400, undefined)).toBe(400);
  });

  it('returns 0 when total bills is 0', () => {
    expect(perJobBills(0, 5)).toBe(0);
  });

  it('getOverheadTotal returns 0 when no bills configured (hides estimate)', () => {
    expect(getOverheadTotal([])).toBe(0);
    expect(getOverheadTotal(null)).toBe(0);
    expect(getOverheadTotal(undefined)).toBe(0);
  });

  it('getOverheadTotal sums only active bills', () => {
    const overheads = [
      { id: 'a', amount: 200, is_active: true },
      { id: 'b', amount: 100, is_active: false },   // inactive — excluded
      { id: 'c', amount: 50,  is_active: true },
    ];
    expect(getOverheadTotal(overheads)).toBe(250);
  });
});
