/**
 * WorkScreen — Jobs tab in slice-3 nav.
 *
 * Stage Strip + Advance Button pipeline redesign (PRD, 2026-05-27).
 *   Replaces the pill chip row and dual CTAs from the first-pass.
 *
 * Layout order (top → bottom):
 *   1. Header (Jobs title + + New job)
 *   2. Money-at-risk strip (kept from first-pass)
 *   3. Stage Strip (new) — horizontal scrollable rail of stage tiles with count + £
 *   4. List/Calendar segmented control + [Show all] toggle
 *   5. Job list (filtered to selected stage) or Calendar
 *
 * Per-card changes:
 *   - Single full-width Advance Button (label + action depend on stage)
 *   - Overflow menu (⋯) for secondary/rare actions
 *   - Paid cards: no button, replaced by "Paid N days ago" meta line
 *
 * Overdue exception: Chase now → calls chaseJob(job) — does NOT advance stage.
 *
 * Stages: Lead · Quoted · On · Invoiced · Overdue · Paid
 * "All" moved to [Show all] toggle in header row.
 *
 * Data layer ported verbatim from held branch polish/jobs-pipeline-workscreen-port
 * (merged to main as PR #62, commit 8bee7fb):
 *   - deriveDisplayStatus — Lead/Overdue/Invoiced/On/Paid derivation
 *   - chaseJob — WhatsApp share-sheet
 *   - calcRiskFigures — quoted/invoiced/overdue totals
 *   - SendInvoiceModal wiring + invoiceJob/setInvoiceJob state
 *   - paidAt timestamp on Mark paid
 *
 * Note: JobsScreen.jsx still exists but is never rendered — cleanup is a follow-up PR.
 */
import { useState, useCallback } from 'react';
import WorkCalendar from './WorkCalendar';
import AddJobModal from '../components/AddJobModal';
import JobDetailDrawer from '../components/JobDetailDrawer';
import SendInvoiceModal from '../components/SendInvoiceModal';
import StageStrip from '../components/StageStrip';
import { logTelemetry } from '../lib/telemetry';
import { daysSinceInvoice } from '../lib/jobStatus';

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

// ── Status helpers (ported verbatim from PR #62) ──────────────────────────────

/**
 * Derive one of the six pipeline stages from the raw job record.
 *
 *  - Lead:     job.status === 'lead'
 *  - Paid:     any paid signal (takes priority before invoice checks)
 *  - Overdue:  invoiced && daysSinceInvoice > 14 (takes priority over Invoiced)
 *  - Invoiced: invoiced && within net-14 terms
 *  - On:       active or complete-but-not-yet-invoiced
 *  - Quoted:   default (quote sent, not yet accepted)
 *
 * Mirrors JobDetailDrawer's own deriveDisplayStatus (~L75 in that file).
 * If you change this, change it there too.
 */
function deriveDisplayStatus(job) {
  if (job.status === 'lead') return 'Lead';
  if (job.paid || job.paymentStatus === 'paid' || job.jobStatus === 'paid') return 'Paid';
  // Overdue must be checked before Invoiced — overdue takes priority
  if (job.invoiceStatus === 'invoiced' || job.status === 'invoice_sent') {
    const days = daysSinceInvoice(job);
    if (days !== null && days > 14) return 'Overdue';
    return 'Invoiced';
  }
  // complete-but-not-invoiced → On: work done, invoice not sent yet
  if (job.jobStatus === 'complete' || job.status === 'complete') return 'On';
  if (job.jobStatus === 'active' || job.status === 'active') return 'On';
  return 'Quoted';
}

/** Format a number as en-GB integer string (no pence). */
function formatAmount(val) {
  return (Number(val ?? 0) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0 });
}

/**
 * Calculate money-at-risk figures for the strip.
 * Ported verbatim from PR #62.
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

  // Sort oldest first — most urgent to chase
  overdueJobs.sort((a, b) => new Date(a.invoiceDueDate) - new Date(b.invoiceDueDate));

  return { quoted, invoiced, overdue, overdueJobs };
}

/**
 * Open WhatsApp share-sheet with a chase message for a specific job.
 * Used by both Overdue card Advance Button and the money-at-risk strip Chase button.
 */
function chaseJob(job) {
  const customer = job.customer || job.name || 'your customer';
  const amount = '£' + formatAmount(job.total ?? job.amount);
  const msg = encodeURIComponent(
    `Hi ${customer}, just a reminder that your invoice for ${amount} is overdue. Please let me know when payment is on the way. Thanks.`
  );
  window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener');
}

/** Days since a job was paid, for Paid cards meta line. Returns null if no paidAt. */
function daysSincePaid(job) {
  const raw = job.paidAt;
  if (!raw) return null;
  const paid = new Date(raw);
  if (isNaN(paid)) return null;
  const diff = Date.now() - paid.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// StageStrip and StageTile live in src/components/StageStrip.jsx (extracted because
// WorkScreen exceeded 500 lines). deriveDisplayStatus and formatAmount are passed as
// props to avoid a circular import.

// ── JobOverflowMenu ────────────────────────────────────────────────────────────

const STAGE_ORDER = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];

/**
 * JobOverflowMenu — bottom sheet with secondary/rare actions for a job.
 *
 * Actions present:
 *   - Move back to [prev stage]  (all stages with a predecessor)
 *   - Skip to...                 (stub — "Coming soon" toast in PR 2)
 *   - Edit job
 *   - Archive
 *   - Nudge customer             (Quoted only)
 *   - Send reminder              (Invoiced only)
 *   - Bin it                     (Lead only)
 *
 * Tap outside or swipe down to dismiss.
 */
function JobOverflowMenu({ job, status, onClose, onUpdateJob, onSelect, onToast }) {
  const stageIdx = STAGE_ORDER.indexOf(status);
  const prevStage = stageIdx > 0 ? STAGE_ORDER[stageIdx - 1] : null;

  // Map stage name back to a status value onUpdateJob understands
  function stageToStatus(stage) {
    const map = {
      Lead:     'lead',
      Quoted:   'quoted',
      On:       'active',
      Invoiced: 'invoice_sent',
      Overdue:  'invoice_sent',
      Paid:     'paid',
    };
    return map[stage] ?? stage.toLowerCase();
  }

  function handleMoveBack() {
    if (!prevStage || !onUpdateJob) return;
    const updates = { ...job, status: stageToStatus(prevStage) };
    // Clear paid fields when moving back from Paid
    if (status === 'Paid') {
      updates.paid = false;
      updates.paymentStatus = '';
      updates.paidAt = null;
    }
    // Clear invoice fields when moving back from Invoiced/Overdue
    if (status === 'Invoiced' || status === 'Overdue') {
      updates.invoiceStatus = '';
    }
    onUpdateJob(updates);
    onToast?.(`Moved back to ${prevStage}`);
    onClose();
  }

  function handleSkipTo() {
    // Stub — PR 2 will implement the sub-list picker
    onToast?.('Coming soon');
    onClose();
  }

  function handleEdit() {
    onSelect?.(job);
    onClose();
  }

  function handleArchive() {
    if (!onUpdateJob) return;
    onUpdateJob({ ...job, status: 'archived' });
    onToast?.('Job archived');
    onClose();
  }

  function handleNudge() {
    const customer = job.customer || job.name || 'your customer';
    const amount = '£' + formatAmount(job.total ?? job.amount);
    const msg = encodeURIComponent(
      `Hi ${customer}, just checking you received the quote for ${amount}. Happy to answer any questions.`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener');
    onClose();
  }

  function handleReminder() {
    const customer = job.customer || job.name || 'your customer';
    const amount = '£' + formatAmount(job.total ?? job.amount);
    const msg = encodeURIComponent(
      `Hi ${customer}, just a friendly reminder that your invoice for ${amount} is due. Please let me know when payment is on the way. Thanks.`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener');
    onClose();
  }

  function handleBinIt() {
    if (!onUpdateJob) return;
    onUpdateJob({ ...job, status: 'archived' });
    onToast?.('Lead binned');
    onClose();
  }

  return (
    <>
      {/* Backdrop */}
      <div className="job-overflow-backdrop" onClick={onClose} aria-hidden="true" />
      {/* Sheet */}
      <div className="job-overflow-sheet" role="dialog" aria-label="Job actions">
        <div className="job-overflow-handle" />
        <div className="job-overflow-title">
          {job.customer || job.name || 'Unnamed job'}
        </div>
        <div className="job-overflow-actions">
          {prevStage && (
            <button type="button" className="job-overflow-item" onClick={handleMoveBack}>
              Move back to {prevStage}
            </button>
          )}
          <button type="button" className="job-overflow-item" onClick={handleSkipTo}>
            Skip to…
          </button>
          <button type="button" className="job-overflow-item" onClick={handleEdit}>
            Edit job
          </button>
          {status === 'Quoted' && (
            <button type="button" className="job-overflow-item" onClick={handleNudge}>
              Nudge customer
            </button>
          )}
          {status === 'Invoiced' && (
            <button type="button" className="job-overflow-item" onClick={handleReminder}>
              Send reminder
            </button>
          )}
          <button type="button" className="job-overflow-item job-overflow-item--danger" onClick={handleArchive}>
            Archive
          </button>
          {status === 'Lead' && (
            <button type="button" className="job-overflow-item job-overflow-item--danger" onClick={handleBinIt}>
              Bin it
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ── JobCard (Stage Strip variant) ─────────────────────────────────────────────

/**
 * AdvanceButton — full-width stage-aware primary button at the bottom of each job card.
 *
 * Stage → label mapping (spec):
 *   Lead     → Send quote →       (opens onNewJob; TODO: dedicated Lead→Quote flow)
 *   Quoted   → Move to On →       (sets status active)
 *   On       → Send invoice →     (opens SendInvoiceModal)
 *   Invoiced → Mark paid →        (sets paid + paidAt)
 *   Overdue  → Chase now →        (chaseJob — rose style; does NOT advance stage)
 *   Paid     → (no button)        (terminal stage; tap card body for detail)
 */
function AdvanceButton({ status, job, onNewJob, onSendInvoice, onUpdateJob }) {
  if (status === 'Paid') return null;

  const isOverdue = status === 'Overdue';

  function handleAdvance(e) {
    e.stopPropagation();
    switch (status) {
      case 'Lead':
        // TODO: wire to a dedicated Lead→Quote flow when available.
        onNewJob?.();
        break;
      case 'Quoted':
        onUpdateJob?.({ ...job, status: 'active' });
        break;
      case 'On':
        onSendInvoice?.(job);
        break;
      case 'Invoiced':
        onUpdateJob?.({ ...job, paid: true, paymentStatus: 'paid', paidAt: new Date().toISOString() });
        break;
      case 'Overdue':
        // Overdue exception: chase is the next action, not a stage advance.
        chaseJob(job);
        break;
      default:
        break;
    }
  }

  const labels = {
    Lead:     'Send quote →',
    Quoted:   'Move to On →',
    On:       'Send invoice →',
    Invoiced: 'Mark paid →',
    Overdue:  'Chase now →',
  };

  return (
    <button
      type="button"
      className={`advance-btn${isOverdue ? ' advance-btn--chase' : ''}`}
      onClick={handleAdvance}
      aria-label={labels[status]}
    >
      {labels[status]}
    </button>
  );
}

function JobCard({ job, onSelect, onSendInvoice, onUpdateJob, onNewJob, onToast }) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const status = deriveDisplayStatus(job);

  const statusClass = {
    Lead:     'status--lead',
    Quoted:   'status--quoted',
    On:       'status--active',
    Invoiced: 'status--invoiced',
    Overdue:  'status--overdue',
    Paid:     'status--paid',
  }[status] || 'status--quoted';

  const isOverdue = status === 'Overdue';
  const isPaid = status === 'Paid';
  const daysLate = isOverdue ? (daysSinceInvoice(job) ?? 0) : 0;
  const daysPaid = isPaid ? daysSincePaid(job) : null;

  return (
    <>
      <li
        className={`job-card job-card--tappable${isOverdue ? ' job-card--overdue' : ''}`}
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
        {isOverdue && (
          <div className="job-card-overdue-meta">{daysLate} days late</div>
        )}
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
          {isPaid && daysPaid !== null && (
            <span className="job-card-paid-meta">Paid {daysPaid === 0 ? 'today' : `${daysPaid}d ago`}</span>
          )}
        </div>
        {/* Advance Button + overflow menu row. stopPropagation so taps don't open the drawer. */}
        {status !== 'Paid' && (
          <div className="job-card-actions" onClick={e => e.stopPropagation()}>
            <AdvanceButton
              status={status}
              job={job}
              onNewJob={onNewJob}
              onSendInvoice={onSendInvoice}
              onUpdateJob={onUpdateJob}
            />
            <button
              type="button"
              className="job-overflow-trigger"
              onClick={e => { e.stopPropagation(); setOverflowOpen(true); }}
              aria-label="More actions"
            >
              ⋯
            </button>
          </div>
        )}
      </li>
      {/* Overflow menu — rendered outside the li to avoid stacking-context issues */}
      {overflowOpen && (
        <JobOverflowMenu
          job={job}
          status={status}
          onClose={() => setOverflowOpen(false)}
          onUpdateJob={onUpdateJob}
          onSelect={onSelect}
          onToast={onToast}
        />
      )}
    </>
  );
}

// ── Empty state copy per stage ────────────────────────────────────────────────

function EmptyState({ stage }) {
  const copy = {
    Lead:     { title: 'No leads yet', hint: 'Got a phone enquiry? Tap + to log it.' },
    Quoted:   { title: 'No quotes out', hint: 'Send a quote and it will appear here.' },
    On:       { title: 'Nothing on the go', hint: "Either you're on holiday or it's time to chase a quote." },
    Invoiced: { title: 'No invoices waiting', hint: 'Mark a job complete and send the invoice.' },
    Overdue:  { title: 'Nothing overdue', hint: 'Good week.' },
    Paid:     { title: 'No paid jobs yet', hint: 'Paid jobs show here once the money lands.' },
  };
  const { title, hint } = copy[stage] ?? { title: 'No jobs', hint: 'Tap + New job to get started.' };
  return (
    <div className="screen-empty">
      <p className="screen-empty-title">{title}</p>
      <p className="screen-empty-hint">{hint}</p>
    </div>
  );
}

// ── JobsList subview ──────────────────────────────────────────────────────────

function JobsList({ jobs, selectedStage, showAll, onJobSelect, onSendInvoice, onUpdateJob, onNewJob, onToast }) {
  const filtered = showAll
    ? jobs
    : jobs.filter(j => deriveDisplayStatus(j) === selectedStage);

  return (
    <>
      {filtered.length === 0 ? (
        <EmptyState stage={showAll ? 'All' : selectedStage} />
      ) : (
        <ul className="job-list">
          {filtered.map(j => (
            <JobCard
              key={j.id || j.cloudId}
              job={j}
              onSelect={onJobSelect}
              onSendInvoice={onSendInvoice}
              onUpdateJob={onUpdateJob}
              onNewJob={onNewJob}
              onToast={onToast}
            />
          ))}
        </ul>
      )}
    </>
  );
}

// ── WorkScreen (root) ─────────────────────────────────────────────────────────

export default function WorkScreen({ jobs = [], receipts = [], onNewJob, onAddJob, onAddPayment, onUpdateJob, onAddReceipt, onDeleteReceipt, biz, profile }) {
  const [subview, setSubview] = useState(getPersistedView);
  const [selectedStage, setSelectedStage] = useState('On');
  const [showAll, setShowAll] = useState(false);
  // selectedJob drives the JobDetailDrawer — null means closed.
  const [selectedJob, setSelectedJob] = useState(null);
  // invoiceJob drives the SendInvoiceModal from the "Send invoice →" Advance Button.
  const [invoiceJob, setInvoiceJob] = useState(null);
  const [toast, setToast] = useState('');
  // addJobOpen drives the inline AddJobModal — same pattern as TodayScreen.
  const [addJobOpen, setAddJobOpen] = useState(false);

  const switchSubview = useCallback((v) => {
    logTelemetry('work_subview', { subview: v });
    setSubview(v);
    persistView(v);
  }, []);

  // Keep the drawer's job in sync when AppShell refreshes jobs[] after a payment.
  const liveSelectedJob = selectedJob
    ? (jobs.find(j => j.id === selectedJob.id) ?? selectedJob)
    : null;

  const handleAddPayment = (job, payload) => {
    onAddPayment?.(job, payload);
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2400);
  };

  const handleSelectStage = (stage) => {
    setSelectedStage(stage);
    setShowAll(false);
    logTelemetry('stage_strip_select', { stage });
  };

  const handleToggleShowAll = () => {
    setShowAll(v => !v);
  };

  // Money-at-risk strip figures
  const riskFigures = calcRiskFigures(jobs);
  const oldestOverdue = riskFigures.overdueJobs[0] ?? null;

  const handleChase = () => {
    if (!oldestOverdue) return;
    chaseJob(oldestOverdue);
  };

  const handleJobSave = (job) => {
    setAddJobOpen(false);
    onAddJob?.(job);
    showToast('Job saved');
  };

  const openAddJob = () => setAddJobOpen(true);

  return (
    <div className="screen work-screen">
      {/* Header */}
      <div className="screen-header">
        <h1 className="screen-title">Jobs</h1>
        <div className="screen-header-right">
          <button className="new-btn" onClick={openAddJob}>+ New job</button>
        </div>
      </div>

      {/* Money-at-risk strip — kept from first-pass */}
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

      {/* Stage Strip — deriveStatus + formatAmount passed as props (avoids circular import) */}
      <StageStrip
        jobs={jobs}
        selectedStage={selectedStage}
        onSelectStage={handleSelectStage}
        deriveStatus={deriveDisplayStatus}
        formatAmount={formatAmount}
      />

      {/* Segmented control row + Show all toggle */}
      <div className="work-controls-row">
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
        <button
          type="button"
          className={`show-all-toggle${showAll ? ' show-all-toggle--active' : ''}`}
          onClick={handleToggleShowAll}
        >
          {showAll ? 'Stage view' : 'Show all ⌄'}
        </button>
      </div>

      {/* Subview */}
      {subview === 'list' ? (
        <JobsList
          jobs={jobs}
          selectedStage={selectedStage}
          showAll={showAll}
          onJobSelect={setSelectedJob}
          onSendInvoice={setInvoiceJob}
          onUpdateJob={onUpdateJob}
          onNewJob={onNewJob}
          onToast={showToast}
        />
      ) : (
        <WorkCalendar jobs={jobs} onNewJobOnDate={onNewJob} />
      )}

      {/* Job detail drawer */}
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

      {/* SendInvoiceModal — opened by Send invoice → Advance Button on On cards */}
      {invoiceJob && (
        <SendInvoiceModal
          job={invoiceJob}
          biz={biz ?? {}}
          profile={profile ?? null}
          jobs={jobs}
          onUpdate={onUpdateJob ?? (() => {})}
          onClose={() => setInvoiceJob(null)}
          flash={showToast}
        />
      )}

      {/* AddJobModal — mounted inline, same pattern as TodayScreen */}
      {addJobOpen && (
        <AddJobModal
          onClose={() => setAddJobOpen(false)}
          onSave={handleJobSave}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
