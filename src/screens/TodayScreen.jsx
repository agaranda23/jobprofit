/**
 * TodayScreen — "The Foreman" (PRD 2026-05-30, updated 2026-05-31)
 *
 * One screen, one prompt. Ranking algorithm (deterministic, top-wins):
 *   Tier 1 — Overdue chase (invoice sent, due_date < today, unpaid, not snoozed)
 *   Tier 2 — Finished-but-not-invoiced (job complete >48h, no invoice sent)
 *   Tier 3 — Stale sent quote (status quoted, quoteSentAt ≥3 days ago, not accepted)
 *   Tier 4 — Accepted-not-started: SKIPPED — the accepted-quote banner handles this.
 *   Tier 5 — All-clear (nothing actionable)
 *
 * Tie-break across peers within the same tier: largest £ → oldest date → lowest ID.
 *
 * IA migration (components removed from Today, promoted to FinanceScreen/Money):
 *   - Earned/Spent/Profit card  → top of FinanceScreen
 *   - Average per Job card      → FinanceScreen
 *   - 30-Day Outlook card       → FinanceScreen
 *   - Add Receipt button        → FinanceScreen (already present)
 *   - Pro upsell row            → removed entirely
 *   - Recent Today feed         → removed
 *   - Next Up card              → removed
 */

import { useState, useMemo, useCallback } from 'react';
import AddJobModal from '../components/AddJobModal';
import ReviewSheet from '../components/ReviewSheet';
import GetProPill from '../components/GetProPill';
import ProUpgradeSheet from '../components/ProUpgradeSheet';
import { gbp, formatToday } from '../lib/today';
import { isAwaitingPayment, deriveStatus } from '../lib/jobStatus';
import { daysPastDue, recordChase, buildChaseMessage, computeTier, buildPaymentDetails } from '../lib/chaseLadder';
import { writeJobMeta, extractJobMeta } from '../lib/jobMeta';
import { getNewlyAcceptedJobs, buildAcceptedLabel, formatAcceptedDate } from '../lib/acceptedNotification';
import {
  rankNextBestAction,
  readSnoozeStore,
  writeSnoozeStore,
  nbaLabel,
  nbaHeadline,
  nbaMeta,
  nbaCta,
  jobAmount,
} from '../lib/nextBestAction';
import { isPro } from '../lib/plan';

// ── Snooze helpers (delegate to nextBestAction.js store, keep SNOOZE_MS local) ──
const SNOOZE_MS = 24 * 60 * 60 * 1000;

function isJobSnoozed(jobId, now = new Date()) {
  const store = readSnoozeStore();
  const until = store[jobId];
  return !!(until && new Date(until) > now);
}

function snoozeJob(jobId) {
  const store = readSnoozeStore();
  store[jobId] = new Date(Date.now() + SNOOZE_MS).toISOString();
  writeSnoozeStore(store);
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TodayScreen({
  jobs = [],
  receipts = [],
  onAddJob,
  onUpdateJob,
  onOpenDetailed,
  onMarkPaid,
  onJobTap,
  onNavigateToMoney,
  onNavigateToCardPayments,
  profile,
}) {
  const [jobOpen, setJobOpen] = useState(false);
  // jobOpenMode: 'normal' | 'quote' — controls defaultMode prop on AddJobModal.
  // 'quote' opens the create-quote surface (voice-first, both voice and type supported).
  // 'normal' opens the micro-log keypad.
  const [jobOpenMode, setJobOpenMode] = useState('normal');
  // reviewQuoteJob: when set, opens ReviewSheet in quote mode immediately after
  // a voice "Save & send quote" action. Cleared when the sheet closes.
  const [reviewQuoteJob, setReviewQuoteJob] = useState(null);
  const [toast, setToast] = useState('');
  // toastAction: { label, onClick } — an optional action button inside the toast.
  // Only used for the fast-save "View" link. Cleared when toast auto-dismisses.
  const [toastAction, setToastAction] = useState(null);
  // gotPaidToastQueue: FIFO array of { job, timerId } shown after Speed-mode saves.
  // Each item displays "Got paid? £{amount}" with Cash / Bank / Card chips.
  // Auto-dismisses after 5 s. Multiple Speed-mode saves stack — we show one at a
  // time and shift the queue when dismissed or a chip is tapped.
  const [gotPaidToastQueue, setGotPaidToastQueue] = useState([]);
  // rankVersion bumps after Mark paid / Snooze to force re-rank without a full re-fetch
  const [rankVersion, setRankVersion] = useState(0);
  // invoicePickerOpen: "Send an invoice" pivot button opened the job picker
  const [invoicePickerOpen, setInvoicePickerOpen] = useState(false);
  // markPaidPickerJob: which job's payment-method picker is open (null = closed)
  const [markPaidPickerJob, setMarkPaidPickerJob] = useState(null);
  // dismissedAcceptedIds: set of job IDs whose accepted banner the trader has dismissed
  // this session. Kept in component state so it is lost on reload — the real persistence
  // is acceptedSeenAt written to the jobMeta side-channel.
  const [dismissedAcceptedIds, setDismissedAcceptedIds] = useState(() => new Set());
  // payNowNudgeDismissed: session-level flag so the Pay-now soft prompt
  // (Section 1.3 c) doesn't re-appear if dismissed once during this session.
  const [payNowNudgeDismissed, setPayNowNudgeDismissed] = useState(false);
  // showPayNowNudge: set to true after a job is saved as completed when the trader
  // is not connected to Stripe. Cleared when dismissed or session ends.
  const [showPayNowNudge, setShowPayNowNudge] = useState(false);
  // upgradeSheetOpen: controls ProUpgradeSheet visibility on Today.
  const [upgradeSheetOpen, setUpgradeSheetOpen] = useState(false);

  const now = new Date();

  const showToast = (msg, action = null) => {
    setToast(msg);
    setToastAction(action);
    setTimeout(() => { setToast(''); setToastAction(null); }, 2400);
  };

  const handleJobSave = async (payload) => {
    setJobOpen(false);
    setJobOpenMode('normal');

    const isDraftQuote = payload?.quoteStatus === 'draft';
    const isFastPath   = payload?.via === 'fast';
    const isDetailedPath = payload?.via === 'details';

    if (isDraftQuote) {
      showToast('Quote saved as draft');
    } else if (isFastPath) {
      // Fast-save path: stay on Today, show "Saved · £380" toast with a View link.
      // The View link calls onJobTap which opens JobDetailDrawer on the Work tab.
      // Undo is deferred — there is no existing clean optimistic-delete path that is
      // safe to wire here under time pressure. See follow-up: feat/fast-save-undo.
      const amtLabel = payload?.amount != null ? ` · £${payload.amount}` : '';
      showToast(`Added to Leads${amtLabel}`, {
        label: 'View',
        onClick: () => onJobTap?.(payload),
      });

      // Speed-mode saves also enqueue the "Got paid?" chip toast (Part B).
      // The toast appears after the Saved toast clears (~2.4s). If multiple
      // Speed-mode saves happen quickly, they stack in FIFO order.
      if (payload?.speedMode) {
        const timerId = setTimeout(() => {
          setGotPaidToastQueue(q => {
            if (q.length === 0) return q;
            const [, ...rest] = q;
            return rest;
          });
        }, 5000);
        setGotPaidToastQueue(q => [...q, { job: payload, timerId }]);
      }
    } else if (isDetailedPath) {
      // Detailed-save path: navigate to the new job's detail view (Jobs tab, drawer open).
      // Optimistic — open immediately with the just-saved payload, don't wait on cloud.
      // JobDetailDrawer is where Send Invoice lives, so arriving there is a free get-paid assist.
      onJobTap?.(payload);
    } else {
      showToast('Job saved');
    }

    // Pay-now soft prompt (Section 1.3 c): surface when the trader saves a
    // completed job and hasn't connected to Stripe yet. Non-blocking, session only.
    const isConnected = profile?.stripe_connect_status === 'connected' && !!profile?.stripe_user_id;
    const isCompleted = payload?.status === 'completed' || payload?.status === 'active';
    if (!isConnected && isCompleted && !payNowNudgeDismissed && onNavigateToCardPayments) {
      setShowPayNowNudge(true);
    }

    try { await onAddJob?.(payload); } catch {
      // If the detailed-save path already navigated away, show the sync toast there.
      // For fast-save, replace the View toast with the sync message.
      if (!isDetailedPath) showToast('Saved offline — will sync');
    }
  };

  // "Save & send quote" — saves the job then opens ReviewSheet in quote mode.
  // Covers both the voice-confirm path (from details view) and the create-quote path.
  // onUpdateJob is used by ReviewSheet to persist quoteSentAt/quoteStatus/publicAccessToken
  // patches back to the cloud after the WhatsApp send.
  const handleSaveAndSend = async (payload) => {
    setJobOpen(false);
    setJobOpenMode('normal');
    try { await onAddJob?.(payload); } catch {}
    setReviewQuoteJob(payload);
  };

  // ── Ranking (re-runs on jobs or rankVersion change) ──────────────────────────
  // Delegates to the pure rankNextBestAction helper in src/lib/nextBestAction.js.
  // Real function refs are passed so the helper stays free of React imports.
  const { tier, job: promptJob, poolSize } = useMemo(() => {
    const snoozeStore = readSnoozeStore();
    return rankNextBestAction(
      jobs,
      new Date(),
      snoozeStore,
      isAwaitingPayment,
      daysPastDue,
      deriveStatus,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, rankVersion]);

  // ── Weekly momentum line (used in all-clear card + below pivot row) ───────────
  const { weekProfit, weekCount } = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 86400000;
    const weekJobs = jobs.filter(j => new Date(j.date || j.createdAt || 0).getTime() >= sevenDaysAgo && j.paid !== false);
    const weekReceipts = receipts.filter(r => new Date(r.date || r.createdAt || 0).getTime() >= sevenDaysAgo);
    const weekEarned = weekJobs.reduce((s, j) => s + Number(j.amount || 0), 0);
    const weekSpent = weekReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);
    return { weekProfit: weekEarned - weekSpent, weekCount: weekJobs.length };
  }, [jobs, receipts]);

  // ── Newly accepted quotes — unseen on this device (persistent banner) ──────────
  // Filtered to exclude any jobs the trader has already dismissed this session
  // (dismissedAcceptedIds is the in-memory fast-path; acceptedSeenAt is the durable path).
  const newlyAcceptedJobs = useMemo(() => {
    return getNewlyAcceptedJobs(jobs).filter(j => !dismissedAcceptedIds.has(j.id));
  }, [jobs, dismissedAcceptedIds]);

  // ── Unsent-invoice eligible jobs (for Send Invoice pivot picker) ──────────────
  const uninvoicedJobs = useMemo(() => {
    return jobs.filter(j => {
      const s = deriveStatus(j);
      return (s === 'completed' || s === 'active') && !j.invoiceSentAt;
    });
  }, [jobs]);

  // ── CTA handlers ──────────────────────────────────────────────────────────────

  const handlePrimaryCta = useCallback((ctaAction) => {
    if (!promptJob) return;

    if (ctaAction === 'whatsapp') {
      const phone = promptJob.customerPhone || promptJob.phone || '';
      const name = promptJob.customer || promptJob.customerName || '';
      const amount = gbp(jobAmount(promptJob));
      const jobSummary = promptJob.name || promptJob.summary || '';
      const dpd = daysPastDue(promptJob, new Date());
      const chaseTier = computeTier(promptJob, new Date());
      const bizName = profile?.business_name || '';
      const payDetails = buildPaymentDetails(profile?.bank_details ? { bankDetails: profile.bank_details } : {
        accountName: profile?.business_name,
        sortCode: profile?.sort_code,
        accountNumber: profile?.account_number,
      });
      const msg = buildChaseMessage({
        customerName: name,
        amount,
        jobSummary,
        daysOverdue: dpd,
        tier: chaseTier,
        paymentDetails: payDetails,
        businessName: bizName,
      });
      const clean = phone.replace(/\s/g, '').replace(/^0/, '44').replace(/^\+/, '');
      window.open(`https://wa.me/${clean}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      recordChase(promptJob.id);
      setRankVersion(v => v + 1);
      return;
    }

    if (ctaAction === 'email') {
      const email = promptJob.customerEmail || promptJob.email || '';
      const name = promptJob.customer || promptJob.customerName || promptJob.name || '';
      const amount = gbp(jobAmount(promptJob));
      const jobSummary = promptJob.name || promptJob.summary || '';
      const chaseTier = computeTier(promptJob, new Date());
      const dpd = daysPastDue(promptJob, new Date());
      const msg = buildChaseMessage({
        customerName: name,
        amount,
        jobSummary,
        daysOverdue: dpd,
        tier: chaseTier,
      });
      window.open(`mailto:${email}?subject=Invoice reminder&body=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      recordChase(promptJob.id);
      setRankVersion(v => v + 1);
      return;
    }

    if (ctaAction === 'open') {
      onJobTap?.(promptJob);
      return;
    }

    if (ctaAction === 'send_invoice') {
      // Tier 2: open JobDetailDrawer for this job (the drawer has the Send Invoice action)
      onJobTap?.(promptJob);
      return;
    }

    if (ctaAction === 'log_job') {
      setJobOpen(true);
    }
  }, [promptJob, profile, onJobTap]);

  const handleMarkPaid = useCallback((job, method) => {
    setMarkPaidPickerJob(null);
    onMarkPaid?.(job, method);
    showToast(`${gbp(jobAmount(job))} marked paid`);
    setRankVersion(v => v + 1);
  }, [onMarkPaid]);

  // Got Paid toast helpers (Speed mode, Part B)
  // Dismiss without setting payment — user can still set it via tile's + Add details.
  const dismissGotPaidToast = useCallback(() => {
    setGotPaidToastQueue(q => {
      if (q.length === 0) return q;
      const [head, ...rest] = q;
      clearTimeout(head.timerId);
      return rest;
    });
  }, []);

  // Tapping a chip on the Got Paid toast sets payment status immediately
  // then shifts the queue. Uses onMarkPaid which the parent already wires.
  const handleGotPaidChip = useCallback((job, method) => {
    dismissGotPaidToast();
    onMarkPaid?.(job, method);
    showToast(`${gbp(job.amount != null ? job.amount : 0)} marked paid`);
    setRankVersion(v => v + 1);
  }, [dismissGotPaidToast, onMarkPaid]);

  const handleSnooze = useCallback((job) => {
    snoozeJob(job.id);
    // Record the snooze in the jobMeta side-channel (localStorage).
    // Cloud sync is fire-and-forget — snooze is local-first UX.
    try {
      writeJobMeta(job.id, extractJobMeta({ ...job, snoozedUntil: new Date(Date.now() + SNOOZE_MS).toISOString() }));
    } catch {}
    showToast('Snoozed for 24 hours');
    setRankVersion(v => v + 1);
  }, []);

  const handleCardBodyTap = useCallback((job) => {
    if (job) onJobTap?.(job);
  }, [onJobTap]);

  // ── Accepted-quote banner handlers ────────────────────────────────────────────
  const handleAcceptedDismiss = useCallback((job) => {
    const seenAt = new Date().toISOString();
    writeJobMeta(job.id, extractJobMeta({ ...job, acceptedSeenAt: seenAt }));
    setDismissedAcceptedIds(prev => {
      const next = new Set(prev);
      next.add(job.id);
      return next;
    });
  }, []);

  const handleAcceptedTap = useCallback((job) => {
    handleAcceptedDismiss(job);
    if (job) onJobTap?.(job);
  }, [handleAcceptedDismiss, onJobTap]);

  // ── Send Invoice pivot: open picker or toast ──────────────────────────────────
  const handleSendInvoicePivot = () => {
    if (uninvoicedJobs.length === 0) {
      showToast('No jobs to invoice yet — finish a quote or log a job first.');
      return;
    }
    setInvoicePickerOpen(true);
  };

  // ── Prompt card rendering ──────────────────────────────────────────────────────
  const headline = tier < 5 && promptJob ? nbaHeadline(tier, promptJob) : null;
  const meta     = tier < 5 && promptJob ? nbaMeta(tier, promptJob, now)  : null;
  const cta      = tier < 5 && promptJob ? nbaCta(tier, promptJob, profile) : null;
  const label    = tier < 5 && promptJob ? nbaLabel(tier) : null;

  // Override meta.suffix for Tier 1 to include real days-past-due copy
  const resolvedMeta = useMemo(() => {
    if (tier !== 1 || !promptJob || !meta) return meta;
    const dpd = daysPastDue(promptJob, now);
    const overdueTxt = dpd === 0 ? 'due today' : dpd === 1 ? '1 day overdue' : `${dpd} days overdue`;
    return { ...meta, suffix: overdueTxt, negative: true };
  }, [tier, promptJob, meta, now]);

  return (
    <div className="today-screen foreman-screen">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="foreman-header">
        <img src="/jobprofit-logo.png" alt="" className="foreman-logo-mark" aria-hidden="true" />
        <h1 className="foreman-date">{formatToday()}</h1>
      </header>

      {/* ── Get Pro upsell pill (free users + active trials only) ──────── */}
      {!isPro(profile) && (
        <GetProPill
          profile={profile}
          onOpen={() => setUpgradeSheetOpen(true)}
        />
      )}

      {/* ── Accepted-quote banner (persistent until acknowledged) ─────────── */}
      {newlyAcceptedJobs.length > 0 && (
        <section className="accepted-banner" aria-label="Accepted quotes">
          {newlyAcceptedJobs.map((job) => (
            <div key={job.id} className="accepted-banner__row">
              <button
                type="button"
                className="accepted-banner__body"
                onClick={() => handleAcceptedTap(job)}
                aria-label={`${buildAcceptedLabel(job)} — tap to open job`}
              >
                <span className="accepted-banner__icon" aria-hidden="true">&#10003;</span>
                <span className="accepted-banner__text">
                  <span className="accepted-banner__label">{buildAcceptedLabel(job)}</span>
                  {job.acceptedAt && (
                    <span className="accepted-banner__date">{formatAcceptedDate(job.acceptedAt)}</span>
                  )}
                </span>
                <span className="accepted-banner__open" aria-hidden="true">&#8250;</span>
              </button>
              <button
                type="button"
                className="accepted-banner__dismiss"
                onClick={(e) => { e.stopPropagation(); handleAcceptedDismiss(job); }}
                aria-label="Dismiss notification"
              >
                Got it
              </button>
            </div>
          ))}
        </section>
      )}

      {/* ── One Prompt card (or all-clear) ────────────────────────────────── */}
      {tier < 5 && promptJob ? (
        <section
          className="foreman-prompt-card"
          role="button"
          tabIndex={0}
          aria-label={`${headline} — tap to open job`}
          onClick={(e) => {
            if (!e.target.closest('.foreman-cta-primary') &&
                !e.target.closest('.foreman-secondary-actions') &&
                !e.target.closest('.foreman-mark-paid-picker')) {
              handleCardBodyTap(promptJob);
            }
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCardBodyTap(promptJob); }}
        >
          <div className="foreman-tier-label">{label}</div>
          <div className="foreman-headline">{headline}</div>
          {resolvedMeta && (
            <div className={`foreman-meta ${resolvedMeta.negative ? 'foreman-meta--overdue' : ''}`}>
              {resolvedMeta.amount != null && (
                <span className={resolvedMeta.negative ? 'foreman-amount--overdue' : 'foreman-amount--neutral'}>
                  {gbp(resolvedMeta.amount)}
                </span>
              )}
              {resolvedMeta.amount != null && resolvedMeta.suffix && <span className="foreman-meta-sep"> — </span>}
              {resolvedMeta.suffix && <span>{resolvedMeta.suffix}</span>}
            </div>
          )}

          {/* Primary CTA */}
          {markPaidPickerJob?.id === promptJob.id ? (
            <div className="foreman-mark-paid-picker" onClick={e => e.stopPropagation()}>
              <div className="foreman-picker-label">How were you paid?</div>
              <div className="foreman-picker-grid">
                <button type="button" className="foreman-picker-btn" onClick={() => handleMarkPaid(promptJob, 'bank transfer')}>Bank</button>
                <button type="button" className="foreman-picker-btn" onClick={() => handleMarkPaid(promptJob, 'cash')}>Cash</button>
                <button type="button" className="foreman-picker-btn" onClick={() => handleMarkPaid(promptJob, 'card')}>Card</button>
              </div>
              <button type="button" className="foreman-picker-cancel" onClick={(e) => { e.stopPropagation(); setMarkPaidPickerJob(null); }}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="foreman-cta-primary"
                onClick={(e) => { e.stopPropagation(); handlePrimaryCta(cta.action); }}
              >
                {cta.label}
              </button>

              {/* Secondary actions */}
              <div
                className="foreman-secondary-actions"
                onClick={e => e.stopPropagation()}
              >
                {tier === 1 && (
                  <>
                    <button
                      type="button"
                      className="foreman-secondary-btn"
                      onClick={() => setMarkPaidPickerJob(promptJob)}
                    >
                      Mark paid
                    </button>
                    <span className="foreman-secondary-sep">·</span>
                    <button
                      type="button"
                      className="foreman-secondary-btn"
                      onClick={() => handleSnooze(promptJob)}
                    >
                      Snooze
                    </button>
                  </>
                )}
                {tier === 2 && (
                  <button
                    type="button"
                    className="foreman-secondary-btn"
                    onClick={() => handleCardBodyTap(promptJob)}
                  >
                    Open job
                  </button>
                )}
                {tier === 3 && (
                  <button
                    type="button"
                    className="foreman-secondary-btn"
                    onClick={() => handleCardBodyTap(promptJob)}
                  >
                    Open quote
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      ) : (
        /* ── All-clear state (slim, no duplicate Log a job) ─────────────── */
        <section className="foreman-empty-card foreman-empty-card--slim">
          <div className="foreman-empty-check" aria-hidden="true">&#10003;</div>
          <div className="foreman-empty-headline">
            <p>All clear.</p>
          </div>
          {weekCount > 0 ? (
            <p className="foreman-empty-meta">
              <span className="foreman-empty-meta__earned">{gbp(weekProfit)}</span> in the last 7 days
            </p>
          ) : (
            <p className="foreman-empty-meta">Nothing overdue. Nothing waiting.</p>
          )}
          <button
            type="button"
            className="foreman-empty-secondary"
            onClick={() => onNavigateToMoney?.()}
          >
            See the week
          </button>
        </section>
      )}

      {/* ── Pivot buttons (quick-action grid) ────────────────────────────── */}
      <div className="foreman-pivot-row foreman-pivot-row--three">
        <button
          type="button"
          className="foreman-pivot-btn"
          onClick={() => setJobOpen(true)}
        >
          <span className="foreman-pivot-icon" aria-hidden="true">
            {/* Hammer — PRD 2026-06-01 pick for Job CTA */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3l7 7-3 3-2-2-8 8a2 2 0 0 1-3-3l8-8-2-2 3-3z"/>
            </svg>
          </span>
          Job
        </button>
        <button
          type="button"
          className="foreman-pivot-btn"
          onClick={() => { setJobOpenMode('quote'); setJobOpen(true); }}
        >
          <span className="foreman-pivot-icon" aria-hidden="true">
            {/* Pen on paper — PRD 2026-06-01 pick for Quote CTA */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/>
              <path d="M14 4v5h5"/>
              <path d="M8.5 16.5l5-5 2 2-5 5H8.5v-2z"/>
            </svg>
          </span>
          Quote
        </button>
        <button
          type="button"
          className="foreman-pivot-btn"
          onClick={handleSendInvoicePivot}
        >
          <span className="foreman-pivot-icon" aria-hidden="true">
            {/* Paper plane — PRD 2026-06-01 pick for Invoice CTA */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 3L3 11l7 2 2 7 9-17z"/>
              <path d="M10 13l11-10"/>
            </svg>
          </span>
          Invoice
        </button>
      </div>

      {/* ── Weekly check-in line (shown when there's activity) ───────────── */}
      {weekCount > 0 && (
        <button
          type="button"
          className="foreman-week-line"
          onClick={() => onNavigateToMoney?.()}
        >
          This week: <span className="foreman-week-profit">{gbp(weekProfit)}</span> · {weekCount} job{weekCount === 1 ? '' : 's'}
        </button>
      )}

      {/* ── Send Invoice job picker (pivot fallback) ───────────────────────── */}
      {invoicePickerOpen && (
        <div
          className="foreman-invoice-picker-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Pick a job to invoice"
        >
          <div className="foreman-invoice-picker">
            <div className="foreman-invoice-picker-header">
              <h2 className="foreman-invoice-picker-title">Which job to invoice?</h2>
              <button
                type="button"
                className="foreman-invoice-picker-close"
                aria-label="Close"
                onClick={() => setInvoicePickerOpen(false)}
              >
                &#10005;
              </button>
            </div>
            <ul className="foreman-invoice-picker-list">
              {uninvoicedJobs.map(j => (
                <li key={j.id}>
                  <button
                    type="button"
                    className="foreman-invoice-picker-item"
                    onClick={() => { setInvoicePickerOpen(false); onJobTap?.(j); }}
                  >
                    <span className="foreman-invoice-picker-name">
                      {j.customer || j.customerName || j.name || 'Job'}
                    </span>
                    {jobAmount(j) > 0 && (
                      <span className="foreman-invoice-picker-amount">{gbp(jobAmount(j))}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {jobOpen && (
        <AddJobModal
          onClose={() => { setJobOpen(false); setJobOpenMode('normal'); }}
          onSave={handleJobSave}
          onOpenDetailed={onOpenDetailed}
          defaultMode={jobOpenMode === 'quote' ? 'quote' : undefined}
          onSaveAndSend={handleSaveAndSend}
          tradePrimary={profile?.trade_primary ?? null}
        />
      )}

      {reviewQuoteJob && (
        <ReviewSheet
          mode="quote"
          job={reviewQuoteJob}
          biz={{ name: profile?.business_name || '' }}
          jobs={jobs}
          onUpdate={(updatedJob) => { onUpdateJob?.(updatedJob); setReviewQuoteJob(null); }}
          onClose={() => setReviewQuoteJob(null)}
          onDismiss={() => setReviewQuoteJob(null)}
          flash={showToast}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <span className="toast-msg">{toast}</span>
          {toastAction && (
            <button
              type="button"
              className="toast-action"
              onClick={() => { setToast(''); setToastAction(null); toastAction.onClick(); }}
            >
              {toastAction.label}
            </button>
          )}
        </div>
      )}

      {/* Got Paid chip toast — Speed-mode post-save prompt (Part B).
          Shows the first item in the queue. Tapping a chip sets paymentType without
          reopening the modal. Tapping × dismisses and moves to next in queue. */}
      {gotPaidToastQueue.length > 0 && (() => {
        const { job } = gotPaidToastQueue[0];
        const amtLabel = job.amount != null ? ` £${job.amount}` : '';
        return (
          <div className="toast got-paid-toast" role="status" aria-live="polite">
            <span className="got-paid-toast__label">Got paid?{amtLabel}</span>
            <div className="got-paid-toast__chips">
              <button type="button" className="got-paid-toast__chip" onClick={() => handleGotPaidChip(job, 'cash')}>Cash</button>
              <button type="button" className="got-paid-toast__chip" onClick={() => handleGotPaidChip(job, 'bank transfer')}>Bank</button>
              <button type="button" className="got-paid-toast__chip" onClick={() => handleGotPaidChip(job, 'card')}>Card</button>
            </div>
            <button
              type="button"
              className="got-paid-toast__dismiss"
              aria-label="Dismiss"
              onClick={dismissGotPaidToast}
            >
              &times;
            </button>
          </div>
        );
      })()}

      {/* Pay-now soft prompt (Section 1.3 c) — shown after job completion when not connected.
          Not modal, not blocking. Dismissed for this session when trader taps the X. */}
      {showPayNowNudge && !payNowNudgeDismissed && (
        <div className="pay-now-nudge" role="status">
          <span className="pay-now-nudge__copy">
            Pay-now button available{' '}
            <button
              type="button"
              className="pay-now-nudge__setup"
              onClick={() => {
                setShowPayNowNudge(false);
                setPayNowNudgeDismissed(true);
                onNavigateToCardPayments?.();
              }}
            >
              Set up
            </button>
          </span>
          <button
            type="button"
            className="pay-now-nudge__dismiss"
            aria-label="Dismiss"
            onClick={() => {
              setShowPayNowNudge(false);
              setPayNowNudgeDismissed(true);
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* ── ProUpgradeSheet — opened by GetProPill on Today ──────────────── */}
      <ProUpgradeSheet
        open={upgradeSheetOpen}
        source="today_pill"
        onClose={() => setUpgradeSheetOpen(false)}
      />
    </div>
  );
}
