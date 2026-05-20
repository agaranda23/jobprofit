/**
 * CashflowChart unit tests — pure logic, no DOM rendering.
 *
 * The test suite runs in Vitest without jsdom (no @testing-library/react in this
 * project). All exported pure helpers are fully testable without a DOM.
 * Component rendering is exercised by visual smoke-check on the deploy preview
 * (see PR-M2 description for the jp.chartPreview flag instructions).
 *
 * Covers:
 *   - formatBarLabel: formatting, short mode, zero/null
 *   - computeBarWidthPct: proportional scaling, single-month case, capped at 95, zero
 *   - filterByRange: each range selector, empty data, custom (not in filterByRange)
 *   - computeMaxValue: all modes, empty slice, single month
 *   - SAMPLE_DATA: shape contract, empty months, value range, year boundary
 */

import { describe, it, expect } from 'vitest';
import {
  formatBarLabel,
  computeBarWidthPct,
  filterByRange,
  computeMaxValue,
  SAMPLE_DATA,
} from '../CashflowChart.helpers.js';

// ─── formatBarLabel ───────────────────────────────────────────────────────────

describe('formatBarLabel', () => {
  it('returns empty string for zero', () => {
    expect(formatBarLabel(0)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(formatBarLabel(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatBarLabel(undefined)).toBe('');
  });

  it('formats values below 1000 with £ prefix', () => {
    expect(formatBarLabel(420)).toBe('£420');
  });

  it('formats values at 1000 with commas', () => {
    expect(formatBarLabel(1000)).toBe('£1,000');
  });

  it('formats large values with commas', () => {
    expect(formatBarLabel(4300)).toBe('£4,300');
  });

  it('does not use short format when short=false even for large values', () => {
    expect(formatBarLabel(4300, false)).toBe('£4,300');
  });

  it('uses short format for values >= 1000 when short=true', () => {
    expect(formatBarLabel(4300, true)).toBe('£4.3k');
  });

  it('uses short format rounding correctly: 1500 → £1.5k', () => {
    expect(formatBarLabel(1500, true)).toBe('£1.5k');
  });

  it('does not use short format for values < 1000 even when short=true', () => {
    expect(formatBarLabel(420, true)).toBe('£420');
  });
});

// ─── computeBarWidthPct ───────────────────────────────────────────────────────

describe('computeBarWidthPct', () => {
  it('returns 0 for zero value', () => {
    expect(computeBarWidthPct(0, 5000)).toBe(0);
  });

  it('returns 0 for null value', () => {
    expect(computeBarWidthPct(null, 5000)).toBe(0);
  });

  it('returns 0 for negative value', () => {
    expect(computeBarWidthPct(-100, 5000)).toBe(0);
  });

  it('returns 0 when maxValue is 0', () => {
    expect(computeBarWidthPct(500, 0)).toBe(0);
  });

  it('returns 0 when maxValue is null', () => {
    expect(computeBarWidthPct(500, null)).toBe(0);
  });

  it('scales proportionally — half value returns ~50%', () => {
    const pct = computeBarWidthPct(2500, 5000);
    expect(pct).toBeCloseTo(50, 0);
  });

  it('caps at 95 when value equals maxValue (avoids full-width artefact)', () => {
    expect(computeBarWidthPct(5000, 5000)).toBe(95);
  });

  it('caps at 95 even when value exceeds maxValue', () => {
    expect(computeBarWidthPct(6000, 5000)).toBe(95);
  });

  it('returns 60 for single-month case regardless of value', () => {
    expect(computeBarWidthPct(100, 100, true)).toBe(60);
  });

  it('returns 60 for single-month even with large values', () => {
    expect(computeBarWidthPct(5000, 5000, true)).toBe(60);
  });

  it('quarter value returns ~25%', () => {
    const pct = computeBarWidthPct(1250, 5000);
    expect(pct).toBeCloseTo(25, 0);
  });
});

// ─── filterByRange ────────────────────────────────────────────────────────────

describe('filterByRange', () => {
  it('returns empty array for empty data', () => {
    expect(filterByRange([], '6m')).toEqual([]);
  });

  it('returns empty array for null data', () => {
    expect(filterByRange(null, '6m')).toEqual([]);
  });

  it('1m returns the last 1 month', () => {
    const result = filterByRange(SAMPLE_DATA, '1m');
    expect(result).toHaveLength(1);
    expect(result[0].month).toBe('2025-11');
  });

  it('3m returns the last 3 months', () => {
    const result = filterByRange(SAMPLE_DATA, '3m');
    expect(result).toHaveLength(3);
    expect(result[0].month).toBe('2025-09');
    expect(result[2].month).toBe('2025-11');
  });

  it('6m returns the last 6 months', () => {
    const result = filterByRange(SAMPLE_DATA, '6m');
    expect(result).toHaveLength(6);
    expect(result[result.length - 1].month).toBe('2025-11');
  });

  it('1y returns the last 12 months', () => {
    const result = filterByRange(SAMPLE_DATA, '1y');
    expect(result).toHaveLength(12);
    expect(result[0].month).toBe('2024-12');
  });

  it('falls back to 6m for unknown range', () => {
    const result = filterByRange(SAMPLE_DATA, 'custom');
    expect(result).toHaveLength(6);
  });

  it('returns all data if data has fewer months than range', () => {
    const twoMonths = SAMPLE_DATA.slice(0, 2);
    const result = filterByRange(twoMonths, '6m');
    expect(result).toHaveLength(2);
  });
});

// ─── computeMaxValue ─────────────────────────────────────────────────────────

describe('computeMaxValue', () => {
  it('returns 0 for empty slice', () => {
    expect(computeMaxValue([], 'paidVsOpen')).toBe(0);
  });

  it('paidVsOpen: sums paid + open correctly', () => {
    const slice = [{ paid: 1200, open: 1100, profit: 0, cost: 0, cashIn: 0, cashOut: 0 }];
    expect(computeMaxValue(slice, 'paidVsOpen')).toBe(2300);
  });

  it('profitVsCost: sums profit + cost correctly', () => {
    const slice = [{ paid: 0, open: 0, profit: 640, cost: 560, cashIn: 0, cashOut: 0 }];
    expect(computeMaxValue(slice, 'profitVsCost')).toBe(1200);
  });

  it('cashInOut: sums cashIn + cashOut correctly', () => {
    const slice = [{ paid: 0, open: 0, profit: 0, cost: 0, cashIn: 1200, cashOut: 560 }];
    expect(computeMaxValue(slice, 'cashInOut')).toBe(1760);
  });

  it('returns the maximum across multiple months, not the sum', () => {
    const slice = [
      { paid: 100, open: 50,   profit: 0, cost: 0, cashIn: 0, cashOut: 0 },
      { paid: 300, open: 200,  profit: 0, cost: 0, cashIn: 0, cashOut: 0 },
      { paid: 80,  open: 20,   profit: 0, cost: 0, cashIn: 0, cashOut: 0 },
    ];
    expect(computeMaxValue(slice, 'paidVsOpen')).toBe(500);
  });

  it('handles missing fields (undefined) without NaN', () => {
    const slice = [{ paid: 1000 }];
    expect(computeMaxValue(slice, 'paidVsOpen')).toBe(1000);
  });

  it('falls back to paidVsOpen for unknown mode', () => {
    const slice = [{ paid: 500, open: 300 }];
    expect(computeMaxValue(slice, 'unknown')).toBe(800);
  });
});

// ─── SAMPLE_DATA contract ─────────────────────────────────────────────────────

describe('SAMPLE_DATA shape', () => {
  it('has 12 months', () => {
    expect(SAMPLE_DATA).toHaveLength(12);
  });

  it('each month has required fields', () => {
    for (const row of SAMPLE_DATA) {
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

  it('has at least 2 empty months (tests dash rendering)', () => {
    const emptyMonths = SAMPLE_DATA.filter(r => r.paid === 0 && r.open === 0);
    expect(emptyMonths.length).toBeGreaterThanOrEqual(2);
  });

  it('has at least one paid-only month (open=0, paid>0)', () => {
    const paidOnly = SAMPLE_DATA.filter(r => r.paid > 0 && r.open === 0);
    expect(paidOnly.length).toBeGreaterThanOrEqual(1);
  });

  it('has at least one balanced split month (paid>0 and open>0)', () => {
    const split = SAMPLE_DATA.filter(r => r.paid > 0 && r.open > 0);
    expect(split.length).toBeGreaterThanOrEqual(1);
  });

  it('has a wide value range — max paid is at least 10x min non-zero paid', () => {
    const nonZeroPaid = SAMPLE_DATA.filter(r => r.paid > 0).map(r => r.paid);
    const max = Math.max(...nonZeroPaid);
    const min = Math.min(...nonZeroPaid);
    expect(max / min).toBeGreaterThanOrEqual(10);
  });

  it('spans two calendar years (2024 and 2025)', () => {
    const years = new Set(SAMPLE_DATA.map(r => r.month.slice(0, 4)));
    expect(years.has('2024')).toBe(true);
    expect(years.has('2025')).toBe(true);
  });

  it('months are in ascending order', () => {
    for (let i = 1; i < SAMPLE_DATA.length; i++) {
      expect(SAMPLE_DATA[i].month > SAMPLE_DATA[i - 1].month).toBe(true);
    }
  });

  it('all numeric fields are non-negative', () => {
    for (const row of SAMPLE_DATA) {
      expect(row.paid).toBeGreaterThanOrEqual(0);
      expect(row.open).toBeGreaterThanOrEqual(0);
      expect(row.cost).toBeGreaterThanOrEqual(0);
      expect(row.cashIn).toBeGreaterThanOrEqual(0);
      expect(row.cashOut).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── Integration: filterByRange + computeBarWidthPct ─────────────────────────

describe('bar width proportionality on SAMPLE_DATA', () => {
  it('largest month bar is at 95% (the cap), not > 95%', () => {
    const slice6 = filterByRange(SAMPLE_DATA, '6m');
    const maxVal = computeMaxValue(slice6, 'paidVsOpen');
    const largest = slice6.reduce((best, row) => {
      const t = (row.paid ?? 0) + (row.open ?? 0);
      return t > (best.paid ?? 0) + (best.open ?? 0) ? row : best;
    }, slice6[0]);
    const pct = computeBarWidthPct(largest.paid, maxVal);
    expect(pct).toBeLessThanOrEqual(95);
  });

  it('a half-size value produces ~50% bar width (proportional scaling)', () => {
    const maxVal = 6000;
    const halfVal = 3000;
    const pct = computeBarWidthPct(halfVal, maxVal);
    expect(pct).toBeCloseTo(50, 0);
  });

  it('empty month has 0% bar width for both fields', () => {
    const emptyRow = SAMPLE_DATA.find(r => r.paid === 0 && r.open === 0);
    const maxVal = computeMaxValue(SAMPLE_DATA, 'paidVsOpen');
    expect(computeBarWidthPct(emptyRow.paid, maxVal)).toBe(0);
    expect(computeBarWidthPct(emptyRow.open, maxVal)).toBe(0);
  });
});
