import { useState, useMemo, useEffect, useRef } from 'react';
import AddJobModal from '../components/AddJobModal';
import AddReceiptModal from '../components/AddReceiptModal';
import { gbp, todayKey, formatToday } from '../lib/today';
import { isAwaitingPayment, daysSinceInvoice, deriveStatus } from '../lib/jobStatus';
import { getChaseState, recordChase } from '../lib/chaseLadder';

export default function TodayScreen({ jobs = [], receipts = [], onAddJob, onAddReceipt, onOpenDetailed, onChase, onMarkPaid, onJobTap }) {
  const [jobOpen, setJobOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [flash, setFlash] = useState(false);
  const [chaseVersion, setChaseVersion] = useState(0);
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

  // Awaiting-payment totals and single-invoice focus logic for v3
  const { awaitingTotal, awaitingCount, focusInvoice, remainingCount, allChasedToday } = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartIso = todayStart.toISOString();

    const awaitingJobs = jobs.filter(isAwaitingPayment);
    const awaitingTotal = awaitingJobs.reduce((s, j) => s + (j.total ?? j.amount ?? 0), 0);
    const awaitingCount = awaitingJobs.length;

    if (awaitingCount === 0) {
      return { awaitingTotal: 0, awaitingCount: 0, focusInvoice: null, remainingCount: 0, allChasedToday: false };
    }

    // Sort: never-chased first, then oldest lastChasedAt, then oldest invoice age as tiebreak
    const sorted = [...awaitingJobs].sort((a, b) => {
      const sa = getChaseState(a.id);
      const sb = getChaseState(b.id);
      const hasA = sa && sa.lastChasedAt;
      const hasB = sb && sb.lastChasedAt;
      if (!hasA && !hasB) {
        // Both never chased — oldest invoice first
        return new Date(a.invoiceSentAt || a.date || 0) - new Date(b.invoiceSentAt || b.date || 0);
      }
      if (!hasA) return -1; // A never chased — surfaces first
      if (!hasB) return 1;  // B never chased — surfaces first
      // Both chased — oldest lastChasedAt first
      const diff = new Date(sa.lastChasedAt) - new Date(sb.lastChasedAt);
      if (diff !== 0) return diff;
      // Tiebreak: oldest invoice age
      return new Date(a.invoiceSentAt || a.date || 0) - new Date(b.invoiceSentAt || b.date || 0);
    });

    // Check whether every outstanding invoice was chased today
    const allChasedToday = sorted.every(j => {
      const s = getChaseState(j.id);
      return s && s.lastChasedAt >= todayStartIso;
    });

    if (allChasedToday) {
      return { awaitingTotal, awaitingCount, focusInvoice: null, remainingCount: 0, allChasedToday: true };
    }

    // Pick the first that hasn't been chased today as the focus invoice
    const focusInvoice = sorted.find(j => {
      const s = getChaseState(j.id);
      return !s || !s.lastChasedAt || s.lastChasedAt < todayStartIso;
    }) ?? sorted[0];

    // Remaining = all outstanding except the one being surfaced
    const remainingCount = awaitingCount - 1;

    return { awaitingTotal, awaitingCount, focusInvoice, remainingCount, allChasedToday: false };
  }, [jobs, chaseVersion]);

  // Headline insight picker — strict priority order
  // Each tier has thresholds to avoid emotionally-meaningless alerts
  const subhead = (() => {
    // 0. Money on the table (always wins when there's cash owed — it's the loop climax)
    if (awaitingCount > 0) {
      if (allChasedToday) {
        // All chased today — fall through to other insight tiers below
      } else if (focusInvoice) {
        const amount = focusInvoice.total ?? focusInvoice.amount ?? 0;
        const name = focusInvoice.customer || focusInvoice.customerName || 'Customer';
        const tail = remainingCount > 0 ? ` · ${remainingCount} more after this` : '';
        return `Chase ${gbp(amount)} from ${name}${tail}`;
      }
    }
    // 1. 30-day cover short by >£100 AND sample large enough
    if (sample14JobCount >= 5 && cushion < -100) {
      return `Watch out — short by ${gbp(Math.abs(cushion))} in the next 30 days`;
    }
    // 2. Avg-per-job dropped > £30 vs last week
    if (lastWeekCount > 0 && lastWeekAvgPerJob - avgPerJob > 30) {
      return `Per-job average down ${gbp(lastWeekAvgPerJob - avgPerJob)} vs last week`;
    }
    // 3. Today's profit positive (paid jobs done today)
    if (hasEntries && profit >= 0) {
      return `You're up ${gbp(profit)} today`;
    }
    // 4. Today's profit negative
    if (hasEntries && profit < 0) {
      return `You're down ${gbp(Math.abs(profit))} today`;
    }
    // Default fallback
    return 'Your profit so far today';
  })();

  return (
    <div className="today-screen">
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
        {/* awaiting footnote removed — promoted to Money on the table card below */}
      </section>

      <MoneyOnTheTable
        focusInvoice={focusInvoice}
        awaitingTotal={awaitingTotal}
        allChasedToday={allChasedToday}
        onMarkPaid={onMarkPaid}
        onNavigateToMoney={onChase}
        onChaseRecorded={() => setChaseVersion(v => v + 1)}
      />
      <NextUpCard jobs={jobs} onJobTap={onJobTap} />

      <section className="actions">
        <button className="action-btn action-primary" onClick={() => setJobOpen(true)}>
          <span className="action-icon">🎤</span><span>Add job</span>
        </button>
        <button className="action-btn action-secondary" onClick={() => setReceiptOpen(true)}>
          <span className="action-icon">📸</span><span>Add receipt</span>
        </button>
      </section>

      {weekCount > 0 && (
        <div className="avg-card">
          <div className="avg-card-label">This week's average per job</div>
          <div className="avg-card-amount">{gbp(avgPerJob)}</div>
          <div className="avg-card-meta">across {weekCount} job{weekCount === 1 ? '' : 's'}</div>
          {lastWeekCount > 0 && (
            <div className="avg-card-compare">
              Last week: {gbp(lastWeekAvgPerJob)} across {lastWeekCount} job{lastWeekCount === 1 ? '' : 's'}
              {avgPerJob !== lastWeekAvgPerJob && (
                <span className={`avg-delta ${avgPerJob > lastWeekAvgPerJob ? 'avg-delta-up' : 'avg-delta-down'}`}>
                  {avgPerJob > lastWeekAvgPerJob ? '↑' : '↓'} {gbp(Math.abs(avgPerJob - lastWeekAvgPerJob))}
                </span>
              )}
            </div>
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

// ── Money on the table (v3 — single-invoice focus) ───────────────────────────
// Shows the one invoice that most needs chasing right now.
// Collapses to a single "All chased today" line when every outstanding invoice
// has been chased at least once today. Hidden entirely when nothing is owed.

function MoneyOnTheTable({ focusInvoice, awaitingTotal, allChasedToday, onMarkPaid, onNavigateToMoney, onChaseRecorded }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  // When focusInvoice changes (e.g. after chase), reset the picker
  const prevFocusId = useRef(null);
  if (focusInvoice?.id !== prevFocusId.current) {
    prevFocusId.current = focusInvoice?.id ?? null;
    if (pickerOpen) setPickerOpen(false);
  }

  // All-chased-today collapsed line
  if (allChasedToday) {
    return (
      <button
        type="button"
        className="motm-all-chased"
        onClick={() => onNavigateToMoney?.()}
      >
        <span className="motm-all-chased-text">
          <span className="motm-all-chased-tick">✓</span> All chased today · {gbp(awaitingTotal)} still owed
        </span>
        <span className="motm-all-chased-arrow" aria-hidden="true">→</span>
      </button>
    );
  }

  // No focus invoice and not all-chased — nothing owed
  if (!focusInvoice) return null;

  const amount = focusInvoice.total ?? focusInvoice.amount ?? 0;
  const customer = focusInvoice.customer || focusInvoice.customerName || 'Customer';
  const jobName = focusInvoice.name || focusInvoice.summary?.slice(0, 30) || 'job';
  const days = daysSinceInvoice(focusInvoice);

  const agePhrasing = (() => {
    if (days == null) return 'Invoice sent';
    if (days === 0)   return 'Sent today';
    if (days === 1)   return '1 day overdue';
    return `${days} days overdue`;
  })();

  const handleChase = () => {
    const firstName = customer.split(' ')[0];
    const msg = `Hi ${firstName}, quick nudge on the invoice for ${jobName} — ${gbp(amount)}. Any update? Cheers.`;
    const phone = focusInvoice.customerPhone || focusInvoice.phone || '';
    if (phone) {
      const clean = phone.replace(/\s/g, '').replace(/^0/, '44').replace(/^\+/, '');
      window.open(`https://wa.me/${clean}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
    } else {
      const email = focusInvoice.customerEmail || focusInvoice.email || '';
      window.open(`mailto:${email}?subject=Invoice reminder&body=${encodeURIComponent(msg)}`, '_blank', 'noopener');
    }
    recordChase(focusInvoice.id);
    onChaseRecorded?.();
  };

  return (
    <section className="motm-section">
      <div
        className="motm-card"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          // Only navigate if the tap landed on the card body — not on the CTA buttons
          if (!e.target.closest('.motm-cta-chase') && !e.target.closest('.motm-cta-paid') && !e.target.closest('.motm-picker')) {
            onNavigateToMoney?.();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onNavigateToMoney?.();
        }}
      >
        <div className="motm-label">Oldest on the table</div>
        <div className="motm-customer">{customer}</div>
        <div className="motm-meta">{gbp(amount)} · {agePhrasing}</div>

        {pickerOpen ? (
          <div className="motm-picker" onClick={e => e.stopPropagation()}>
            <div className="motm-picker-label">How were you paid?</div>
            <div className="motm-picker-grid">
              <button type="button" className="awaiting-job-method-btn awaiting-job-method-bank"
                onClick={() => { onMarkPaid?.(focusInvoice, 'bank transfer'); setPickerOpen(false); }}>Bank</button>
              <button type="button" className="awaiting-job-method-btn awaiting-job-method-cash"
                onClick={() => { onMarkPaid?.(focusInvoice, 'cash'); setPickerOpen(false); }}>Cash</button>
              <button type="button" className="awaiting-job-method-btn awaiting-job-method-card"
                onClick={() => { onMarkPaid?.(focusInvoice, 'card'); setPickerOpen(false); }}>Card</button>
            </div>
            <button type="button" className="motm-picker-cancel"
              onClick={() => setPickerOpen(false)}>Cancel</button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="motm-cta-chase"
              onClick={(e) => { e.stopPropagation(); handleChase(); }}
            >
              Chase via WhatsApp
            </button>
            <button
              type="button"
              className="motm-cta-paid"
              onClick={(e) => { e.stopPropagation(); setPickerOpen(true); }}
            >
              Mark paid
            </button>
          </>
        )}
      </div>
    </section>
  );
}

// ── Next up ───────────────────────────────────────────────────────────────────
// Shows the soonest future scheduled job that isn't paid.
// Hidden when no jobs are scheduled in the next 7 days.

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatScheduledDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

function NextUpCard({ jobs, onJobTap }) {
  const nextJob = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return jobs
      .filter(j => {
        const dateStr = (j.scheduledDate || '').slice(0, 10);
        if (!dateStr || dateStr < todayStr) return false;
        return deriveStatus(j) !== 'paid';
      })
      .sort((a, b) => {
        const da = a.scheduledDate || '';
        const db = b.scheduledDate || '';
        return da.localeCompare(db);
      })[0] ?? null;
  }, [jobs]);

  if (!nextJob) return null;

  const customer = nextJob.customer || nextJob.customerName || 'Customer';
  const jobName = nextJob.name || nextJob.summary?.slice(0, 40) || '';
  const amount = nextJob.total ?? nextJob.amount;
  const dateLabel = formatScheduledDate(nextJob.scheduledDate);

  const metaLine = [
    dateLabel,
    amount ? `${gbp(amount)} expected` : null,
  ].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className="next-up-card"
      onClick={() => onJobTap?.(nextJob)}
      aria-label={`View job: ${customer}${jobName ? ` — ${jobName}` : ''}`}
    >
      <span className="next-up-label">Next up</span>
      <span className="next-up-name">{customer}{jobName ? ` — ${jobName}` : ''}</span>
      <span className="next-up-meta">{metaLine}</span>
    </button>
  );
}

