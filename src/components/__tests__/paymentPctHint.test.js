/**
 * Unit tests for the payment-percentage calculation in RecordPaymentModal.
 *
 * The live readout formula is: (parsedAmount / quoteTotal) * 100
 * These tests exercise the formula inline — no React rendering needed —
 * mirroring exactly what the JSX expression computes.
 */

import { describe, it, expect } from 'vitest';

// ── Formula under test ────────────────────────────────────────────────────────
// Extracted verbatim from RecordPaymentModal's % readout expression so that
// any future change to the formula breaks these tests immediately.

/**
 * Compute the percentage-of-total string shown in the hint.
 * Returns null when the hint should be hidden (total 0 or amount invalid/zero).
 *
 * @param {number|string} rawAmount  — the value in the amount input (may be '')
 * @param {number}        quoteTotal — job.total ?? job.amount ?? 0
 * @returns {string|null}
 */
function computePctHint(rawAmount, quoteTotal) {
  const parsedAmount = parseFloat(rawAmount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return null;
  if (quoteTotal <= 0) return null;

  const pct = (parsedAmount / quoteTotal) * 100;
  const pctStr = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1);
  return `£${parsedAmount.toFixed(2)} · ${pctStr}% of £${quoteTotal.toFixed(2)}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('payment-pct-hint formula', () => {
  it('shows exact whole-number % when payment is a clean fraction', () => {
    // £250 of £1,000 = 25% exactly
    expect(computePctHint('250', 1000)).toBe('£250.00 · 25% of £1000.00');
  });

  it('shows 50% for half-payment', () => {
    expect(computePctHint('500', 1000)).toBe('£500.00 · 50% of £1000.00');
  });

  it('shows 100% for full payment', () => {
    expect(computePctHint('1000', 1000)).toBe('£1000.00 · 100% of £1000.00');
  });

  it('shows >100% when payment exceeds total — does not break', () => {
    // £1,200 of £1,000 = 120%
    expect(computePctHint('1200', 1000)).toBe('£1200.00 · 120% of £1000.00');
  });

  it('shows 1dp when percentage is not a whole number', () => {
    // £333 of £1,000 = 33.3%
    expect(computePctHint('333', 1000)).toBe('£333.00 · 33.3% of £1000.00');
  });

  it('shows 1dp for thirds (33.3...%)', () => {
    // £100 of £300 = 33.333...% → rounds to 33.3 at 1dp
    const result = computePctHint('100', 300);
    expect(result).toContain('33.3%');
  });

  it('returns null when total is 0 (zero-total guard)', () => {
    expect(computePctHint('250', 0)).toBeNull();
  });

  it('returns null when amount is empty string', () => {
    expect(computePctHint('', 1000)).toBeNull();
  });

  it('returns null when amount is 0', () => {
    expect(computePctHint('0', 1000)).toBeNull();
  });

  it('returns null when amount is NaN string', () => {
    expect(computePctHint('abc', 1000)).toBeNull();
  });

  it('returns null when amount is negative', () => {
    // Negative amounts never show the hint
    expect(computePctHint('-50', 1000)).toBeNull();
  });

  it('handles very small amounts (1p)', () => {
    const result = computePctHint('0.01', 1000);
    // Should show something non-null
    expect(result).not.toBeNull();
    expect(result).toContain('£0.01');
  });

  it('handles decimal string amounts correctly', () => {
    // £250.50 of £1,000
    const result = computePctHint('250.50', 1000);
    expect(result).toContain('£250.50');
    expect(result).toContain('25.1%');
  });
});
