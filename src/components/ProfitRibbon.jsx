import { marginState } from '../lib/profitThresholds';

/**
 * ProfitRibbon — compact three-segment profit bar.
 *
 * Design A Step 2 (PRD 2026-05-30):
 *   Segments: Quoted · Costs · Profit (with margin %)
 *   Colour state driven by marginState() from profitThresholds.js:
 *     healthy    – navy background, profit in green
 *     thin       – amber background, profit in cream
 *     underwater – rose background, profit in soft rose
 *
 *   Layout at 375px:
 *     - Three segments fit when amounts ≤ 5 digits
 *     - ≥ £100,000: k-notation (£100k)
 *     - If width still overflows: labels shrink to single letters (Q, C, P)
 *     - Numbers are never truncated
 *
 *   Tap → calls onTap (opens ProfitBreakdownSheet)
 *   Pure presentational — no local state.
 *
 * Props:
 *   quote   – number  – total quoted value (e.g. 1450)
 *   costs   – number  – total receipt/material costs (e.g. 832)
 *   profit  – number  – quote minus costs (may be negative)
 *   margin  – number  – profit / quote * 100 (integer %)
 *   onTap   – function – called when the ribbon is tapped
 */

function fmtAmount(n) {
  if (Math.abs(n) >= 100000) {
    return `£${Math.round(n / 1000)}k`;
  }
  // Integer pounds only — the ribbon is not an invoice
  return `£${Math.round(Math.abs(n)).toLocaleString('en-GB')}${n < 0 ? ' loss' : ''}`;
}

export default function ProfitRibbon({ quote, costs, profit, margin, onTap }) {
  const state = marginState(margin);

  const ribbonClass = `jd-profit-ribbon jd-profit-ribbon--${state}`;

  return (
    <button
      type="button"
      className={ribbonClass}
      onClick={onTap}
      aria-label={`Profit: ${fmtAmount(profit)}, ${margin}% margin. Tap to view breakdown.`}
    >
      <span className="jd-profit-ribbon-seg">
        <span className="jd-profit-ribbon-label">Quoted</span>
        <span className="jd-profit-ribbon-label--short">Q</span>
        <strong className="jd-profit-ribbon-value">{fmtAmount(quote)}</strong>
      </span>

      <span className="jd-profit-ribbon-divider" aria-hidden="true">·</span>

      <span className="jd-profit-ribbon-seg">
        <span className="jd-profit-ribbon-label">Costs</span>
        <span className="jd-profit-ribbon-label--short">C</span>
        <strong className="jd-profit-ribbon-value">{fmtAmount(costs)}</strong>
      </span>

      <span className="jd-profit-ribbon-divider" aria-hidden="true">·</span>

      <span className="jd-profit-ribbon-seg jd-profit-ribbon-seg--profit">
        <span className="jd-profit-ribbon-label">Profit</span>
        <span className="jd-profit-ribbon-label--short">P</span>
        <strong className="jd-profit-ribbon-value jd-profit-ribbon-value--profit">
          {fmtAmount(profit)} · {margin}%
        </strong>
      </span>

      <span className="jd-profit-ribbon-chev" aria-hidden="true">›</span>
    </button>
  );
}
