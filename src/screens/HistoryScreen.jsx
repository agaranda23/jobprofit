import { useMemo } from 'react';
import { gbp } from '../lib/today';

export default function HistoryScreen({ jobs = [], receipts = [], onMarkPaid }) {
  const now = new Date();
  const startOfWeek = getStartOfWeek(now);

  const { weekEarned, weekSpent, weekProfit, unpaid, grouped } = useMemo(() => {
    const allEntries = [
      ...jobs.map(j => ({
        id: 'j' + j.id,
        rawId: j.id,
        kind: 'job',
        label: j.name || 'Job',
        amount: Number(j.amount || 0),
        paid: j.paid !== false, // default true if missing
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
    const weekSpent = thisWeek.filter(e => e.kind === 'receipt').reduce((s, e) => s + Math.abs(e.amount), 0);

    const unpaid = allEntries.filter(e => e.kind === 'job' && !e.paid);

    // Group by day
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
    <div className="today-screen">
      <div className="app-brand"><img src="/icon-192.png" alt="" className="app-brand-logo" /><span className="app-brand-name">JobProfit</span></div>
      <header className="today-header">
        <h1>Insights</h1>
        <p className="today-date">This week</p>
      </header>

      <section className="totals">
        <div className="total-row">
          <span className="total-label">Earned</span>
          <span className="total-value">{gbp(weekEarned)}</span>
        </div>
        <div className="total-row">
          <span className="total-label">Spent</span>
          <span className="total-value">{gbp(weekSpent)}</span>
        </div>
        <div className="total-row profit-row">
          <span className="total-label">Profit</span>
          <span className="total-value profit-value">{gbp(weekProfit)}</span>
        </div>
      </section>

      {unpaid.length > 0 && (
        <section className="unpaid">
          <h2>Unpaid</h2>
          <ul className="unpaid-list">
            {unpaid.map(e => (
              <li key={e.id} className="unpaid-item">
                <div className="unpaid-main">
                  <span className="unpaid-label">{e.label}</span>
                  <span className="unpaid-amount">{gbp(e.amount)}</span>
                </div>
                {(() => {
                  const d = new Date(e.ts);
                  const days = Math.floor((Date.now() - d) / 86400000);
                  return days > 0 ? <p className="unpaid-age-line">{days} day{days === 1 ? '' : 's'} unpaid</p> : null;
                })()}
                <button className="mark-paid-btn" onClick={() => onMarkPaid?.(e.rawId)}>
                  Mark as paid
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {grouped.length === 0 ? (
        <section className="recent">
          <div className="recent-divider" />
          <p className="empty-state">Your timeline will appear here as you add jobs and receipts</p>
        </section>
      ) : (
        <section className="timeline">
          <div className="recent-divider" />
          {grouped.map(g => (
            <div key={g.key} className="day-group">
              <h3 className="day-label">{g.label}</h3>
              <ul className="recent-list">
                {g.entries.map(e => (
                  <li key={e.id} className="recent-item">
                    <span className="recent-label">
                      {e.label}
                      {e.kind === 'job' && !e.paid && <span className="unpaid-chip">unpaid</span>}
                    </span>
                    <span className={`recent-amount ${e.amount >= 0 ? 'pos' : 'neg'}`}>
                      {e.amount >= 0 ? '+' : '−'}{gbp(Math.abs(e.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function getStartOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0 = Sun
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  const mon = new Date(date.setDate(diff));
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function keyOfDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function labelOfDay(d, now) {
  const dayMs = 86400000;
  const today = new Date(now); today.setHours(0,0,0,0);
  const target = new Date(d); target.setHours(0,0,0,0);
  const diffDays = Math.round((today - target) / dayMs);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return target.toLocaleDateString('en-GB', { weekday: 'long' });
  return target.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
