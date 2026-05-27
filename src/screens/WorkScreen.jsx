/**
 * WorkScreen — Jobs tab in slice-3 nav.
 *
 * Merges Job list and calendar into one tab with a segmented control at the top.
 * Last-used subview persists in localStorage under 'jp.workView'.
 *
 * Props mirror what AppShell was passing to JobsScreen + ScheduleScreen.
 *
 * Phase 1 pipeline redesign (ported from JobsScreen.jsx — PR #59):
 *  - Status chips: All · Quoted · On · Invoiced · Paid  (Done removed, Active → On)
 *  - Default tab: On
 *  - Money-at-risk strip: always rendered above segmented control
 *  - Per-card dual CTAs driven by current status
 *  - Invoiced cards: Mark paid is PRIMARY (real write), Send reminder is secondary
 *
 * Note: JobsScreen.jsx still exists but is never rendered — AppShell line 105 routes
 * 'jobs' → 'work' → WorkScreen. JobsScreen.jsx cleanup is tracked as a follow-up PR.
 */
import { useState, useCallback } from 'react';
import WorkCalendar from './WorkCalendar';
import JobDetailDrawer from '../components/JobDetailDrawer';
import SendInvoiceModal from '../components/SendInvoiceModal';
import { logTelemetry } from '../lib/telemetry';

const STORAGE_KEY = 'jp.workView';

function getPersistedView() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'calendar') return 'calendar';
  } catch {
    // localStorage unavailable — default to list
  }
  return 'list';
}

function persistView(v) {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    // ignore
  }
}

// ── Status helpers ────────────────────────────────────────────────────────────

// Phase 1 chip set. "Done" removed; "Active" → "On".
const STATUS_FILTERS = ['All', 'Quoted', 'On', 'Invoiced', 'Paid'];

/**
 * Map the various status fields used across the app to one of the four
 * Phase 1 display statuses: Quoted | On | Invoiced | Paid.
 *
 *  - 'Active' removed as a display label; active/jobStatus=active → 'On'
 *  - 'Done' removed; complete-but-not-invoiced → 'On' (work is finishing, loop not closed)
 *
 * Mirrors JobDetailDrawer's own deriveDisplayStatus for On/Invoiced/Paid.
 * If you change this, change it there too (tracked: src/components/JobDetailDrawer.jsx ~L75).
 */
function deriveDisplayStatus(job) {
  if (job.paid || job.paymentStatus === 'paid' || job.jobStatus === 'paid') return 'Paid';
  if (job.invoiceStatus === 'invoiced' || job.status === 'invoice_sent') return 'Invoiced';
  // complete-but-not-invoiced → 'On': work is done but the loop hasn't closed (invoice not sent yet)
  if (job.jobStatus === 'complete' || job.status === 'complete') return 'On';
  if (job.jobStatus === 'active' || job.status === 'active') return 'On';
  return 'Quoted';
}

/** Format a number as en-GB integer string (no pence). */
function formatAmount(val) {
  return (Number(val ?? 0) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0 });
}

/**
 * Calculate the three money-at-risk figures for the strip.
 *
 * - quoted:   total value of jobs in Quoted stage
 * - invoiced: total value of jobs in Invoiced stage
 * - overdue:  subset of invoiced where invoiceDueDate is past today
 *
 * Phase 2 will replace the overdue calc with a server-side aggregate once
 * invoice_sent_at + payment_terms_days are on the jobs schema.
 */
function calcRiskFigures(jobs) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let quoted = 0;
  let invoiced = 0;
  let overdue = 0;
  const overdueJobs = [];

  for (const j of jobs) {
    const status = deriveDisplayStatus(j);
    const val = Number(j.total ?? j.amount ?? 0) || 0;

    if (status === 'Quoted') {
      quoted += val;
    } else if (status === 'Invoiced') {
      invoiced += val;
      if (j.invoiceDueDate) {
        const due = new Date(j.invoiceDueDate);
        due.setHours(0, 0, 0, 0);
        if (due < today) {
          overdue += val;
          overdueJobs.push(j);
        }
      }
    }
  }

  // Sort oldest due-date first (oldest = most urgent to chase)
  overdueJobs.sort((a, b) => new Date(a.invoiceDueDate) - new Date(b.invoiceDueDate));

  return { quoted, invoiced, overdue, overdueJobs };
}

/**
 * Returns { primary, secondary, primaryMod } CTA config per pipeline stage.
 *
 * Invoiced stage CTA hierarchy correction vs JobsScreen.jsx:
 *   Mark paid is PRIMARY (real write, highest-value action gets prominence).
 *   Send reminder is secondary. This is the deliberate fix over the Phase 1 draft.
 *
 * Placeholder TODO notes (actions not yet fully wired):
 *
 * "Mark accepted" — TODO: wire to Quote→Job auto-conversion (separate PR).
 *   Currently a no-op; founder can open the job from the drawer to update manually.
 *
 * "Nudge customer" — wired to WhatsApp share-sheet with a quote-chaser message.
 *   TODO: swap generic message for the actual quote link once quoteMessage.js is surfaced here.
 *
 * "Log time" — TODO: open JobDetailDrawer on the time tab directly.
 *   No-op for now; tap the job card to open the drawer and log time from there.
 *
 * "Mark complete" — TODO: write status = 'complete' via jobMeta + prompt to send invoice.
 *   No-op for now; tap the job card to open the drawer and mark complete from there.
 *
 * "Send reminder" — wired to WhatsApp share-sheet with a payment-reminder message.
 *   TODO: swap for pre-built invoiceMessage template when that function is surfaced here.
 *
 * "Mark paid" — wired to onUpdateJob. Merges paid=true into the job record and writes
 *   to localStorage + cloud via AppShell's onUpdateJob handler.
 *
 * "View summary" — TODO: open JobDetailDrawer on the summary tab.
 *   No-op for now; tap the job card to open the drawer.
 */
function getStageCTAs(status, job, { onSendInvoice, onUpdateJob }) {
  switch (status) {
    case 'Quoted':
      return {
        // TODO: Mark accepted → Quote→Job conversion (separate PR)
        primary: { label: 'Mark accepted', action: () => {} },
        secondary: {
          label: 'Nudge customer',
          action: () => {
            const customer = job.customer || job.name || 'your customer';
            const amount = '£' + formatAmount(job.total ?? job.amount);
            const msg = encodeURIComponent(
              `Hi ${customer}, just checking you received the quote for ${amount}. Happy to answer any questions.`
            );
            window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener');
          },
        },
      };

    case 'On':
      return {
        // TODO: Log time → open JobDetailDrawer on time tab
        primary: { label: 'Log time', action: () => {} },
        // TODO: Mark complete → jobMeta write + invoice prompt (separate PR)
        secondary: { label: 'Mark complete', action: () => {} },
      };

    case 'Invoiced':
      // CTA hierarchy: Mark paid is PRIMARY — the real write gets primary prominence.
      // Send reminder is secondary. This corrects the draft order in JobsScreen.jsx.
      return {
        primary: {
          label: 'Mark paid',
          action: () => {
            if (!onUpdateJob) return;
            onUpdateJob({ ...job, paid: true, paymentStatus: 'paid', paidAt: new Date().toISOString() });
          },
        },
        secondary: {
          label: 'Send reminder',
          action: () => {
            const customer = job.customer || job.name || 'your customer';
            const amount = '£' + formatAmount(job.total ?? job.amount);
            const msg = encodeURIComponent(
              `Hi ${customer}, just a friendly reminder that your invoice for ${amount} is due. Please let me know when payment is on the way. Thanks.`
            );
            window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener');
          },
        },
      };

    case 'Paid':
      return {
        // TODO: View summary → open JobDetailDrawer on summary tab
        primary: { label: 'View summary', action: () => {} },
        secondary: null,
      };

    default:
      return { primary: null, secondary: null };
  }
}

// ── JobCard (inline) ──────────────────────────────────────────────────────────

function JobCard({ job, onSelect, onSendInvoice, onUpdateJob }) {
  const status = deriveDisplayStatus(job);
  const statusClass = {
    Quoted:   'status--quoted',
    On:       'status--active',   // reuses green pill — "On" is the new "Active"
    Invoiced: 'status--invoiced',
    Paid:     'status--paid',
  }[status] || 'status--quoted';

  const ctas = getStageCTAs(status, job, { onSendInvoice, onUpdateJob });

  return (
    <li
      className="job-card job-card--tappable"
      onClick={() => onSelect?.(job)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(job); }}
      aria-label={`View details for ${job.customer || job.name || 'Unnamed job'}`}
    >
      <div className="job-card-top">
        <span className={`job-status-pill ${statusClass}`}>{status[0]}</span>
        <span className="job-card-customer">{job.customer || job.name || 'Unnamed job'}</span>
      </div>
      {job.summary && (
        <div className="job-card-summary">
          {job.summary.slice(0, 60)}{job.summary.length > 60 ? '…' : ''}
        </div>
      )}
      <div className="job-card-footer">
        <span className="job-card-amount">
          {typeof (job.total ?? job.amount) === 'number'
            ? '£' + Number(job.total ?? job.amount).toLocaleString('en-GB', { minimumFractionDigits: 0 })
            : ''}
        </span>
      </div>
      {/* Dual CTAs — primary + optional secondary. stopPropagation so taps don't bubble. */}
      {(ctas.primary || ctas.secondary) && (
        <div className="job-card-ctas" onClick={e => e.stopPropagation()}>
          {ctas.primary && (
            <button
              type="button"
              className={`job-card-cta job-card-cta--primary${ctas.primaryMod ? ` job-card-cta--${ctas.primaryMod}` : ''}`}
              onClick={ctas.primary.action}
            >
              {ctas.primary.label}
            </button>
          )}
          {ctas.secondary && (
            <button
              type="button"
              className="job-card-cta job-card-cta--secondary"
              onClick={ctas.secondary.action}
            >
              {ctas.secondary.label}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// ── Empty state copy per chip (plain trade English) ───────────────────────────

function EmptyState({ filter }) {
  const copy = {
    All:      { title: 'No jobs yet', hint: 'Tap + New job to log your first job.' },
    Quoted:   { title: 'No quotes out', hint: 'Send a quote and it will appear here.' },
    On:       { title: 'Nothing on the tools', hint: 'Accept a quote or tap + New job to start a job.' },
    Invoiced: { title: 'No invoices waiting', hint: 'Mark a job complete and send the invoice.' },
    Paid:     { title: 'No paid jobs yet', hint: 'Paid jobs show here once the money lands.' },
  };
  const { title, hint } = copy[filter] ?? copy.All;
  return (
    <div className="screen-empty">
      <p className="screen-empty-title">{title}</p>
      <p className="screen-empty-hint">{hint}</p>
    </div>
  );
}

// ── JobsList subview ──────────────────────────────────────────────────────────

function JobsList({ jobs, onJobSelect, onSendInvoice, onUpdateJob }) {
  // Default: "On" — surfaces active work immediately on app open.
  const [filter, setFilter] = useState('On');

  const filtered = jobs.filter(j => {
    if (filter === 'All') return true;
    return deriveDisplayStatus(j) === filter;
  });

  return (
    <>
      {/* Status filter chips */}
      <div className="filter-chips" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map(f => (
          <button
            key={f}
            className={`filter-chip ${filter === f ? 'filter-chip--active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f}
            {f !== 'All' && (
              <span className="filter-chip-count">
                {jobs.filter(j => deriveDisplayStatus(j) === f).length || ''}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Job list */}
      {filtered.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <ul className="job-list">
          {filtered.map(j => (
            <JobCard
              key={j.id || j.cloudId}
              job={j}
              onSelect={onJobSelect}
              onSendInvoice={onSendInvoice}
              onUpdateJob={onUpdateJob}
            />
          ))}
        </ul>
      )}
    </>
  );
}

// ── WorkScreen (root) ─────────────────────────────────────────────────────────

export default function WorkScreen({ jobs = [], receipts = [], onNewJob, onAddPayment, onUpdateJob, onAddReceipt, onDeleteReceipt, biz, profile }) {
  const [subview, setSubview] = useState(getPersistedView);
  // selectedJob drives the JobDetailDrawer — null means closed.
  const [selectedJob, setSelectedJob] = useState(null);
  // invoiceJob drives the inline SendInvoiceModal from the "Send invoice" card CTA.
  const [invoiceJob, setInvoiceJob] = useState(null);
  const [invoiceToast, setInvoiceToast] = useState('');

  const switchSubview = useCallback((v) => {
    logTelemetry('work_subview', { subview: v });
    setSubview(v);
    persistView(v);
  }, []);

  // Keep the drawer's job in sync when AppShell refreshes jobs[] after a payment.
  // Without this the drawer would show stale balance/payments after adding a payment.
  const liveSelectedJob = selectedJob
    ? (jobs.find(j => j.id === selectedJob.id) ?? selectedJob)
    : null;

  const handleAddPayment = (job, payload) => {
    onAddPayment?.(job, payload);
    // liveSelectedJob will update automatically on next render as jobs[] refreshes.
  };

  const showInvoiceToast = (msg) => {
    setInvoiceToast(msg);
    setTimeout(() => setInvoiceToast(''), 2400);
  };

  // Money-at-risk strip figures — rendered above segmented control so visible on both subviews.
  const riskFigures = calcRiskFigures(jobs);
  const oldestOverdue = riskFigures.overdueJobs[0] ?? null;

  const handleChase = () => {
    if (!oldestOverdue) return;
    const customer = oldestOverdue.customer || oldestOverdue.name || 'your customer';
    const amount = '£' + formatAmount(oldestOverdue.total ?? oldestOverdue.amount);
    const msg = encodeURIComponent(
      `Hi ${customer}, just a reminder that your invoice for ${amount} is overdue. Please let me know when payment is on the way. Thanks.`
    );
    // WhatsApp universal share-sheet (no phone number = user picks the contact)
    window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener');
  };

  return (
    <div className="screen work-screen">
      {/* Header */}
      <div className="screen-header">
        <h1 className="screen-title">Jobs</h1>
        <div className="screen-header-right">
          <button className="new-btn" onClick={onNewJob}>+ New job</button>
        </div>
      </div>

      {/* Money-at-risk strip — always rendered; above segmented control so visible on both subviews */}
      <div className="risk-strip">
        <div className="risk-strip-figures">
          <span className="risk-strip-figure">
            <span className="risk-strip-value">£{formatAmount(riskFigures.quoted)}</span>
            <span className="risk-strip-label"> quoted out</span>
          </span>
          <span className="risk-strip-sep">·</span>
          <span className="risk-strip-figure">
            <span className="risk-strip-value">£{formatAmount(riskFigures.invoiced)}</span>
            <span className="risk-strip-label"> invoiced</span>
          </span>
          <span className="risk-strip-sep">·</span>
          <span className={`risk-strip-figure${riskFigures.overdue > 0 ? ' risk-strip-figure--overdue' : ''}`}>
            <span className="risk-strip-value">£{formatAmount(riskFigures.overdue)}</span>
            <span className="risk-strip-label"> overdue</span>
          </span>
        </div>
        {riskFigures.overdue > 0 && oldestOverdue && (
          <div className="risk-strip-chase-row">
            <span className="risk-strip-chase-hint">
              {oldestOverdue.customer || oldestOverdue.name || 'Invoice'} · overdue
            </span>
            <button className="risk-strip-chase-btn" onClick={handleChase} type="button">
              Chase
            </button>
          </div>
        )}
      </div>

      {/* Segmented control */}
      <div className="work-segments" role="group" aria-label="Switch between list and calendar view">
        <button
          className={`work-segment ${subview === 'list' ? 'work-segment--active' : ''}`}
          onClick={() => switchSubview('list')}
          aria-pressed={subview === 'list'}
        >
          List
        </button>
        <button
          className={`work-segment ${subview === 'calendar' ? 'work-segment--active' : ''}`}
          onClick={() => switchSubview('calendar')}
          aria-pressed={subview === 'calendar'}
        >
          Calendar
        </button>
      </div>

      {/* Subview */}
      {subview === 'list' ? (
        <JobsList
          jobs={jobs}
          onJobSelect={setSelectedJob}
          onSendInvoice={setInvoiceJob}
          onUpdateJob={onUpdateJob}
        />
      ) : (
        <WorkCalendar jobs={jobs} onNewJobOnDate={onNewJob} />
      )}

      {/* Job detail drawer — renders on top when a job is selected */}
      {liveSelectedJob && (
        <JobDetailDrawer
          job={liveSelectedJob}
          receipts={receipts}
          biz={biz}
          profile={profile}
          jobs={jobs}
          onUpdateJob={onUpdateJob}
          onAddReceipt={onAddReceipt}
          onDeleteReceipt={onDeleteReceipt}
          onAddPayment={handleAddPayment}
          onClose={() => setSelectedJob(null)}
        />
      )}

      {/* Inline SendInvoiceModal — opened by the "Send invoice" primary CTA on Invoiced cards */}
      {invoiceJob && (
        <SendInvoiceModal
          job={invoiceJob}
          biz={biz ?? {}}
          profile={profile ?? null}
          jobs={jobs}
          onUpdate={onUpdateJob ?? (() => {})}
          onClose={() => setInvoiceJob(null)}
          flash={showInvoiceToast}
        />
      )}

      {invoiceToast && <div className="toast">{invoiceToast}</div>}
    </div>
  );
}
