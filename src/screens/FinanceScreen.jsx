/**
 * FinanceScreen — Money tab (slice-3 nav).
 *
 * Phase 1 — Profit insight redesign.
 * JTBD: "Am I making money, and have I kept enough for tax?"
 *
 * Top-to-bottom card order:
 *   1. Hero — Profit (this month), big figure, negative state, empty state
 *   2. Cashflow chart — existing CashflowChart (all three modes available via its own selector)
 *   3. Month pace two-up — Paid in (left) + Jobs done (right)
 *   4. Est. Profit/Hour insight card
 *   5. Margin nudge (conditional — only when |delta| >= 10%)
 *   6. Recent transactions — collapsed expandable timeline
 *
 * Removed in Phase 1:
 *   - Outstanding hero + chase block (HeroChaseCTA, ChaseRow components)
 *   - All chaseLadder imports
 *   - getOutstandingSummary usage
 *   - onMarkPaid prop
 *
 * Tax Set-Aside card: DEFERRED (later phase).
 * Today leak card: DEFERRED (later phase).
 * Pro gating: NOT in this PR.
 */

import { useMemo, useState } from 'react';
import { gbp } from '../lib/today';
import HeaderAvatar from '../components/HeaderAvatar';
import CashflowChart from '../components/CashflowChart';
import {
  getCashflowByMonth,
  getMonthSummary,
  getProfitPerHour,
  getMarginTrend,
  buildDateRange,
  monthKey,
} from '../lib/cashflow';

// Margin nudge fires only when the absolute delta meets or exceeds this threshold.
// One nudge max — priority: margin drop (or gain) first.
const MARGIN_NUDGE_THRESHOLD_PCT = 10;

export default function FinanceScreen({ jobs = [], receipts = [], session, profile, onAvatarClick }) {
  const [timelineOpen, setTimelineOpen] = useState(false);
  // chartRange drives which window of data getCashflowByMonth uses.
  // '6m' is the default matching the chart's defaultRange prop.
  const [chartRange, setChartRange] = useState('6m');

  const now = new Date();
  const currentMonth = monthKey(now);
  // Destructure the primitive so the React Compiler can track the exact dep.
  const hourlyRate = Number(profile?.hourly_rate) || 0;

  // ── Derived data ────────────────────────────────────────────────────────────
  const {
    cashflowData,
    monthSummary,
    profitPerHour,
    marginTrend,
    timelineGroups,
    hasActivity,
  } = useMemo(() => {
    // ── Cashflow chart data ────────────────────────────────────────────────
    const rangeMap = { '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y' };
    const rangeKey = rangeMap[chartRange] || '6M';
    const { from, to } = buildDateRange(rangeKey, now);
    const cashflowData = getCashflowByMonth(jobs, receipts, from, to);

    // ── Month summary (hero + two-up stat cards) ───────────────────────────
    const monthSummary = getMonthSummary(jobs, receipts, { month: currentMonth });

    // ── Est. Profit/Hour ───────────────────────────────────────────────────
    const profitPerHour = getProfitPerHour(jobs, { hourlyRate, weeks: 1 }, now);

    // ── Margin trend (single nudge) ────────────────────────────────────────
    const marginTrend = getMarginTrend(jobs, receipts, { weeks: 1 }, now);

    // ── Timeline (collapsed at bottom) ────────────────────────────────────
    const allEntries = [
      ...jobs.map(j => ({
        id: 'j' + j.id,
        label: j.name || j.customer || 'Job',
        amount: Number(j.amount || 0),
        ts: j.createdAt || j.date,
      })),
      ...receipts.map(r => ({
        id: 'r' + r.id,
        label: r.label || 'Receipt',
        amount: -Number(r.amount || 0),
        ts: r.createdAt || r.date,
      })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts));

    const groups = {};
    const _now = new Date();
    for (const e of allEntries) {
      const d = new Date(e.ts);
      const key = keyOfDay(d);
      if (!groups[key]) groups[key] = { label: labelOfDay(d, _now), entries: [] };
      groups[key].entries.push(e);
    }
    const timelineGroups = Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([k, v]) => ({ key: k, ...v }));

    const hasActivity = timelineGroups.length > 0;

    return {
      cashflowData,
      monthSummary,
      profitPerHour,
      marginTrend,
      timelineGroups,
      hasActivity,
    };
  }, [jobs, receipts, chartRange, currentMonth, hourlyRate]);

  // ── Margin nudge: surface only when |delta| >= threshold ────────────────────
  const showMarginNudge = Math.abs(marginTrend.deltaPct) >= MARGIN_NUDGE_THRESHOLD_PCT;
  const marginNudgeCopy = showMarginNudge
    ? marginTrend.deltaSign === 'up'
      ? `Your margin improved ${Math.round(marginTrend.deltaPct)}% vs last week`
      : `Your margin dropped ${Math.round(Math.abs(marginTrend.deltaPct))}% vs last week — see why`
    : null;

  const totalTimelineEntries = timelineGroups.reduce((s, g) => s + g.entries.length, 0);

  // ── Hero profit copy ─────────────────────────────────────────────────────────
  const isEmptyMonth = monthSummary.paid === 0 && monthSummary.jobCount === 0;
  const isProfitNegative = monthSummary.profit < 0;

  return (
    <div className="screen finance-screen">
      <div className="screen-header">
        <h1 className="screen-title">Money</h1>
        {onAvatarClick && (
          <div className="screen-header-right">
            <HeaderAvatar session={session} profile={profile} onClick={onAvatarClick} />
          </div>
        )}
      </div>

      {/* ── 1. Hero — Profit this month ──────────────────────────────────── */}
      {isEmptyMonth ? (
        <div className="money-hero money-hero--clear">
          <div className="money-hero__label">Profit this month</div>
          <span className="money-hero__caught-up">Nothing paid in yet this month</span>
          <p className="money-hero__hint">
            Mark a job as paid in Jobs and it'll show up here.
          </p>
        </div>
      ) : (
        <div className={`money-hero money-hero--profit${isProfitNegative ? ' money-hero--negative' : ''}`}>
          <div className="money-hero__label">Profit this month</div>
          <div className={`money-hero__figure${isProfitNegative ? ' money-twoUp__value--negative' : ''}`}>
            {gbp(monthSummary.profit)}
          </div>
          <div className="money-hero__meta">
            {isProfitNegative
              ? 'You spent more than came in this month'
              : 'Money in, minus what you spent'}
          </div>
        </div>
      )}

      {/* ── 2. Cashflow chart ─────────────────────────────────────────────── */}
      <div className="money-card money-card--chart">
        <CashflowChart
          data={cashflowData}
          defaultRange="6m"
          defaultMode="paidVsOpen"
          onRangeChange={(newRange) => setChartRange(newRange)}
        />
      </div>

      {/* ── 3. Month pace two-up — Paid in + Jobs done ───────────────────── */}
      <div className="money-twoUp">
        <div className="money-twoUp__card">
          <div className="money-twoUp__label">Paid in</div>
          <div className="money-twoUp__value">{gbp(monthSummary.paid)}</div>
        </div>
        <div className="money-twoUp__card">
          <div className="money-twoUp__label">Jobs done</div>
          <div className="money-twoUp__value">{monthSummary.jobCount}</div>
        </div>
      </div>

      {/* ── 4. Est. Profit/Hour ───────────────────────────────────────────── */}
      {profitPerHour.value !== null ? (
        <div className="money-card money-insight money-insight--pph">
          <div className="money-insight__row">
            <span className="money-insight__label">Est. Profit/Hour</span>
            <span className="money-insight__tooltip" title="Based on your default hourly rate. Add hours to a job to make this exact.">
              &#x24D8;
            </span>
          </div>
          <div className="money-insight__value">
            {gbp(Math.round(profitPerHour.value))}
            {profitPerHour.comparisonValue !== null && (
              <span className={`money-insight__delta money-insight__delta--${profitPerHour.deltaSign}`}>
                {profitPerHour.deltaSign === 'up' ? ' ▲' : profitPerHour.deltaSign === 'down' ? ' ▼' : ' –'}
                {' '}{gbp(Math.round(Math.abs(profitPerHour.value - profitPerHour.comparisonValue)))} vs last wk
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="money-card money-insight money-insight--pph money-insight--empty">
          <div className="money-insight__row">
            <span className="money-insight__label">Est. Profit/Hour</span>
            <span className="money-insight__tooltip" title="Based on your default hourly rate. Add hours to a job to make this exact.">
              &#x24D8;
            </span>
          </div>
          <p className="money-insight__hint">
            Set your hourly rate in Settings to unlock this insight.
          </p>
        </div>
      )}

      {/* ── 5. Margin nudge (conditional — single, threshold-gated) ─────── */}
      {showMarginNudge && (
        <div className={`money-card money-nudge money-nudge--${marginTrend.deltaSign}`}>
          <span className="money-nudge__icon">{marginTrend.deltaSign === 'up' ? '📈' : '📉'}</span>
          <span className="money-nudge__copy">{marginNudgeCopy}</span>
          {marginTrend.deltaSign !== 'up' && (
            <span className="money-nudge__caret"> →</span>
          )}
        </div>
      )}

      {/* ── Tax Set-Aside card — DEFERRED (later phase) ──────────────────── */}
      {/* ── Today leak card — DEFERRED (later phase) ─────────────────────── */}

      {/* ── 6. Recent transactions (demoted — collapsed by default) ──────── */}
      {totalTimelineEntries > 0 && (
        <div className="money-card money-timeline">
          <button
            type="button"
            className="money-timeline__header"
            aria-expanded={timelineOpen}
            onClick={() => setTimelineOpen(o => !o)}
          >
            <span className="money-timeline__title">
              Recent transactions &middot; {totalTimelineEntries} {totalTimelineEntries === 1 ? 'entry' : 'entries'}
            </span>
            <span className={`money-timeline__chevron${timelineOpen ? ' money-timeline__chevron--open' : ''}`} aria-hidden="true">
              &#x25BE;
            </span>
          </button>

          {timelineOpen && (
            <div className="money-timeline__body">
              {timelineGroups.map(g => (
                <div key={g.key} className="money-timeline__group">
                  <h3 className="money-timeline__day">{g.label}</h3>
                  <ul className="money-timeline__list">
                    {g.entries.map(e => (
                      <li key={e.id} className="money-timeline__item">
                        <span className="money-timeline__item-label">{e.label}</span>
                        <span className={`money-timeline__item-amount${e.amount >= 0 ? ' pos' : ' neg'}`}>
                          {e.amount >= 0 ? '+' : ''}{gbp(Math.abs(e.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Full empty state ─────────────────────────────────────────────── */}
      {!hasActivity && (
        <div className="screen-empty">
          <p className="screen-empty-title">Log your first job to start tracking.</p>
          <p className="screen-empty-hint">
            Finish a job and send the invoice — your money picture will appear here.
          </p>
        </div>
      )}

    </div>
  );
}

// ── Date helpers for timeline grouping (local-only, not exported) ────────────
function keyOfDay(date) {
  return date.toISOString().slice(0, 10);
}

function labelOfDay(date, now) {
  const key = keyOfDay(date);
  const todayKey = keyOfDay(now);
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (key === todayKey) return 'Today';
  if (key === keyOfDay(yest)) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}
