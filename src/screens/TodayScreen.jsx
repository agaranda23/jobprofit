import { useState, useMemo } from 'react';
import AddJobModal from '../components/AddJobModal';
import AddReceiptModal from '../components/AddReceiptModal';
import { gbp, todayKey, formatToday } from '../lib/today';

export default function TodayScreen({ jobs = [], receipts = [], onAddJob, onAddReceipt }) {
  const [jobOpen, setJobOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const key = todayKey();

  const { earned, spent, profit, recent, hasEntries } = useMemo(() => {
    const todaysJobs = jobs.filter(j => (j.date || '').slice(0, 10) === key);
    const todaysReceipts = receipts.filter(r => (r.date || '').slice(0, 10) === key);

    const earned = todaysJobs.reduce((s, j) => s + Number(j.amount || 0), 0);
    const spent = todaysReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);

    const entries = [
      ...todaysJobs.map(j => ({ id: 'j' + j.id, label: j.name || 'Job', amount: Number(j.amount || 0), ts: j.createdAt || j.date })),
      ...todaysReceipts.map(r => ({ id: 'r' + r.id, label: r.label || 'Receipt', amount: -Number(r.amount || 0), ts: r.createdAt || r.date })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 3);

    return { earned, spent, profit: earned - spent, recent: entries, hasEntries: entries.length > 0 };
  }, [jobs, receipts, key]);

  const subhead = hasEntries
    ? (profit >= 0 ? `You're up ${gbp(profit)} today` : `You're down ${gbp(Math.abs(profit))} today`)
    : 'Your profit so far today';

  return (
    <div className="today-screen">
      <header className="today-header">
        <h1>Today</h1>
        <p className="today-date">{formatToday()}</p>
        <p className="today-subhead">{subhead}</p>
      </header>

      <section className="totals">
        <div className="total-row">
          <span className="total-label">Earned</span>
          <span className="total-value">{gbp(earned)}</span>
        </div>
        <div className="total-row">
          <span className="total-label">Spent</span>
          <span className="total-value">{gbp(spent)}</span>
        </div>
        <div className="total-row profit-row">
          <span className="total-label">Profit</span>
          <span className="total-value profit-value">{gbp(profit)}</span>
        </div>
      </section>

      <section className="actions">
        <button className="action-btn action-primary" onClick={() => setJobOpen(true)}>
          <span className="action-icon">🎤</span>
          <span>Add job</span>
        </button>
        <button className="action-btn action-secondary" onClick={() => setReceiptOpen(true)}>
          <span className="action-icon">📸</span>
          <span>Add receipt</span>
        </button>
      </section>

      {recent.length > 0 && (
        <section className="recent">
          <div className="recent-divider" />
          <h2>Recent today</h2>
          <ul className="recent-list">
            {recent.map(e => (
              <li key={e.id} className="recent-item">
                <span className="recent-label">{e.label}</span>
                <span className={`recent-amount ${e.amount >= 0 ? 'pos' : 'neg'}`}>
                  {e.amount >= 0 ? '+' : '−'}{gbp(Math.abs(e.amount))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {jobOpen && (
        <AddJobModal
          onClose={() => setJobOpen(false)}
          onSave={(payload) => { onAddJob?.(payload); setJobOpen(false); }}
        />
      )}
      {receiptOpen && (
        <AddReceiptModal
          onClose={() => setReceiptOpen(false)}
          onSave={(payload) => { onAddReceipt?.(payload); setReceiptOpen(false); }}
        />
      )}
    </div>
  );
}
