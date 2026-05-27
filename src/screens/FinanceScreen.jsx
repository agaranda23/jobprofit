/**
 * FinanceScreen — Money tab (slice-3 nav).
 *
 * M3 of 3 — final piece of the Money-tab redesign.
 * Wires PR-M1's cashflow data layer (src/lib/cashflow.js) and
 * PR-M2's CashflowChart component into the new hierarchy.
 *
 * Top-to-bottom card order:
 *   1. Hero — outstanding total + oldest age/customer + Chase via WhatsApp CTA
 *   2. Cashflow chart — paid-vs-open default, 6M default
 *   3. Month Profit + Month Paid two-up
 *   4. Est. Profit/Hour insight card
 *   5. Margin nudge (conditional — only when |delta| >= 10%)
 *   6. Recent transactions — collapsed expandable (timeline demoted, not deleted)
 *
 * Tax position card: DEFERRED. No quarterly aggregation exists in cashflow.js.
 * Follow-up PR required once quarterly grouping + tax-rate input are designed.
 *
 * Decommissioned in this PR:
 *   - Week totals strip
 *   - Insights teaser placeholder ("coming soon")
 *   - getStartOfWeek helper (unused)
 *   - weekEarned / weekSpent derived state (replaced by getMonthSummary)
 *   - Active-jobs widget (never existed in this file per audit)
 *   - "Good Afternoon" / "No jobs tomorrow" greeting (never in this file per audit)
 *   - 6-metric grid (replaced by two targeted cards)
 *   - M2 dev-flag chart preview in AppShell (see AppShell.jsx change)
 */

import { useMemo, useState } from 'react';
import { gbp } from '../lib/today';
import HeaderAvatar from '../components/HeaderAvatar';
import CashflowChart from '../components/CashflowChart';
import {
  getChaseState,
  recordChase,
  clearChase,
  computeTier,
  buildChaseLink,
  lastChasedLabel,
} from '../lib/chaseLadder.js';
import {
  getCashflowByMonth,
  getMonthSummary,
  getOutstandingSummary,
  getProfitPerHour,
  getMarginTrend,
  buildDateRange,
  monthKey,
} from '../lib/cashflow';

// Margin nudge fires only when the absolute delta meets or exceeds this threshold.
// One nudge max — priority: margin drop (or gain) first.
// Threshold lives here in M3, per the locked-in design decision.
const MARGIN_NUDGE_THRESHOLD_PCT = 10;

export default function FinanceScreen({ jobs = [], receipts = [], session, profile, onAvatarClick, onMarkPaid }) {
  const [timelineOpen, setTimelineOpen] = useState(false);
  // chartRange drives which window of data getCashflowByMonth uses.
  // '6m' is the default matching the chart's defaultRange prop.
  const [chartRange, setChartRange] = useState('6m');

  const now = new Date();
  const currentMonth = monthKey(now);
  // Destructure the primitive so the React Compiler can track the exact dep.
  const hourlyRate = Number(profile?.hourly_rate) || 0;

  // ── Derived data ────────────────────────────────────────────────────────────
  // All data derivations are in a single useMemo so jobs/receipts only trigger
  // one recompute. Separate them into named fields for clarity below.

  const {
    unpaid,
    outstanding,
    cashflowData,
    monthSummary,
    profitPerHour,
    marginTrend,
    timelineGroups,
    hasActivity,
  } = useMemo(() => {
    // ── Outstanding / Hero data ────────────────────────────────────────────
    const allEntries = [
      ...jobs.map(j => ({
        id: 'j' + j.id,
        rawId: j.id,
        kind: 'job',
        label: j.name || j.customer || 'Job',
        customer: j.customer || j.customerName || '',
        phone: j.phone || j.customerPhone || '',
        amount: Number(j.amount || 0),
        paid: j.paid !== false,
        ts: j.createdAt || j.date,
      })),
      ...receipts.map(r => ({
        id: 'r' + r.id,
        rawId: r.id,
        kind: 'receipt',
        label: r.label || 'Receipt',
        customer: '',
        phone: '',
        amount: -Number(r.amount || 0),
        paid: true,
        ts: r.createdAt || r.date,
      })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts));

    const unpaid = allEntries.filter(e => e.kind === 'job' && !e.paid);

    // ── Outstanding summary (Hero card) ───────────────────────────────────
    const outstanding = getOutstandingSummary(jobs);

    // ── Cashflow chart data ────────────────────────────────────────────────
    // Build data for the full 1Y window; filterByRange inside CashflowChart
    // slices to the selected range. We recompute when chartRange changes so
    // the data window always covers the selected range.
    const rangeMap = { '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y' };
    const rangeKey = rangeMap[chartRange] || '6M';
    const { from, to } = buildDateRange(rangeKey, now);
    const cashflowData = getCashflowByMonth(jobs, receipts, from, to);

    // ── Month summary (two-up stat cards) ─────────────────────────────────
    const monthSummary = getMonthSummary(jobs, receipts, { month: currentMonth });

    // ── Est. Profit/Hour ───────────────────────────────────────────────────
    const profitPerHour = getProfitPerHour(jobs, { hourlyRate, weeks: 1 }, now);

    // ── Margin trend (single nudge) ────────────────────────────────────────
    const marginTrend = getMarginTrend(jobs, receipts, { weeks: 1 }, now);

    // ── Timeline (demoted — collapsed at bottom) ───────────────────────────
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

    const hasActivity = timelineGroups.length > 0 || unpaid.length > 0;

    return {
      unpaid,
      outstanding,
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

  // ── Hero chase CTA: wire oldest job to chaseLadder ──────────────────────────
  // Finds the entry matching the oldest unpaid job ID so we can build a chase link.
  const oldestEntry = outstanding.oldestJobId
    ? unpaid.find(e => e.rawId === outstanding.oldestJobId || String(e.rawId) === String(outstanding.oldestJobId))
    : null;

  const totalTimelineEntries = timelineGroups.reduce((s, g) => s + g.entries.length, 0);

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

      {/* ── 1. Hero card ─────────────────────────────────────────────────── */}
      {outstanding.invoiceCount === 0 ? (
        <div className="money-hero money-hero--clear">
          <span className="money-hero__caught-up">All caught up — nothing owed</span>
        </div>
      ) : (
        <div className="money-hero money-hero--owed">
          <div className="money-hero__label">Outstanding</div>
          <div className="money-hero__figure">{gbp(outstanding.totalOwed)}</div>
          <div className="money-hero__meta">
            {outstanding.invoiceCount === 1
              ? '1 invoice'
              : `${outstanding.invoiceCount} invoices`}
            {outstanding.oldestAgeDays !== null && (
              <> &middot; oldest {outstanding.oldestAgeDays}d
                {outstanding.oldestCustomerName && (
                  <> &middot; {outstanding.oldestCustomerName}</>
                )}
              </>
            )}
          </div>

          {/* Chase CTA — wires to oldest unpaid job via chaseLadder */}
          {oldestEntry && (
            <HeroChaseCTA entry={oldestEntry} />
          )}

          {/* Per-job chase rows below the hero CTA */}
          <ul className="money-hero__chase-list">
            {unpaid.map(e => (
              <ChaseRow
                key={e.id}
                entry={e}
                onMarkPaid={onMarkPaid}
              />
            ))}
          </ul>
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

      {/* ── 3. Month Profit + Month Paid two-up ──────────────────────────── */}
      <div className="money-twoUp">
        <div className="money-twoUp__card">
          <div className="money-twoUp__label">Month Profit</div>
          <div className={`money-twoUp__value${monthSummary.profit < 0 ? ' money-twoUp__value--negative' : ''}`}>
            {gbp(monthSummary.profit)}
          </div>
        </div>
        <div className="money-twoUp__card">
          <div className="money-twoUp__label">Month Paid</div>
          <div className="money-twoUp__value">{gbp(monthSummary.paid)}</div>
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

      {/* ── Tax position card — DEFERRED ─────────────────────────────────── */}
      {/* Not shipped in M3. No quarterly aggregation exists in cashflow.js.
          Follow-up PR once quarterly grouping + tax-rate input are designed. */}

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

// ── Hero Chase CTA — primary button wired to oldest unpaid job ───────────────
// Separate from ChaseRow: this is a single prominent CTA, not the per-row list.
function HeroChaseCTA({ entry }) {
  const [, forceUpdate] = useState(0);
  const chaseState = getChaseState(entry.rawId);
  const tier = computeTier(chaseState);
  const name = (entry.customer || entry.label || '').split(' ')[0] || 'there';
  const amountOutstanding = gbp(entry.amount);
  const daysSinceDue = chaseState
    ? Math.floor((Date.now() - new Date(chaseState.firstChasedAt)) / (24 * 60 * 60 * 1000))
    : 0;

  const chaseHref = buildChaseLink({
    phone: entry.phone,
    name,
    amountOutstanding,
    daysSinceDue,
    tier,
    amountPaid: 0,
  });

  function handleClick() {
    recordChase(entry.rawId);
    forceUpdate(n => n + 1);
  }

  if (!chaseHref) return null;

  return (
    <a
      href={chaseHref}
      target="_blank"
      rel="noopener noreferrer"
      className="money-hero__chase-cta"
      onClick={handleClick}
    >
      Chase via WhatsApp
    </a>
  );
}

// ── ChaseRow — per-job row (preserved verbatim from pre-M3) ─────────────────
function ChaseRow({ entry, onMarkPaid }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [, forceUpdate] = useState(0);

  const chaseState = getChaseState(entry.rawId);
  const tier = computeTier(chaseState);
  const pill = lastChasedLabel(chaseState);

  const name = (entry.customer || entry.label || '').split(' ')[0] || 'there';
  const amountOutstanding = gbp(entry.amount);
  const daysSinceDue = chaseState
    ? Math.floor((Date.now() - new Date(chaseState.firstChasedAt)) / (24 * 60 * 60 * 1000))
    : 0;

  const chaseHref = buildChaseLink({
    phone: entry.phone,
    name,
    amountOutstanding,
    daysSinceDue,
    tier,
    amountPaid: 0,
  });

  function handleChaseClick() {
    recordChase(entry.rawId);
    forceUpdate(n => n + 1);
  }

  return (
    <li className="unpaid-item">
      <div className="unpaid-main">
        <div className="unpaid-name-group">
          <span className="unpaid-label">{entry.label}</span>
          {pill && <span className="chase-row-pill">{pill}</span>}
        </div>
        <span className="unpaid-amount">{amountOutstanding}</span>
      </div>
      {pickerOpen ? (
        <div className="chase-picker">
          <div className="chase-picker-label">Mark as paid — how?</div>
          <div className="chase-picker-grid">
            <button type="button" className="awaiting-job-method-btn awaiting-job-method-bank"
              onClick={() => { clearChase(entry.rawId); onMarkPaid?.(entry.rawId); setPickerOpen(false); }}>
              Bank
            </button>
            <button type="button" className="awaiting-job-method-btn awaiting-job-method-cash"
              onClick={() => { clearChase(entry.rawId); onMarkPaid?.(entry.rawId); setPickerOpen(false); }}>
              Cash
            </button>
            <button type="button" className="awaiting-job-method-btn awaiting-job-method-card"
              onClick={() => { clearChase(entry.rawId); onMarkPaid?.(entry.rawId); setPickerOpen(false); }}>
              Card
            </button>
          </div>
          <button type="button" className="chase-picker-cancel"
            onClick={() => setPickerOpen(false)}>Cancel</button>
        </div>
      ) : (
        <>
          <div className="chase-row-actions">
            {chaseHref ? (
              <a
                href={chaseHref}
                target="_blank"
                rel="noopener noreferrer"
                className={`chase-btn${tier >= 2 ? ' chase-btn--again' : ''}`}
                onClick={handleChaseClick}
              >
                {tier >= 2 ? 'Chase again' : 'Chase'}
              </a>
            ) : (
              <button type="button" className="chase-btn chase-btn--disabled" disabled>
                {tier >= 2 ? 'Chase again' : 'Chase'}
              </button>
            )}
            {onMarkPaid && (
              <button
                type="button"
                className="mark-paid-btn"
                onClick={() => setPickerOpen(true)}
              >
                Mark paid
              </button>
            )}
          </div>
          {tier >= 4 && (
            <p className="chase-row-hint">Three chases in. Time for a call?</p>
          )}
        </>
      )}
    </li>
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
