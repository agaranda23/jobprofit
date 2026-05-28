/**
 * CashflowChart.helpers.js — pure functions and sample data for CashflowChart.
 *
 * Kept in a separate file so the component file exports only the React component
 * (satisfies react-refresh/only-export-components).
 *
 * Imported by:
 *   - CashflowChart.jsx (MODE_BARS, filterByRange, computeBarWidthPct, etc.)
 *   - AppShell.jsx (SAMPLE_DATA for the dev-flag preview)
 *   - CashflowChart.test.jsx (all exports)
 */

// ─── Mode → bar field mapping ─────────────────────────────────────────────────
// Semantic colour vars are defined in CashflowChart.css.

export const MODE_BARS = {
  paidVsOpen:   { a: { field: 'paid',    color: 'var(--cf-green)', label: 'Paid'    },
                  b: { field: 'open',    color: 'var(--cf-red)',   label: 'Open'    } },
  profitVsCost: { a: { field: 'profit',  color: 'var(--cf-navy)',  label: 'Profit'  },
                  b: { field: 'cost',    color: 'var(--cf-amber)', label: 'Cost'    } },
  cashInOut:    { a: { field: 'cashIn',  color: 'var(--cf-green)', label: 'Cash in' },
                  // cashInOut maps to the same paid/cost shape as paidVsOpen for M2;
                  // a future iteration adds receipt-date bucketing as true "cash out".
                  b: { field: 'cashOut', color: 'var(--cf-red)',   label: 'Cash out' } },
};

// ─── Modes list (used by component and tests) ─────────────────────────────────

export const MODES = [
  { id: 'paidVsOpen',   label: 'Paid vs Open' },
  { id: 'profitVsCost', label: 'Profit vs Cost' },
  { id: 'cashInOut',    label: 'Cash in vs Out' },
];

// ─── Range buttons list ───────────────────────────────────────────────────────

export const RANGES = [
  { id: '1m',     label: '1M' },
  { id: '3m',     label: '3M' },
  { id: '6m',     label: '6M' },
  { id: '1y',     label: '1Y' },
  { id: 'custom', label: 'Custom', disabled: true, tooltip: 'Coming soon — date picker in a future update' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats a GBP value for the bar label. Truncates to £Xk for values >= 1000
 * when short=true (used on narrow viewports so labels don't overflow bars).
 */
export function formatBarLabel(value, short = false) {
  if (value == null || value === 0) return '';
  if (short && value >= 1000) return `£${(value / 1000).toFixed(1)}k`;
  return `£${value.toLocaleString('en-GB')}`;
}

/**
 * Computes the bar width percentage for a given value relative to maxValue.
 * Returns a number in [0, 95] — capped at 95% to preserve readability.
 * Single-month case: fixed at 60% to avoid the full-width-bar visual artefact.
 *
 * @param {number} value
 * @param {number} maxValue  — max(sum of both bars) across all visible months
 * @param {boolean} isSingleMonth
 * @returns {number}  percentage 0–95
 */
export function computeBarWidthPct(value, maxValue, isSingleMonth = false) {
  if (!value || value <= 0) return 0;
  if (isSingleMonth) return 60;
  if (!maxValue || maxValue <= 0) return 0;
  return Math.min(95, (value / maxValue) * 100);
}

/**
 * Returns the last N months of data matching the selected range.
 * Data is assumed to be sorted ascending. 'custom' falls back to 6m.
 *
 * @param {object[]} data
 * @param {'1m'|'3m'|'6m'|'1y'|'custom'} range
 * @returns {object[]}
 */
export function filterByRange(data, range) {
  if (!data || data.length === 0) return [];
  const counts = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 };
  const n = counts[range] ?? 6;
  return data.slice(-n);
}

/**
 * Returns the maxValue for proportional bar width scaling — the largest total
 * of both bars (a + b) across all months in the slice.
 *
 * @param {object[]} slice
 * @param {'paidVsOpen'|'profitVsCost'|'cashInOut'} mode
 * @returns {number}
 */
export function computeMaxValue(slice, mode) {
  const { a, b } = MODE_BARS[mode] ?? MODE_BARS.paidVsOpen;
  return slice.reduce((max, row) => {
    const total = (row[a.field] ?? 0) + (row[b.field] ?? 0);
    return total > max ? total : max;
  }, 0);
}

/**
 * Returns true when every row in the slice has zero for both bars of the given
 * mode — used by CashflowChart to decide whether to render the "no movement
 * yet" message instead of a row of bare dashes.
 *
 * @param {object[]} slice
 * @param {'paidVsOpen'|'profitVsCost'|'cashInOut'} mode
 * @returns {boolean}
 */
export function isSliceAllZero(slice, mode) {
  if (!slice || slice.length === 0) return false;
  const { a, b } = MODE_BARS[mode] ?? MODE_BARS.paidVsOpen;
  return slice.every(row => (row[a.field] ?? 0) === 0 && (row[b.field] ?? 0) === 0);
}

// ─── Sample data ──────────────────────────────────────────────────────────────
// Matches getCashflowByMonth() return shape (M3 will replace with real data).
// Used for visual smoke-checking on the dev-flag preview and for tests.
//
// Dataset exercises:
//   - Empty months      → Dec 2024, Feb 2025 (tests dash rendering)
//   - Paid-only months  → Jan 2025, May 2025 (open=0)
//   - Open-only month   → Apr 2025 (paid=0)
//   - Balanced split    → Mar 2025, Jun–Nov 2025 (paid>0 and open>0)
//   - Wide value range  → 350 to 5200 paid (>10x spread for proportional test)
//   - Two calendar years → Dec 2024 + 2025 months

export const SAMPLE_DATA = [
  // Dec 2024 — empty month
  { month: '2024-12', monthLabel: 'Dec 2024', paid: 0,    open: 0,    profit: 0,     cost: 0,    cashIn: 0,    cashOut: 0,   total: 0    },
  // Jan 2025 — low activity, paid only
  { month: '2025-01', monthLabel: 'Jan 2025', paid: 420,  open: 0,    profit: 180,   cost: 240,  cashIn: 420,  cashOut: 240, total: 420  },
  // Feb 2025 — empty again
  { month: '2025-02', monthLabel: 'Feb 2025', paid: 0,    open: 0,    profit: 0,     cost: 0,    cashIn: 0,    cashOut: 0,   total: 0    },
  // Mar 2025 — balanced split paid/open
  { month: '2025-03', monthLabel: 'Mar 2025', paid: 1200, open: 1100, profit: 640,   cost: 560,  cashIn: 1200, cashOut: 560, total: 2300 },
  // Apr 2025 — open only
  { month: '2025-04', monthLabel: 'Apr 2025', paid: 0,    open: 850,  profit: 0,     cost: 210,  cashIn: 0,    cashOut: 210, total: 850  },
  // May 2025 — large paid-only month (tests proportional scaling)
  { month: '2025-05', monthLabel: 'May 2025', paid: 4300, open: 0,    profit: 2100,  cost: 2200, cashIn: 4300, cashOut: 2200, total: 4300 },
  // Jun 2025 — moderate
  { month: '2025-06', monthLabel: 'Jun 2025', paid: 1800, open: 600,  profit: 920,   cost: 880,  cashIn: 1800, cashOut: 880, total: 2400 },
  // Jul 2025 — largest month (max proportional bar)
  { month: '2025-07', monthLabel: 'Jul 2025', paid: 5200, open: 1400, profit: 3100,  cost: 2100, cashIn: 5200, cashOut: 2100, total: 6600 },
  // Aug 2025 — moderate
  { month: '2025-08', monthLabel: 'Aug 2025', paid: 2100, open: 400,  profit: 940,   cost: 1160, cashIn: 2100, cashOut: 1160, total: 2500 },
  // Sep 2025 — small month
  { month: '2025-09', monthLabel: 'Sep 2025', paid: 350,  open: 0,    profit: 120,   cost: 230,  cashIn: 350,  cashOut: 230,  total: 350  },
  // Oct 2025 — healthy split
  { month: '2025-10', monthLabel: 'Oct 2025', paid: 3200, open: 900,  profit: 1600,  cost: 1600, cashIn: 3200, cashOut: 1600, total: 4100 },
  // Nov 2025 — good month with significant open
  { month: '2025-11', monthLabel: 'Nov 2025', paid: 2800, open: 1600, profit: 1400,  cost: 1400, cashIn: 2800, cashOut: 1400, total: 4400 },
];
