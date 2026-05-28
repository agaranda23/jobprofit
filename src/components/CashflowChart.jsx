/**
 * CashflowChart — CSS/SVG horizontal bar chart for the Money tab (M2 of 3).
 *
 * Pure presentation component. No data fetching, no AppShell coupling.
 * M3 will wire real data from src/lib/cashflow.js getCashflowByMonth().
 *
 * Dev-flag preview: localStorage.setItem('jp.chartPreview', '1'); location.reload();
 * This flag is read in AppShell.jsx only when NAV_SLICE_3 is active.
 * SAMPLE_DATA and pure helpers live in CashflowChart.helpers.js.
 */

import { useState } from 'react';
import './CashflowChart.css';
import {
  MODES,
  RANGES,
  MODE_BARS,
  formatBarLabel,
  computeBarWidthPct,
  filterByRange,
  computeMaxValue,
  isSliceAllZero,
} from './CashflowChart.helpers.js';

/**
 * CashflowChart
 *
 * Props:
 *   data           {object[]}  — getCashflowByMonth() output (see SAMPLE_DATA for shape)
 *   defaultRange   {string}    — '1m'|'3m'|'6m'|'1y' (default '6m')
 *   defaultMode    {string}    — 'paidVsOpen'|'profitVsCost'|'cashInOut' (default 'paidVsOpen')
 *   onRangeChange  {function}  — optional; called with new range id on change (analytics hook)
 *   onModeChange   {function}  — optional; called with new mode id on change
 */
export default function CashflowChart({
  data = [],
  defaultRange = '6m',
  defaultMode = 'paidVsOpen',
  onRangeChange,
  onModeChange,
}) {
  const [range, setRange]               = useState(defaultRange);
  const [mode, setMode]                 = useState(defaultMode);
  const [expandedMonth, setExpandedMonth] = useState(null);

  function handleRangeChange(newRange) {
    setRange(newRange);
    setExpandedMonth(null);
    onRangeChange?.(newRange);
  }

  function handleModeChange(e) {
    const newMode = e.target.value;
    setMode(newMode);
    setExpandedMonth(null);
    onModeChange?.(newMode);
  }

  function toggleMonth(monthKey) {
    setExpandedMonth(prev => (prev === monthKey ? null : monthKey));
  }

  const slice          = filterByRange(data, range);
  const isSingleMonth  = slice.length === 1;
  const maxValue       = computeMaxValue(slice, mode);
  const { a: barA, b: barB } = MODE_BARS[mode] ?? MODE_BARS.paidVsOpen;

  // Use short (£Xk) labels on all rows consistently so the chart doesn't mix
  // formats. Triggered when any visible value exceeds £9,999.
  const useShortLabels = slice.some(row =>
    (row[barA.field] ?? 0) > 9999 || (row[barB.field] ?? 0) > 9999
  );

  // All-zero slice: data exists but every row in the current range has nothing
  // to show for the active mode. Render a friendly message instead of dashes.
  const isSliceEmpty = data.length > 0 && isSliceAllZero(slice, mode);

  return (
    <div className="cashflow-chart">

      {/* ── Mode selector ──────────────────────────────────────────── */}
      <div className="cashflow-chart__controls">
        <label htmlFor="cashflow-mode-select" className="cashflow-chart__mode-label">
          <select
            id="cashflow-mode-select"
            className="cashflow-chart__mode-select"
            value={mode}
            onChange={handleModeChange}
            aria-label="Chart mode"
          >
            {MODES.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>

        {/* ── Range buttons ────────────────────────────────────────── */}
        <div className="cashflow-chart__range-group" role="group" aria-label="Date range">
          {RANGES.map(r => (
            <button
              key={r.id}
              type="button"
              className={`cashflow-chart__range-btn${range === r.id ? ' cashflow-chart__range-btn--active' : ''}${r.disabled ? ' cashflow-chart__range-btn--disabled' : ''}`}
              aria-pressed={range === r.id}
              disabled={r.disabled}
              title={r.tooltip ?? undefined}
              onClick={r.disabled ? undefined : () => handleRangeChange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Bars / empty states ─────────────────────────────────────── */}
      {data.length === 0 ? (
        <div className="cashflow-chart__empty" role="status">
          <p className="cashflow-chart__empty-msg">
            Log your first job to start tracking your cash flow.
          </p>
        </div>
      ) : isSliceEmpty ? (
        <div className="cashflow-chart__empty" role="status">
          <p className="cashflow-chart__empty-msg">
            No money movement in this range yet — log and complete a job to see it here.
          </p>
        </div>
      ) : (
        <div
          className="cashflow-chart__bars"
          role="list"
          aria-label="Cash flow by month"
        >
          {slice.map(row => {
            const valA    = row[barA.field] ?? 0;
            const valB    = row[barB.field] ?? 0;
            const total   = valA + valB;
            const isEmpty = total === 0;
            const pctA    = computeBarWidthPct(valA, maxValue, isSingleMonth);
            const pctB    = computeBarWidthPct(valB, maxValue, isSingleMonth);
            const label   = formatBarLabel(total, useShortLabels);
            const isExpanded = expandedMonth === row.month;

            return (
              <div
                key={row.month}
                className="cashflow-chart__row-wrapper"
                role="listitem"
              >
                {isEmpty ? (
                  /* Non-interactive row for empty months */
                  <div
                    className="cashflow-chart__row"
                    aria-label={`${row.monthLabel}: no activity`}
                  >
                    <span className="cashflow-chart__month-label">{row.monthLabel}</span>
                    <span className="cashflow-chart__empty-dash" aria-hidden="true">─</span>
                    <span />
                  </div>
                ) : (
                  /* Tappable row for months with data */
                  <button
                    type="button"
                    className="cashflow-chart__row cashflow-chart__row--tappable"
                    onClick={() => toggleMonth(row.month)}
                    aria-expanded={isExpanded}
                    aria-label={`${row.monthLabel}: ${barA.label} ${formatBarLabel(valA)}, ${barB.label} ${formatBarLabel(valB)}. Tap to ${isExpanded ? 'hide' : 'show'} breakdown.`}
                  >
                    <span className="cashflow-chart__month-label">{row.monthLabel}</span>

                    <div className="cashflow-chart__bar-track">
                      {valA > 0 && (
                        <div
                          className="cashflow-chart__bar cashflow-chart__bar--a"
                          style={{ width: `${pctA}%`, backgroundColor: barA.color }}
                          role="presentation"
                        />
                      )}
                      {valB > 0 && (
                        <div
                          className="cashflow-chart__bar cashflow-chart__bar--b"
                          style={{ width: `${pctB}%`, backgroundColor: barB.color }}
                          role="presentation"
                        />
                      )}
                    </div>

                    <span className="cashflow-chart__total-label">{label}</span>
                  </button>
                )}

                {/* ── Month detail panel ─────────────────────────────── */}
                {isExpanded && (
                  <div className="cashflow-chart__detail" aria-live="polite">
                    <DetailItem label="Paid"   value={row.paid}   />
                    <DetailItem label="Open"   value={row.open}   />
                    <DetailItem label="Profit" value={row.profit} isProfit />
                    <DetailItem label="Cost"   value={row.cost}   />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * DetailItem — one line in the tap-to-reveal breakdown panel.
 * Keeps negative profit visually distinct (muted red treatment).
 */
function DetailItem({ label, value, isProfit = false }) {
  const amount = value ?? 0;
  const isNegative = isProfit && amount < 0;
  return (
    <span className={`cashflow-chart__detail-item${isNegative ? ' cashflow-chart__detail-item--negative' : ''}`}>
      <span className="cashflow-chart__detail-label">{label}</span>
      {' '}
      <span className="cashflow-chart__detail-value">
        {isNegative ? '-' : ''}{formatBarLabel(Math.abs(amount))}
      </span>
    </span>
  );
}
