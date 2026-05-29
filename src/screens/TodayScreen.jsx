/**
 * TodayScreen — "The Foreman" (PRD 2026-05-30)
 *
 * One screen, one prompt. Ranking algorithm (deterministic, top-wins):
 *   Tier 1 — Overdue chase (invoice sent, due_date < today, unpaid, not snoozed)
 *   Tier 2 — Unsent invoice (job complete, no invoice sent, completed >48h ago)
 *   Tier 3 — Unlogged job (scheduledDate = today, status lead/draft)
 *   Tier 4 — Unconverted quote — SKIPPED until quote→job flow ships
 *   Tier 5 — Empty state
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
import { gbp, todayKey, formatToday } from '../lib/today';
import { isAwaitingPayment, deriveStatus } from '../lib/jobStatus';
import { daysPastDue, getChaseState, recordChase, buildChaseMessage, computeTier, buildPaymentDetails } from '../lib/chaseLadder';
import { writeJobMeta, extractJobMeta } from '../lib/jobMeta';

// ── Snooze storage (localStorage, 24h per tap) ────────────────────────────────
const SNOOZE_KEY = 'jobprofit:snooze:v1';
const SNOOZE_MS = 24 * 60 * 60 * 1000;

function readSnoozeStore() {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}'); } catch { return {}; }
}
function writeSnoozeStore(s) {
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(s)); } catch {}
}
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

// ── Ranking helpers ───────────────────────────────────────────────────────────

function jobAmount(job) {
  return Number(job?.total ?? job?.amount ?? 0);
}

function jobDateStr(job) {
  return job?.invoiceSentAt || job?.completedAt || job?.date || job?.createdAt || '';
}

/**
 * Tie-break comparator within the same tier.
 * Sort: largest amount first, then oldest date, then lowest ID (string sort).
 */
function tierTieBreak(a, b) {
  const amtDiff = jobAmount(b) - jobAmount(a);
  if (amtDiff !== 0) return amtDiff;
  const dateA = jobDateStr(a) || '';
  const dateB = jobDateStr(b) || '';
  if (dateA < dateB) return -1;
  if (dateA > dateB) return 1;
  return String(a.id) < String(b.id) ? -1 : 1;
}

/**
 * Determines which tier a job qualifies for.
 * Returns 1–3 or 0 (does not qualify for any active tier).
 */
function qualifyingTier(job, todayStr, now) {
  const status = deriveStatus(job);

  // Tier 1: invoice sent, past due date, unpaid, not snoozed
  if (isAwaitingPayment(job) && !isJobSnoozed(job.id, now)) {
    const dpd = daysPastDue(job, now);
    if (dpd >= 0) return 1;
  }

  // Tier 2: job complete, no invoice sent, completed >48h ago
  if ((status === 'completed' || status === 'active') && !job.invoiceSentAt) {
    const completedAt = job.completedAt || job.date || job.createdAt;
    if (completedAt) {
      const ageMs = now - new Date(completedAt);
      if (ageMs > 48 * 60 * 60 * 1000) return 2;
    }
  }

  // Tier 3: scheduled today, not yet started (lead/draft)
  if (job.scheduledDate && job.scheduledDate.slice(0, 10) === todayStr) {
    if (status === 'draft' || status === 'lead') return 3;
  }

  // Tier 4: unconverted quote — skipped until quote→job flow ships

  return 0;
}

/**
 * Runs the ranking algorithm over all jobs.
 * Returns { tier, job } for the winning prompt, or { tier: 5, job: null } for empty state.
 */
function rankJobs(jobs, now = new Date()) {
  const todayStr = todayKey(now);
  const byTier = { 1: [], 2: [], 3: [] };

  for (const job of jobs) {
    // Guard: if the job no longer exists in the array, skip (handles delete-between-rank)
    if (!job?.id) continue;
    const t = qualifyingTier(job, todayStr, now);
    if (t >= 1 && t <= 3) byTier[t].push(job);
  }

  for (let t = 1; t <= 3; t++) {
    const pool = byTier[t];
    if (pool.length === 0) continue;
    // Cap Tier 1 at top-1 (largest £ wins) — PRD edge case: 50+ overdue chases
    const winner = pool.slice().sort(tierTieBreak)[0];
    return { tier: t, job: winner, poolSize: pool.length };
  }

  return { tier: 5, job: null, poolSize: 0 };
}

// ── Tier metadata ──────────────────────────────────────────────────────────────

function tierLabel(tier) {
  if (tier === 1) return 'CHASE';
  if (tier === 2) return 'INVOICE';
  if (tier === 3) return 'LOG';
  return '';
}

/**
 * Builds the headline copy for the prompt card.
 * Returns a short imperative string — "Chase Sanji." / "Invoice Wilson." / "Log today's job."
 */
function buildHeadline(tier, job) {
  const name = job?.customer || job?.customerName || job?.name || 'this job';
  const firstName = name.split(' ')[0];
  if (tier === 1) return `Chase ${firstName}.`;
  if (tier === 2) return `Invoice ${firstName}.`;
  if (tier === 3) return `Log today's job.`;
  return '';
}

/**
 * Builds the meta line below the headline (amount + context).
 */
function buildMeta(tier, job, now) {
  const amount = jobAmount(job);
  if (tier === 1) {
    const dpd = daysPastDue(job, now);
    const overdueTxt = dpd === 0 ? 'due today' : dpd === 1 ? '1 day overdue' : `${dpd} days overdue`;
    return { amount, suffix: overdueTxt, negative: dpd >= 0 };
  }
  if (tier === 2) {
    const completedAt = job.completedAt || job.date || job.createdAt;
    const hoursAgo = completedAt ? Math.floor((now - new Date(completedAt)) / 3600000) : null;
    const suffix = hoursAgo != null
      ? hoursAgo < 48 ? 'completed recently' : `done ${Math.floor(hoursAgo / 24)}d ago`
      : 'job complete';
    return { amount, suffix, negative: false };
  }
  if (tier === 3) {
    return { amount: amount || null, suffix: 'scheduled today', negative: false };
  }
  return { amount: null, suffix: '', negative: false };
}

/**
 * Builds the primary CTA label and action type for a given tier + job.
 * Also handles PRD edge case 4: no phone but has email → Chase by email.
 * No phone AND no email → Open job.
 */
function buildCta(tier, job, profile) {
  if (tier === 1) {
    const phone = job?.customerPhone || job?.phone || '';
    const email = job?.customerEmail || job?.email || '';
    if (phone) return { label: 'Chase on WhatsApp', action: 'whatsapp' };
    if (email) return { label: 'Chase by email', action: 'email' };
    return { label: 'Open job', action: 'open' };
  }
  if (tier === 2) return { label: 'Send invoice', action: 'send_invoice' };
  if (tier === 3) return { label: 'Log it', action: 'log_job' };
  return { label: 'Log a job', action: 'log_job' };
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TodayScreen({
  jobs = [],
  receipts = [],
  onAddJob,
  onOpenDetailed,
  onMarkPaid,
  onJobTap,
  onNavigateToMoney,
  profile,
}) {
  const [jobOpen, setJobOpen] = useState(false);
  const [toast, setToast] = useState('');
  // rankVersion bumps after Mark paid / Snooze to force re-rank without a full re-fetch
  const [rankVersion, setRankVersion] = useState(0);
  // invoicePickerOpen: "Send an invoice" pivot button opened the job picker
  const [invoicePickerOpen, setInvoicePickerOpen] = useState(false);
  // markPaidPickerJob: which job's payment-method picker is open (null = closed)
  const [markPaidPickerJob, setMarkPaidPickerJob] = useState(null);

  const now = new Date();

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2400);
  };

  const handleJobSave = async (payload) => {
    setJobOpen(false);
    showToast('Job saved');
    try { await onAddJob?.(payload); } catch { showToast('Saved offline — will sync'); }
  };

  // ── Ranking (re-runs on jobs or rankVersion change) ──────────────────────────
  const { tier, job: promptJob, poolSize } = useMemo(
    () => rankJobs(jobs, new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs, rankVersion]
  );

  // ── Weekly check-in line ──────────────────────────────────────────────────────
  const { weekProfit, weekCount } = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 86400000;
    const weekJobs = jobs.filter(j => new Date(j.date || j.createdAt || 0).getTime() >= sevenDaysAgo && j.paid !== false);
    const weekReceipts = receipts.filter(r => new Date(r.date || r.createdAt || 0).getTime() >= sevenDaysAgo);
    const weekEarned = weekJobs.reduce((s, j) => s + Number(j.amount || 0), 0);
    const weekSpent = weekReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);
    return { weekProfit: weekEarned - weekSpent, weekCount: weekJobs.length };
  }, [jobs, receipts]);

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
      const tier = computeTier(promptJob, new Date());
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
        tier,
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
      const tier = computeTier(promptJob, new Date());
      const dpd = daysPastDue(promptJob, new Date());
      const msg = buildChaseMessage({
        customerName: name,
        amount,
        jobSummary,
        daysOverdue: dpd,
        tier,
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
      // Tier 2: open JobDetailDrawer for this job (the drawer already has the Send Invoice action)
      onJobTap?.(promptJob);
      return;
    }

    if (ctaAction === 'log_job') {
      setJobOpen(true);
    }
  }, [promptJob, profile, onJobTap]);

  const handleMarkPaid = useCallback((job, method) => {
    setMarkPaidPickerJob(null);
    // Pass original job + method to AppShell's onMarkPaidFromToday, which builds the update
    onMarkPaid?.(job, method);
    showToast(`${gbp(jobAmount(job))} marked paid`);
    setRankVersion(v => v + 1);
  }, [onMarkPaid]);

  const handleSnooze = useCallback((job) => {
    snoozeJob(job.id);
    // Record the snooze in the jobMeta side-channel (localStorage).
    // Cloud sync is handled by AppShell's onUpdateJob — not wired here because
    // Snooze is a local-first UX (re-rank is instant, cloud is fire-and-forget).
    // A follow-up can expose onUpdateJob via props to sync snooze state.
    try {
      writeJobMeta(job.id, extractJobMeta({ ...job, snoozedUntil: new Date(Date.now() + SNOOZE_MS).toISOString() }));
    } catch {}
    showToast('Snoozed for 24 hours');
    setRankVersion(v => v + 1);
  }, []);

  const handleCardBodyTap = useCallback((job) => {
    // Tapping the card body (not a CTA button) opens the underlying record
    if (job) onJobTap?.(job);
  }, [onJobTap]);

  // ── Send Invoice pivot: open picker or toast ──────────────────────────────────
  const handleSendInvoicePivot = () => {
    if (uninvoicedJobs.length === 0) {
      showToast('Mark a job complete first, then invoice it.');
      return;
    }
    setInvoicePickerOpen(true);
  };

  // ── Prompt card rendering ──────────────────────────────────────────────────────
  const headline = tier < 5 && promptJob ? buildHeadline(tier, promptJob) : null;
  const meta = tier < 5 && promptJob ? buildMeta(tier, promptJob, now) : null;
  const cta = tier < 5 && promptJob ? buildCta(tier, promptJob, profile) : null;

  return (
    <div className="today-screen foreman-screen">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="foreman-header">
        <h1 className="foreman-date">{formatToday()}</h1>
      </header>

      <div className="foreman-divider" />

      {/* ── One Prompt card (or empty state) ──────────────────────────────── */}
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
          <div className="foreman-tier-label">{tierLabel(tier)}</div>
          <div className="foreman-headline">{headline}</div>
          {meta && (
            <div className={`foreman-meta ${meta.negative ? 'foreman-meta--overdue' : ''}`}>
              {meta.amount != null && (
                <span className={meta.negative ? 'foreman-amount--overdue' : 'foreman-amount--neutral'}>
                  {gbp(meta.amount)}
                </span>
              )}
              {meta.amount != null && meta.suffix && <span className="foreman-meta-sep"> — </span>}
              {meta.suffix && <span>{meta.suffix}</span>}
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
                    View job
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      ) : (
        /* ── Empty state ────────────────────────────────────────────────── */
        <section className="foreman-empty-card">
          <div className="foreman-empty-check" aria-hidden="true">✓</div>
          <div className="foreman-empty-headline">
            <p>All clear.</p>
            <p>Nice one.</p>
          </div>
          <p className="foreman-empty-meta">Nothing overdue. Nothing waiting.</p>
          <button
            type="button"
            className="foreman-cta-primary"
            onClick={() => setJobOpen(true)}
          >
            Log a job
          </button>
          <button
            type="button"
            className="foreman-empty-secondary"
            onClick={() => onNavigateToMoney?.()}
          >
            See the week
          </button>
        </section>
      )}

      {/* ── Pivot buttons ─────────────────────────────────────────────────── */}
      <div className="foreman-pivot-row">
        <button
          type="button"
          className="foreman-pivot-btn"
          onClick={() => setJobOpen(true)}
        >
          <span className="foreman-pivot-icon" aria-hidden="true">+</span>
          Log a job
        </button>
        <button
          type="button"
          className="foreman-pivot-btn"
          onClick={handleSendInvoicePivot}
        >
          <span className="foreman-pivot-icon" aria-hidden="true">+</span>
          Send an invoice
        </button>
      </div>

      {/* ── Weekly check-in line ──────────────────────────────────────────── */}
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
                ✕
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
          onClose={() => setJobOpen(false)}
          onSave={handleJobSave}
          onOpenDetailed={onOpenDetailed}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
