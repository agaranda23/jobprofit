import { useState, useMemo, useEffect, useRef } from 'react';
import AddJobModal from '../components/AddJobModal';
import AddReceiptModal from '../components/AddReceiptModal';
import AwaitingCard from '../components/AwaitingCard';
import { gbp, todayKey, formatToday } from '../lib/today';
import { isAwaitingPayment } from '../lib/jobStatus';

export default function TodayScreen({ jobs = [], receipts = [], onAddJob, onAddReceipt, onOpenDetailed, onChase, onMarkPaid }) {
  const [jobOpen, setJobOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [flash, setFlash] = useState(false);
  const prevProfit = useRef(null);

  const key = todayKey();

  const everEmpty = jobs.length === 0 && receipts.length === 0;
  const { earned, spent, profit, recent, hasEntries, unpaidTotal, oldestDays, unpaidCount, weekProfit, weekCount, avgPerJob, lastWeekAvgPerJob, lastWeekCount, sample14JobCount, projectedIncome, projectedSpend, cushion } = useMemo(() => {
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
    // Per-job avg: this week vs last week (paid only, 7-day rolling)
    const fourteenDaysAgo = Date.now() - 14 * 86400000;
    const lastWeekJobs = jobs.filter(j => {
      const t = new Date(j.date || j.createdAt || 0).getTime();
      return t >= fourteenDaysAgo && t < sevenDaysAgo && j.paid !== false;
    });
    const lastWeekCount = lastWeekJobs.length;
    const lastWeekEarned = lastWeekJobs.reduce((s, j) => s + Number(j.amount || 0), 0);
    const avgPerJob = weekCount > 0 ? Math.round(weekEarned / weekCount) : 0;
    const lastWeekAvgPerJob = lastWeekCount > 0 ? Math.round(lastWeekEarned / lastWeekCount) : 0;
    // 30-day outlook: project last 14 days forward, paid-only
    const sample14Jobs = jobs.filter(j => {
      const t = new Date(j.date || j.createdAt || 0).getTime();
      return t >= fourteenDaysAgo && j.paid !== false;
    });
    const sample14Receipts = receipts.filter(r => new Date(r.date || r.createdAt || 0).getTime() >= fourteenDaysAgo);
    const sample14Earned = sample14Jobs.reduce((s, j) => s + Number(j.amount || 0), 0);
    const sample14Spent = sample14Receipts.reduce((s, r) => s + Number(r.amount || 0), 0);
    const sample14JobCount = sample14Jobs.length;
    const projectedIncome = Math.round((sample14Earned / 14) * 30);
    const projectedSpend = Math.round((sample14Spent / 14) * 30);
    const cushion = projectedIncome - projectedSpend;
    return { earned, spent, profit: earned - spent, recent: entries, hasEntries: entries.length > 0, unpaidTotal, oldestDays, unpaidCount: unpaidJobs.length, weekProfit, weekCount, avgPerJob, lastWeekAvgPerJob, lastWeekCount, sample14JobCount, projectedIncome, projectedSpend, cushion };
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

  // Headline insight picker — strict priority order
  // Each tier has thresholds to avoid emotionally-meaningless alerts
  const subhead = (() => {
    // 1. 30-day cover short by >£100 AND sample large enough
    if (sample14JobCount >= 5 && cushion < -100) {
      return `Watch out — short by ${gbp(Math.abs(cushion))} in the next 30 days`;
    }
    // 2. Money owed > £200 AND oldest > 14 days
    if (unpaidTotal > 200 && oldestDays > 14) {
      return `${gbp(unpaidTotal)} still owed — oldest ${oldestDays} day${oldestDays === 1 ? '' : 's'}`;
    }
    // 3. Avg-per-job dropped > £30 vs last week
    if (lastWeekCount > 0 && lastWeekAvgPerJob - avgPerJob > 30) {
      return `Per-job average down ${gbp(lastWeekAvgPerJob - avgPerJob)} vs last week`;
    }
    // 4. Today's profit positive (paid jobs done today)
    if (hasEntries && profit >= 0) {
      return `You're up ${gbp(profit)} today`;
    }
    // 5. Today's profit negative
    if (hasEntries && profit < 0) {
      return `You're down ${gbp(Math.abs(profit))} today`;
    }
    // Default fallback
    return 'Your profit so far today';
  })();

  return (
    <div className="today-screen">
      <div className="app-brand"><img src="/icon-192.png" alt="" className="app-brand-logo" /><span className="app-brand-name">JobProfit</span></div>
      <header className="today-header">
        <h1>Today</h1>
        <p className="today-date">{formatToday()}</p>
        <p className="today-subhead">{subhead}</p>
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

      {(() => {
        const awaitingJobs = jobs
          .filter(isAwaitingPayment)
          .sort((a, b) => new Date(a.invoiceSentAt || 0) - new Date(b.invoiceSentAt || 0));
        if (awaitingJobs.length === 0) return null;
        const totalOwed = awaitingJobs.reduce((s, j) => s + (j.total ?? j.amount ?? 0), 0);
        return (
          <section className="awaiting-section">
            <header className="awaiting-section-header">
              <h3 className="awaiting-section-title">💰 Awaiting payment</h3>
              <span className="awaiting-section-total">
                {gbp(totalOwed)} from {awaitingJobs.length} {awaitingJobs.length === 1 ? 'job' : 'jobs'}
              </span>
            </header>
            <div className="awaiting-list">
              {awaitingJobs.map(j => (
                <AwaitingCard key={j.id} job={j} onMarkPaid={onMarkPaid} />
              ))}
            </div>
            {onChase && (
              <button type="button" className="awaiting-section-link" onClick={onChase}>
                View all in Business →
              </button>
            )}
          </section>
        );
      })()}

      {weekCount > 0 && (
        <div className="avg-card">
          <div className="avg-card-label">This week's average per job</div>
          <div className="avg-card-amount">{gbp(avgPerJob)}</div>
          <div className="avg-card-meta">across {weekCount} job{weekCount === 1 ? '' : 's'}</div>
          {lastWeekCount > 0 ? (
            <div className="avg-card-compare">
              Last week: {gbp(lastWeekAvgPerJob)} across {lastWeekCount} job{lastWeekCount === 1 ? '' : 's'}
              {avgPerJob !== lastWeekAvgPerJob && (
                <span className={`avg-delta ${avgPerJob > lastWeekAvgPerJob ? 'avg-delta-up' : 'avg-delta-down'}`}>
                  {avgPerJob > lastWeekAvgPerJob ? '↑' : '↓'} {gbp(Math.abs(avgPerJob - lastWeekAvgPerJob))}
                </span>
              )}
            </div>
          ) : (
            <div className="avg-card-compare avg-card-compare-soft">First week tracking — comparison appears next week</div>
          )}
        </div>
      )}

      {sample14JobCount > 0 && (() => {
        const enoughSample = sample14JobCount >= 5;
        let tone = 'soft';
        let verdictLabel = '';
        let verdictAmount = 0;
        if (enoughSample) {
          const cushionRatio = projectedSpend > 0 ? cushion / projectedSpend : (cushion > 0 ? 1 : -1);
          verdictAmount = Math.abs(cushion);
          if (cushion >= 0 && cushionRatio >= 0.25) { tone = 'good'; verdictLabel = 'cushion'; }
          else if (cushion >= 0) { tone = 'tight'; verdictLabel = 'cushion (tight)'; }
          else if (cushionRatio >= -0.25) { tone = 'tight'; verdictLabel = 'short — might be tight'; }
          else { tone = 'short'; verdictLabel = 'short'; }
        }
        return (
          <div className={`outlook-card outlook-card-${tone}`}>
            <div className="outlook-card-label">Next 30 days outlook</div>
            {enoughSample ? (
              <>
                <div className="outlook-card-rows">
                  <div className="outlook-card-row"><span>Projected income</span><span>{gbp(projectedIncome)}</span></div>
                  <div className="outlook-card-row"><span>Projected spend</span><span>{gbp(projectedSpend)}</span></div>
                </div>
                <div className="outlook-card-verdict">
                  {tone === 'good' ? '✓' : '⚠'} {gbp(verdictAmount)} {verdictLabel}
                </div>
              </>
            ) : (
              <div className="outlook-card-soft">
                At your recent pace, you're on track for ~{gbp(projectedIncome)} over the next 30 days
              </div>
            )}
            <div className="outlook-card-foot">Based on your last 14 days · {sample14JobCount} job{sample14JobCount === 1 ? '' : 's'}</div>
          </div>
        );
      })()}

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
