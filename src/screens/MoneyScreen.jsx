/**
 * MoneyScreen — Tab 4 in the new nav. Replaces HistoryScreen as the money tab.
 * Slice 1: surfaces the existing Insights/History content under the Money label.
 * Chase-via-WhatsApp flow (slice 4) and job-type profitability (slice 5) are placeholders.
 *
 * polish/finance-hero-reframe: outstanding hero promoted to top, week totals
 * demoted to a single compact strip, section renamed to "Chase these".
 */
import { useMemo, useState } from 'react';
import { gbp } from '../lib/today';
import HeaderAvatar from '../components/HeaderAvatar';
import {
  getChaseState,
  recordChase,
  clearChase,
  computeTier,
  buildChaseLink,
  lastChasedLabel,
} from '../lib/chaseLadder.js';

export default function MoneyScreen({ jobs = [], receipts = [], session, profile, onAvatarClick, onMarkPaid }) {
  const now = new Date();
  const startOfWeek = getStartOfWeek(now);

  const { weekEarned, weekSpent, weekProfit, unpaid, unpaidTotal, grouped } = useMemo(() => {
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

    const thisWeek = allEntries.filter(e => new Date(e.ts) >= startOfWeek);
    const weekEarned = thisWeek.filter(e => e.kind === 'job').reduce((s, e) => s + e.amount, 0);
    const weekSpent  = thisWeek.filter(e => e.kind === 'receipt').reduce((s, e) => s + Math.abs(e.amount), 0);
    const unpaid = allEntries.filter(e => e.kind === 'job' && !e.paid);
    const unpaidTotal = unpaid.reduce((s, e) => s + e.amount, 0);

    const groups = {};
    for (const e of allEntries) {
      const d = new Date(e.ts);
      const key = keyOfDay(d);
      if (!groups[key]) groups[key] = { label: labelOfDay(d, now), entries: [] };
      groups[key].entries.push(e);
    }
    const grouped = Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([k, v]) => ({ key: k, ...v }));

    return { weekEarned, weekSpent, weekProfit: weekEarned - weekSpent, unpaid, unpaidTotal, grouped };
  }, [jobs, receipts, startOfWeek.getTime()]);

  const hasActivity = grouped.length > 0 || unpaid.length > 0;

  return (
    <div className="screen money-screen">
      <div className="screen-header">
        <h1 className="screen-title">Finance</h1>
        {onAvatarClick && (
          <div className="screen-header-right">
            <HeaderAvatar session={session} profile={profile} onClick={onAvatarClick} />
          </div>
        )}
      </div>

      {/* ── Outstanding hero ─────────────────────────────────────── */}
      {unpaid.length === 0 ? (
        <div className="outstanding-hero outstanding-hero--clear">
          <span className="outstanding-hero-caught-up">You&rsquo;re all caught up.</span>
        </div>
      ) : (
        <div className="outstanding-hero">
          <div className="outstanding-hero-label">Outstanding</div>
          <div className="outstanding-hero-figure">{gbp(unpaidTotal)}</div>
          <div className="outstanding-hero-sub">
            {unpaid.length === 1
              ? '1 job waiting on payment'
              : `${unpaid.length} jobs waiting on payment`}
          </div>
        </div>
      )}

      {/* ── Chase these ──────────────────────────────────────────── */}
      {unpaid.length > 0 && (
        <div className="chase-section">
          <h2 className="chase-section-title">Chase these</h2>
          <ul className="unpaid-list">
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

      {/* ── Week totals strip ────────────────────────────────────── */}
      <div className="week-totals-strip">
        {`This week: +${gbp(weekEarned)} earned · –${gbp(weekSpent)} spent · ${gbp(weekProfit)} profit`}
      </div>

      {/* ── Insights teaser — untouched ──────────────────────────── */}
      <div className="money-insights-teaser">
        <div className="money-insights-label">Where the money is</div>
        <p className="money-insights-hint">
          Job-type profitability breakdown coming soon — you&apos;ll see which jobs earn the most per hour.
        </p>
      </div>

      {/* ── Timeline ─────────────────────────────────────────────── */}
      {grouped.length > 0 && (
        <div className="timeline">
          {grouped.map(g => (
            <div key={g.key} className="timeline-group">
              <h3>{g.label}</h3>
              <ul className="recent-list">
                {g.entries.map(e => (
                  <li key={e.id} className="recent-item">
                    <span>{e.label}</span>
                    <span className={`recent-amount ${e.amount >= 0 ? 'pos' : 'neg'}`}>
                      {e.amount >= 0 ? '+' : ''}{gbp(Math.abs(e.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* ── Full empty state ─────────────────────────────────────── */}
      {!hasActivity && (
        <div className="screen-empty">
          <p className="screen-empty-title">Nothing&apos;s moved yet.</p>
          <p className="screen-empty-hint">
            Finish a job and send the invoice — it&apos;ll show up here.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Chase row with tiered WhatsApp / Mark paid actions ───────────────── */
function ChaseRow({ entry, onMarkPaid }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Chase state is read fresh on each render — no hook needed since it's a
  // pure localStorage read and the component re-renders after recordChase
  // updates state via the local pickerOpen toggle (which forces a re-mount).
  // We use a local re-render trigger instead to keep the pill live.
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
        <span className="unpaid-label">{entry.label}</span>
        <span className="unpaid-amount">{amountOutstanding}</span>
        {pill && <span className="chase-row-pill">{pill}</span>}
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

function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

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
