import { useState, useMemo, useEffect, useRef } from 'react';
import AddJobModal from '../components/AddJobModal';
import AddReceiptModal from '../components/AddReceiptModal';
import { gbp, todayKey, formatToday } from '../lib/today';

export default function TodayScreen({ jobs = [], receipts = [], onAddJob, onAddReceipt, onOpenDetailed }) {
  const [jobOpen, setJobOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [flash, setFlash] = useState(false);
  const prevProfit = useRef(null);

  const key = todayKey();

  const everEmpty = jobs.length === 0 && receipts.length === 0;
  const { earned, spent, profit, recent, hasEntries, unpaidTotal, oldestDays, unpaidCount, weekProfit, weekCount } = useMemo(() => {
    const todaysJobs = jobs.filter(j => (j.date || '').slice(0, 10) === key);
    const todaysReceipts = receipts.filter(r => (r.date || '').slice(0, 10) === key);
    const earned = todaysJobs.filter(j => j.paid !== false).reduce((s, j) => s + Number(j.amount || 0), 0);
    const spent = todaysReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);
    const entries = [
      ...todaysJobs.map(j => ({ id: 'j' + j.id, label: j.name || 'Job', amount: Number(j.amount || 0), ts: j.createdAt || j.date })),
      ...todaysReceipts.map(r => ({ id: 'r' + r.id, label: r.label || 'Receipt', amount: -Number(r.amount || 0), ts: r.createdAt || r.date })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 3);
    const unpaidJobs = jobs.filter(j => j.paid === false);
    const unpaidTotal = unpaidJobs.reduce((s, j) => s + Number(j.amount || 0), 0);
    const now = new Date();
    let oldestDays = 0;
    for (const j of unpaidJobs) {
      const d = new Date(j.date || j.createdAt || now);
      const days = Math.floor((now - d) / 86400000);
      if (days > oldestDays) oldestDays = days;
    }
    // Week profit = all paid job amounts in last 7 days - all receipts in last 7 days
    const sevenDaysAgo = Date.now() - 7 * 86400000;
    const weekJobs = jobs.filter(j => new Date(j.date || j.createdAt || 0).getTime() >= sevenDaysAgo && j.paid !== false);
    const weekReceipts = receipts.filter(r => new Date(r.date || r.createdAt || 0).getTime() >= sevenDaysAgo);
    const weekEarned = weekJobs.reduce((s, j) => s + Number(j.amount || 0), 0);
    const weekSpent = weekReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);
    const weekProfit = weekEarned - weekSpent;
    const weekCount = weekJobs.length;
    return { earned, spent, profit: earned - spent, recent: entries, hasEntries: entries.length > 0, unpaidTotal, oldestDays, unpaidCount: unpaidJobs.length, weekProfit, weekCount };
  }, [jobs, receipts, key]);

  // Flash profit when it changes
  useEffect(() => {
    if (prevProfit.current !== null && prevProfit.current !== profit) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 900);
      return () => clearTimeout(t);
    }
    prevProfit.current = profit;
  }, [profit]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2400);
  };

  const handleJobSave = async (payload) => {
    setJobOpen(false);
    showToast('Job saved');
    try { await onAddJob?.(payload); } catch (e) { showToast('Saved offline — will sync'); }
  };
  const handleReceiptSave = async (payload) => {
    setReceiptOpen(false);
    showToast('Receipt saved');
    try { await onAddReceipt?.(payload); } catch (e) { showToast('Saved offline — will sync'); }
  };

  const subhead = hasEntries
    ? (profit >= 0 ? `You're up ${gbp(profit)} today` : `You're down ${gbp(Math.abs(profit))} today`)
    : 'Your profit so far today';

  return (
    <div className="today-screen">
      <div className="app-brand"><img src="/icon-192.png" alt="" className="app-brand-logo" /><span className="app-brand-name">JobProfit</span></div>
      <header className="today-header">
        <h1>Today</h1>
        <p className="today-date">{formatToday()}</p>
        <p className="today-subhead">{subhead}</p>
        {unpaidCount > 0 && (
          <p className="today-unpaid-line">
            <span className="unpaid-amount-inline">{gbp(unpaidTotal)}</span> waiting to be collected
            {oldestDays > 0 && <span className="unpaid-age"> · oldest {oldestDays} day{oldestDays === 1 ? '' : 's'}</span>}
          </p>
        )}
        {weekCount > 0 && (
          <p className="today-week-line">
            This week: <span className="week-profit-inline">{gbp(weekProfit)}</span> across {weekCount} job{weekCount === 1 ? '' : 's'}
          </p>
        )}
      </header>

      <section className="totals">
        <div className="total-row"><span className="total-label">Earned</span><span className="total-value">{gbp(earned)}</span></div>
        <div className="total-row"><span className="total-label">Spent</span><span className="total-value">{gbp(spent)}</span></div>
        <div className="total-row profit-row">
          <span className="total-label">Profit</span>
          <span className={`total-value profit-value ${flash ? 'flash' : ''}`}>{gbp(profit)}</span>
        </div>
        {unpaidTotal > 0 && (
          <div className="total-row total-awaiting-row">
            <span className="total-awaiting-label">+ {gbp(unpaidTotal)} awaiting</span>
          </div>
        )}
      </section>

      <section className="actions">
        <button className="action-btn action-primary" onClick={() => setJobOpen(true)}>
          <span className="action-icon">🎤</span><span>Add job</span>
        </button>
        <button className="action-btn action-secondary" onClick={() => setReceiptOpen(true)}>
          <span className="action-icon">📸</span><span>Add receipt</span>
        </button>
      </section>

      {everEmpty && (
        <p className="empty-hint">Add your first job to start tracking profit</p>
      )}

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
          onSave={handleJobSave}
          onOpenDetailed={onOpenDetailed}
        />
      )}
      {receiptOpen && (
        <AddReceiptModal
          onClose={() => setReceiptOpen(false)}
          onSave={handleReceiptSave}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
