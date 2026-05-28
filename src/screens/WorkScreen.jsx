/**
 * WorkScreen — Jobs tab in slice-3 nav.
 *
 * Stage Strip + tile redesign (feat/job-tile-stage-chip, 2026-05-28):
 *   Replaces AdvanceButton + JobCard with the new JobTile system (stage chip
 *   top-right, 4px coloured left-rail, at-a-glance signals, stage-aware CTA,
 *   Paid dim, chip dropdown replaces standalone … button).
 *
 * Layout order (top → bottom):
 *   1. Header (Jobs title + + New job)
 *   2. Money-at-risk strip
 *   3. Stage Strip — horizontal scrollable rail of stage tiles with count + £
 *   4. List/Calendar segmented control + [Show all] toggle
 *   5. Job list (filtered to selected stage) or Calendar
 *
 * Stages: Lead · Quoted · On · Invoiced · Overdue · Paid
 * "All" moved to [Show all] toggle in header row.
 *
 * Data layer ported verbatim from PR #62 (commit 8bee7fb):
 *   - deriveDisplayStatus — Lead/Overdue/Invoiced/On/Paid derivation
 *   - chaseJob — WhatsApp share-sheet
 *   - calcRiskFigures — quoted/invoiced/overdue totals
 *   - SendInvoiceModal wiring + invoiceJob/setInvoiceJob state
 *   - paidAt timestamp on Mark paid
 *
 * TODO(consolidate): JobsScreen + WorkScreen both claim "Jobs" tab — one renders behind NEW_NAV flag,
 * the other behind NAV_SLICE_3. Pick one and delete the other in a separate PR.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
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
 * Canonical overdue check — shared by deriveDisplayStatus AND calcRiskFigures.
 *
 * Rule: overdue if invoiceDueDate is set and in the past;
 *       else fall back to daysSinceInvoice > 14 (net-14 default).
 *
 * Both the OVERDUE pipeline card and the banner key off this function so
 * they are guaranteed to agree.
 */
function isOverdue(job) {
  if (job.invoiceDueDate) {
    const due = new Date(job.invoiceDueDate);
    due.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due < today;
  }
  const days = daysSinceInvoice(job);
  return days !== null && days > 14;
}

/**
 * Derive one of the six pipeline stages from the raw job record.
 *
 *  - Lead:     job.status === 'lead'
 *  - Paid:     any paid signal (takes priority before invoice checks)
 *  - Overdue:  invoiced && (invoiceDueDate past, else daysSinceInvoice > 14)
 *  - Invoiced: invoiced && not yet overdue
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
    if (isOverdue(job)) return 'Overdue';
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
 * Calculate money-in-flight figures for the banner.
 *
 * - invoiced:    sum of jobs whose derived stage === Invoiced
 * - overdue:     sum of jobs whose derived stage === Overdue (keyed off isOverdue,
 *                same function deriveDisplayStatus uses — guaranteed to match the card)
 * - owed:        invoiced + overdue (total money sent out, not yet paid)
 * - overdueJobs: overdue job records sorted oldest-first (for Chase CTA)
 */
function calcRiskFigures(jobs) {
  let invoiced = 0;
  let overdue = 0;
  const overdueJobs = [];

  for (const j of jobs) {
    const status = deriveDisplayStatus(j);
    const val = Number(j.total ?? j.amount ?? 0) || 0;

    if (status === 'Invoiced') {
      invoiced += val;
    } else if (status === 'Overdue') {
      overdue += val;
      overdueJobs.push(j);
    }
  }

  // Sort oldest first — most urgent to chase
  overdueJobs.sort((a, b) => {
    // Prefer invoiceDueDate for sort; fall back to invoiceSentAt
    const aDate = a.invoiceDueDate ? new Date(a.invoiceDueDate) : new Date(a.invoiceSentAt ?? 0);
    const bDate = b.invoiceDueDate ? new Date(b.invoiceDueDate) : new Date(b.invoiceSentAt ?? 0);
    return aDate - bDate;
  });

  const owed = invoiced + overdue;
  return { invoiced, overdue, owed, overdueJobs };
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

// StageStrip lives in src/components/StageStrip.jsx (extracted because
// WorkScreen exceeded 500 lines). deriveDisplayStatus and formatAmount are passed as
// props to avoid a circular import.

// ── Job tile (stage chip redesign) ───────────────────────────────────────────
// Ported from JobsScreen.jsx (feat/job-tile-stage-chip). Replaces JobCard +
// AdvanceButton + JobOverflowMenu. The old JobOverflowMenu bottom-sheet is
// superseded by the chip dropdown.

// Canonical stage list — matches StageStrip.jsx STAGES export
const STAGES = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];

// Stage palette tokens — explicit hex to avoid color-mix() (no confirmed Safari 16.4+ baseline)
const STAGE_META = {
  Lead:     { hue: '#3B82F6', fill: '#1a2a4a', ink: null },
  Quoted:   { hue: '#B3F0D5', fill: '#7FDFB4', ink: '#1E8A5C' },
  On:       { hue: '#5FD9A6', fill: '#1a3a2e', ink: null },
  Invoiced: { hue: '#28B581', fill: '#1a3028', ink: null },
  Overdue:  { hue: '#E5484D', fill: '#3a1a1a', ink: null },
  Paid:     { hue: '#0E6B43', fill: '#0a2a1e', ink: '#B3F0D5' },
};

/**
 * StageChipDropdown — coloured chip in the top-right corner of each tile.
 * Tap opens a dropdown: "Move to" (all 6 stages) + "More actions".
 * Replaces the old standalone ⋯ overflow button.
 */
function StageChipDropdown({ job, currentStage, onUpdateJob, onSendInvoice, onSelect }) {
  const [open, setOpen] = useState(false);
  const chipRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (chipRef.current && !chipRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [open]);

  const meta = STAGE_META[currentStage] || STAGE_META.Lead;
  const ink = meta.ink || meta.hue;

  function moveToStage(stage) {
    setOpen(false);
    if (!onUpdateJob) return;
    // Map canonical stage name to the status fields the DB understands.
    // TODO(stage-cleanup): replace with a canonical `stage` field once the
    // schema is updated and jobStatus.js is retired.
    const stageMap = {
      Lead:     { status: 'lead',         paid: false, invoiceStatus: null },
      Quoted:   { status: 'quoted',        paid: false, invoiceStatus: null },
      On:       { status: 'active',        paid: false, invoiceStatus: null },
      Invoiced: { status: 'invoice_sent',  paid: false, invoiceStatus: 'invoiced' },
      Overdue:  { status: 'invoice_sent',  paid: false, invoiceStatus: 'invoiced', overdue: true },
      Paid:     { status: 'paid',          paid: true,  invoiceStatus: 'invoiced', paidAt: new Date().toISOString() },
    };
    const patch = stageMap[stage] ?? {};
    onUpdateJob({ ...job, ...patch });
  }

  function handleAction(action) {
    setOpen(false);
    switch (action) {
      case 'Edit':
        onSelect?.(job);
        break;
      case 'Duplicate':
        // TODO: duplicate job (separate PR)
        break;
      case 'Archive':
        if (!onUpdateJob) return;
        onUpdateJob({ ...job, archived: true });
        break;
      case 'Delete':
        if (!onUpdateJob) return;
        // Soft-delete: archived + deleted flag. Hard delete needs onDeleteJob prop.
        // TODO: wire proper hard-delete via onDeleteJob callback (separate PR)
        onUpdateJob({ ...job, archived: true, deleted: true });
        break;
      default:
        break;
    }
  }

  return (
    <div
      ref={chipRef}
      className={`jt-chip jt-chip--${currentStage.toLowerCase()}${open ? ' jt-chip--open' : ''}`}
      style={{ '--chip-hue': meta.hue, '--chip-fill': meta.fill, '--chip-ink': ink }}
      onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
      role="button"
      aria-haspopup="true"
      aria-expanded={open}
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}
    >
      <span className="jt-chip-label">{currentStage}</span>
      <svg className="jt-chip-caret" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M2 4l3 3 3-3"/>
      </svg>

      {open && (
        <div className="jt-menu" role="menu" onClick={e => e.stopPropagation()}>
          <div className="jt-menu-label">Move to</div>
          {STAGES.map(s => {
            const sMeta = STAGE_META[s];
            return (
              <div
                key={s}
                className={`jt-menu-item${s === currentStage ? ' jt-menu-item--current' : ''}`}
                role="menuitem"
                onClick={() => moveToStage(s)}
              >
                <span className="jt-menu-dot" style={{ background: sMeta.hue }} />
                {s}
              </div>
            );
          })}
          <div className="jt-menu-divider" />
          <div className="jt-menu-label">More actions</div>
          {[
            { key: 'Edit',      label: 'Edit',      icon: '✎' },
            { key: 'Duplicate', label: 'Duplicate', icon: '⧉' },
            { key: 'Archive',   label: 'Archive',   icon: '↓' },
            { key: 'Delete',    label: 'Delete',    icon: '✕', danger: true },
          ].map(a => (
            <div
              key={a.key}
              className={`jt-menu-item jt-menu-item--action${a.danger ? ' jt-menu-item--danger' : ''}`}
              role="menuitem"
              onClick={() => handleAction(a.key)}
            >
              <span className="jt-menu-icon">{a.icon}</span>
              {a.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Stage-appropriate CTA config — wired to real WorkScreen handlers. */
function getStageCTA(stage, job, { onSendInvoice, onUpdateJob, onNewJob }) {
  const customer = job.customer || job.name || 'your customer';
  const amount = '£' + formatAmount(job.total ?? job.amount);

  switch (stage) {
    case 'Lead':
      return {
        label: 'Send quote →',
        mod: null,
        phoneBtn: false,
        // TODO: wire to a dedicated Lead→Quote flow when available.
        action: () => onNewJob?.(),
      };

    case 'Quoted':
      return {
        label: 'Mark booked',
        mod: 'ghost',
        phoneBtn: true,
        // Flips status to active — same behaviour as the old "Move to On →" button.
        action: () => onUpdateJob?.({ ...job, status: 'active' }),
      };

    case 'On':
      return {
        label: 'Send invoice',
        mod: null,
        phoneBtn: false,
        action: () => { if (onSendInvoice) onSendInvoice(job); },
      };

    case 'Invoiced':
      return {
        label: 'Chase payment',
        mod: 'ghost',
        phoneBtn: false,
        action: () => {
          const msg = encodeURIComponent(
            `Hi ${customer}, just a friendly reminder that your invoice for ${amount} is due. Please let me know when payment is on the way. Thanks.`
          );
          window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener');
        },
      };

    case 'Overdue':
      return {
        label: 'Chase payment →',
        mod: 'urgent',
        phoneBtn: true,
        action: () => {
          const msg = encodeURIComponent(
            `Hi ${customer}, your invoice for ${amount} is overdue. Please arrange payment as soon as possible. Thanks.`
          );
          window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener');
        },
      };

    case 'Paid':
      return {
        label: 'View receipt',
        mod: 'muted',
        phoneBtn: false,
        // TODO: open JobDetailDrawer to receipt tab (separate PR)
        action: () => {},
      };

    default:
      return null;
  }
}

/** Time signal — most urgent variant per stage. */
function deriveTimeSignal(job, stage) {
  const now = Date.now();

  if (stage === 'Overdue' && job.invoiceDueDate) {
    const due = new Date(job.invoiceDueDate);
    const days = Math.floor((now - due.getTime()) / 86400000);
    if (days > 0) return { text: `${days} day${days === 1 ? '' : 's'} overdue`, variant: 'urgent' };
  }
  if (stage === 'Invoiced' && job.invoiceSentAt) {
    const days = Math.floor((now - new Date(job.invoiceSentAt).getTime()) / 86400000);
    return { text: `Sent ${days} day${days === 1 ? '' : 's'} ago`, variant: 'mute' };
  }
  if (stage === 'Quoted' && job.quoteSentAt) {
    const days = Math.floor((now - new Date(job.quoteSentAt).getTime()) / 86400000);
    if (days >= 3) return { text: `Sent ${days} days ago`, variant: 'warn' };
    return { text: `Sent ${days} day${days === 1 ? '' : 's'} ago`, variant: 'mute' };
  }
  if (stage === 'On' && job.startedAt && job.durationDays) {
    const dayIn = Math.floor((now - new Date(job.startedAt).getTime()) / 86400000) + 1;
    return { text: `Day ${dayIn} of ${job.durationDays}`, variant: 'ok' };
  }
  if (stage === 'Paid' && job.paidAt) {
    const days = Math.floor((now - new Date(job.paidAt).getTime()) / 86400000);
    return { text: `Paid ${days} day${days === 1 ? '' : 's'} ago`, variant: 'ok' };
  }
  if (job.createdAt) {
    const ms = now - new Date(job.createdAt).getTime();
    const hours = Math.floor(ms / 3600000);
    if (hours < 24) return { text: `Created ${hours}h ago`, variant: 'mute' };
    const days = Math.floor(ms / 86400000);
    return { text: `Created ${days} day${days === 1 ? '' : 's'} ago`, variant: 'mute' };
  }
  return null;
}

/** Money sub-line adapts to stage. */
function deriveMoneySub(job, stage) {
  const amount = Number(job.total ?? job.amount ?? 0) || 0;
  switch (stage) {
    case 'Lead':     return 'No quote yet';
    case 'Quoted':   return amount > 0 ? 'Quote out' : null;
    case 'On': {
      const deposit = Number(job.deposit ?? 0) || 0;
      if (deposit > 0 && amount > 0) return `£${formatAmount(amount - deposit)} outstanding`;
      return null;
    }
    case 'Invoiced': return amount > 0 ? 'Awaiting payment' : null;
    case 'Overdue':  return amount > 0 ? 'Outstanding' : null;
    case 'Paid':     return 'Cleared';
    default:         return null;
  }
}

/**
 * JobTile — new tile design with stage chip, coloured left-rail, and at-a-glance signals.
 * Replaces the old JobCard. Card body tap opens JobDetailDrawer via onSelect.
 */
function JobTile({ job, onSelect, onSendInvoice, onUpdateJob, onNewJob }) {
  const stage = deriveDisplayStatus(job);
  const isPaid = stage === 'Paid';

  const initial = (job.customer || job.name || '?')[0].toUpperCase();
  const timeSignal = deriveTimeSignal(job, stage);
  const photoCount = Array.isArray(job.photos) ? job.photos.length : 0;
  const noteCount = Array.isArray(job.jobNotes) ? job.jobNotes.length : (job.notes ? 1 : 0);
  const moneySub = deriveMoneySub(job, stage);

  const amount = Number(job.total ?? job.amount ?? 0) || 0;
  const formattedAmount = amount > 0 ? '£' + formatAmount(amount) : '—';
  const amountMuted = stage === 'Lead' || amount === 0;

  const cta = getStageCTA(stage, job, { onSendInvoice, onUpdateJob, onNewJob });
  const stageMeta = STAGE_META[stage] || STAGE_META.Lead;

  return (
    <li
      className={`jt jt--${stage.toLowerCase()}`}
      style={{
        '--jt-hue': stageMeta.hue,
        '--jt-fill': stageMeta.fill,
        '--jt-ink': stageMeta.ink || stageMeta.hue,
        opacity: isPaid ? 0.7 : 1,
      }}
      onClick={() => onSelect?.(job)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(job); }}
      aria-label={`View details for ${job.customer || job.name || 'Unnamed job'}`}
    >
      {/* Header row: avatar + customer + stage chip */}
      <div className="jt-head" onClick={e => e.stopPropagation()}>
        <span className="jt-avatar">{initial}</span>
        <span className="jt-customer">{job.customer || job.name || 'Unnamed job'}</span>
        <StageChipDropdown
          job={job}
          currentStage={stage}
          onUpdateJob={onUpdateJob}
          onSendInvoice={onSendInvoice}
          onSelect={onSelect}
        />
      </div>

      {/* Job title / summary */}
      {job.summary && (
        <h3 className="jt-title">
          {job.summary.slice(0, 72)}{job.summary.length > 72 ? '…' : ''}
        </h3>
      )}

      {/* Meta signals row */}
      <div className="jt-meta">
        {timeSignal && (
          <span className={`jt-meta-item jt-meta-item--${timeSignal.variant}`}>
            {timeSignal.text}
          </span>
        )}
        {photoCount > 0 && (
          <>
            {timeSignal && <span className="jt-meta-sep">·</span>}
            <span className="jt-meta-item">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="1.5" y="2.5" width="9" height="7" rx="1"/>
                <circle cx="6" cy="6" r="1.5"/>
              </svg>
              {photoCount}
            </span>
          </>
        )}
        {noteCount > 0 && (
          <>
            {(timeSignal || photoCount > 0) && <span className="jt-meta-sep">·</span>}
            <span className="jt-meta-item">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M2 2h6l2 2v6H2z"/>
                <path d="M3.5 5h5M3.5 7h5"/>
              </svg>
              {noteCount}
            </span>
          </>
        )}
      </div>

      {/* Money row */}
      <div className="jt-money">
        <span className={`jt-amount${amountMuted ? ' jt-amount--muted' : ''}${stage === 'Overdue' ? ' jt-amount--overdue' : ''}`}>
          {formattedAmount}
        </span>
        {moneySub && <span className="jt-amount-sub">{moneySub}</span>}
      </div>

      {/* CTA row — stopPropagation so taps don't open the drawer */}
      {cta && (
        <div className="jt-foot" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            className={`jt-cta${cta.mod ? ` jt-cta--${cta.mod}` : ''}`}
            onClick={cta.action}
          >
            {cta.label}
          </button>
          {cta.phoneBtn && (
            <button
              type="button"
              className="jt-icon-btn"
              aria-label="Call customer"
              onClick={() => {
                const phone = job.phone || job.customerPhone || '';
                if (phone) window.open(`tel:${phone}`, '_self');
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M4 3l2-1 2 3-1.5 1.5a8 8 0 0 0 4 4L12 9l3 2-1 2a2 2 0 0 1-2 1A11 11 0 0 1 3 5a2 2 0 0 1 1-2z"/>
              </svg>
            </button>
          )}
        </div>
      )}
    </li>
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

function JobsList({ jobs, selectedStage, showAll, onJobSelect, onSendInvoice, onUpdateJob, onNewJob }) {
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
            <JobTile
              key={j.id || j.cloudId}
              job={j}
              onSelect={onJobSelect}
              onSendInvoice={onSendInvoice}
              onUpdateJob={onUpdateJob}
              onNewJob={onNewJob}
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

  // Money-in-flight banner figures
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

      {/* Money-in-flight banner — owed (invoiced + overdue) and overdue at a glance.
           Hidden when both figures are £0 — nothing to show. */}
      {(riskFigures.owed > 0 || riskFigures.overdue > 0) && (
        <div className="risk-strip">
          <div className="risk-strip-figures">
            <span className="risk-strip-figure">
              <span className="risk-strip-value">£{formatAmount(riskFigures.owed)}</span>
              <span className="risk-strip-label"> owed to you</span>
            </span>
            {riskFigures.overdue > 0 && (
              <>
                <span className="risk-strip-sep">·</span>
                <span className="risk-strip-figure risk-strip-figure--overdue">
                  <span className="risk-strip-value">£{formatAmount(riskFigures.overdue)}</span>
                  <span className="risk-strip-label"> overdue</span>
                </span>
              </>
            )}
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
      )}


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
