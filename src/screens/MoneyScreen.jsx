/**
 * MoneyScreen — Tab 4 in the new nav. Replaces HistoryScreen as the money tab.
 * Slice 1: surfaces the existing Insights/History content under the Money label.
 * Chase-via-WhatsApp flow (slice 4) and job-type profitability (slice 5) are placeholders.
 */
import { useMemo } from 'react';
import { gbp } from '../lib/today';
import HeaderAvatar from '../components/HeaderAvatar';

export default function MoneyScreen({ jobs = [], receipts = [], session, profile, onAvatarClick, onMarkPaid }) {
  const now = new Date();
  const startOfWeek = getStartOfWeek(now);

  const { weekEarned, weekSpent, weekProfit, unpaid, grouped } = useMemo(() => {
    const allEntries = [
      ...jobs.map(j => ({
        id: 'j' + j.id,
        rawId: j.id,
        kind: 'job',
        label: j.name || j.customer || 'Job',
        amount: Number(j.amount || 0),
        paid: j.paid !== false,
        ts: j.createdAt || j.date,
      })),
      ...receipts.map(r => ({
        id: 'r' + r.id,
        rawId: r.id,
        kind: 'receipt',
        label: r.label || 'Receipt',
        amount: -Number(r.amount || 0),
        paid: true,
        ts: r.createdAt || r.date,
      })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts));

    const thisWeek = allEntries.filter(e => new Date(e.ts) >= startOfWeek);
    const weekEarned = thisWeek.filter(e => e.kind === 'job').reduce((s, e) => s + e.amount, 0);
    const weekSpent  = thisWeek.filter(e => e.kind === 'receipt').reduce((s, e) => s + Math.abs(e.amount), 0);
    const unpaid = allEntries.filter(e => e.kind === 'job' && !e.paid);

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

    return { weekEarned, weekSpent, weekProfit: weekEarned - weekSpent, unpaid, grouped };
  }, [jobs, receipts, startOfWeek.getTime()]);

  return (
    <div className="screen money-screen">
      <div className="screen-header">
        <h1 className="screen-title">Money</h1>
        <div className="screen-header-right">
          <HeaderAvatar session={session} profile={profile} onClick={onAvatarClick} />
        </div>
      </div>

      {/* Week summary */}
      <div className="totals">
        <div className="total-row">
          <span className="total-label">Earned this week</span>
          <span className="total-value">{gbp(weekEarned)}</span>
        </div>
        <div className="total-row">
          <span className="total-label">Spent this week</span>
          <span className="total-value">{gbp(weekSpent)}</span>
        </div>
        <div className="total-row profit-row">
          <span className="total-label">Profit</span>
          <span className="total-value profit-value">{gbp(weekProfit)}</span>
        </div>
      </div>

      {/* Awaiting payment */}
      {unpaid.length > 0 && (
        <div className="unpaid">
          <h2>Awaiting payment</h2>
          <ul className="unpaid-list">
            {unpaid.map(e => (
              <li key={e.id} className="unpaid-item">
                <div className="unpaid-main">
                  <span className="unpaid-label">{e.label}</span>
                  <span className="unpaid-amount">{gbp(e.amount)}</span>
                </div>
                {onMarkPaid && (
                  <button
                    className="mark-paid-btn"
                    onClick={() => onMarkPaid(e.rawId)}
                  >
                    Mark as paid
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Profitability teaser — slice 5 will fill this */}
      <div className="money-insights-teaser">
        <div className="money-insights-label">WHERE THE MONEY IS</div>
        <p className="money-insights-hint">
          Job-type profitability breakdown coming soon — you'll see which jobs earn the most per hour.
        </p>
      </div>

      {/* Timeline */}
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

      {grouped.length === 0 && unpaid.length === 0 && (
        <div className="screen-empty">
          <p className="screen-empty-title">No transactions yet</p>
          <p className="screen-empty-hint">Add a job or receipt from the Today tab to see your money here.</p>
        </div>
      )}
    </div>
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
