/**
 * profitThresholds.js — Single source of truth for margin colour state.
 *
 * Used by ProfitRibbon and ProfitBreakdownSheet so the colour decision
 * is never duplicated.
 *
 * Thresholds (PRD Design A spec, 2026-05-30 — not user-configurable in Step 2):
 *   ≥ 25%  → 'healthy'   (navy ribbon, profit in green)
 *   5–24%  → 'thin'      (amber ribbon, profit in cream)
 *   < 5%   → 'underwater' (rose ribbon, profit in soft rose)
 *
 * Negative margins map to 'underwater' — the job is losing money.
 * Zero margin maps to 'underwater' (< 5%).
 */

/**
 * Returns the margin colour state for a given margin percentage.
 *
 * @param {number} margin  – margin as a percentage (e.g. 42 for 42%). May be negative.
 * @returns {'healthy' | 'thin' | 'underwater'}
 */
export function marginState(margin) {
  if (margin >= 25) return 'healthy';
  if (margin >= 5) return 'thin';
  return 'underwater';
}
