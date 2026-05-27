/**
 * JobsScreen — Tab 2 in the new nav.
 * Phase 1 pipeline redesign (polish/jobs-pipeline-first-pass):
 *  - Status chips: All · Quoted · On · Invoiced · Paid  (Done removed, Active → On)
 *  - Default tab: On
 *  - Money-at-risk strip: always rendered; Chase button shown when overdue > 0
 *  - Per-card dual CTAs driven by existing status field
 *
 * Phase 2 (deferred, needs schema / separate PRs):
 *  - Lead chip + lead-capture form
 *  - Overdue chip (derived from invoice_sent_at + payment_terms_days)
 *  - "Mark accepted" → Quote→Job auto-conversion
 *  - "Mark complete" → write status via jobMeta + send-invoice prompt
 *  - "Log time" / "View summary" → open JobDetailDrawer from JobsScreen (drawer not yet mounted here)
 */
import { useState } from 'react';
import HeaderAvatar from '../components/HeaderAvatar';
import SendInvoiceModal from '../components/SendInvoiceModal';

// Phase 1 chip set. "Done" removed; "Active" → "On".
const STATUS_FILTERS = ['All', 'Quoted', 'On', 'Invoiced', 'Paid'];

export default function JobsScreen({ jobs = [], session, profile, onAvatarClick, onNewJob, onUpdateJob }) {
  // Default: "On" — surfaces active work immediately on app open.
  const [filter, setFilter] = useState('On');
  const [invoiceJob, setInvoiceJob] = useState(null);
  const [invoiceToast, setInvoiceToast] = useState('');

  const filtered = jobs.filter(j => {
    if (filter === 'All') return true;
    return deriveDisplayStatus(j) === filter;
  });

  const showInvoiceToast = (msg) => {
    setInvoiceToast(msg);
    setTimeout(() => setInvoiceToast(''), 2400);
  };

  // Money-at-risk strip figures
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
    <div className="screen jobs-screen">
      <div className="screen-header">
        <h1 className="screen-title">Jobs</h1>
        <div className="screen-header-right">
          <button className="new-btn" onClick={onNewJob}>+ New</button>
          <HeaderAvatar session={session} profile={profile} onClick={onAvatarClick} />
        </div>
      </div>

      {/* Money-at-risk strip — always rendered (Phase 1 spec) */}
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
              onSendInvoice={setInvoiceJob}
              onUpdateJob={onUpdateJob}
            />
          ))}
        </ul>
      )}

      {/* Inline SendInvoiceModal — opened by the "Send invoice" primary CTA on Invoiced cards */}
      {invoiceJob && (
        <SendInvoiceModal
          job={invoiceJob}
          biz={{}}
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

// --- Empty state copy per chip (plain trade English) ---
function EmptyState({ filter }) {
  const copy = {
    All:      { title: 'No jobs yet', hint: 'Tap + New to log your first job.' },
    Quoted:   { title: 'No quotes out', hint: 'Send a quote and it will appear here.' },
    On:       { title: 'Nothing on the tools', hint: 'Accept a quote or tap + New to start a job.' },
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

// --- Job card with dual CTAs ---
function JobCard({ job, onSendInvoice, onUpdateJob }) {
  const status = deriveDisplayStatus(job);
  const statusClass = {
    Quoted:   'status--quoted',
    On:       'status--active',   // reuses green pill — "On" is the new "Active"
    Invoiced: 'status--invoiced',
    Paid:     'status--paid',
  }[status] || 'status--quoted';

  const ctas = getStageCTAs(status, job, { onSendInvoice, onUpdateJob });

  return (
    <li className="job-card">
      <div className="job-card-top">
        <span className={`job-status-pill ${statusClass}`}>{status[0]}</span>
        <span className="job-card-customer">{job.customer || job.name || 'Unnamed job'}</span>
      </div>
      {job.summary && (
        <div className="job-card-summary">{job.summary.slice(0, 60)}{job.summary.length > 60 ? '…' : ''}</div>
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
        <div className="job-card-ctas">
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

/**
 * Returns { primary, secondary, primaryMod } CTA config per pipeline stage.
 *
 * Placeholder TODO notes (actions not yet fully wired):
 *
 * "Mark accepted" — TODO: wire to Quote→Job auto-conversion (separate PR).
 *   Currently a no-op; founder can open the job from the Work screen to update manually.
 *
 * "Nudge customer" — wired to WhatsApp share-sheet with a quote-chaser message.
 *   TODO: swap generic message for the actual quote link once quoteMessage.js is surfaced here.
 *
 * "Log time" — TODO: open JobDetailDrawer on the job. Drawer is currently only mounted in
 *   WorkScreen. No-op for now; founder uses WorkScreen to log time.
 *
 * "Mark complete" — TODO: write status = 'complete' via jobMeta + prompt to send invoice.
 *   No-op for now; founder uses WorkScreen for this.
 *
 * "Send reminder" — wired to WhatsApp share-sheet with a payment-reminder message.
 *   TODO: swap for pre-built invoiceMessage template when that function is surfaced here.
 *
 * "Mark paid" — wired to onUpdateJob. Merges paid=true into the job record and writes
 *   to localStorage + cloud via AppShell's onUpdateJob handler.
 *
 * "View summary" — TODO: open JobDetailDrawer on the summary tab (same drawer issue as above).
 *   No-op for now.
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
        // TODO: Log time → open JobDetailDrawer (drawer not mounted in JobsScreen yet)
        primary: { label: 'Log time', action: () => {} },
        // TODO: Mark complete → jobMeta write + invoice prompt (separate PR)
        secondary: { label: 'Mark complete', action: () => {} },
      };

    case 'Invoiced':
      return {
        secondary: {
          label: 'Mark paid',
          action: () => {
            if (!onUpdateJob) return;
            onUpdateJob({ ...job, paid: true, paymentStatus: 'paid', jobStatus: 'complete' });
          },
        },
        primary: {
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
        // TODO: View summary → open JobDetailDrawer (drawer not mounted in JobsScreen yet)
        primary: { label: 'View summary', action: () => {} },
        secondary: null,
      };

    default:
      return { primary: null, secondary: null };
  }
}

/**
 * Map the various status fields used across the app to one of the four
 * Phase 1 display statuses: Quoted | On | Invoiced | Paid.
 *
 * Changes from original deriveDisplayStatus:
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

/** Format a number as en-GB integer string (no pence). */
function formatAmount(val) {
  return (Number(val ?? 0) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0 });
}
