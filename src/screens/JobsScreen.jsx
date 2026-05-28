/**
 * JobsScreen — Tab 2 in the new nav.
 *
 * Phase 1 pipeline redesign (polish/jobs-pipeline-first-pass):
 *  - Status chips: All · Quoted · On · Invoiced · Paid  (Done removed, Active → On)
 *  - Default tab: On
 *  - Money-at-risk strip: always rendered; Chase button shown when overdue > 0
 *  - Per-card dual CTAs driven by existing status field
 *
 * Phase 2 — Job tile redesign (feat/job-tile-stage-chip):
 *  - Full 6-stage model: Lead | Quoted | On | Invoiced | Overdue | Paid
 *  - Stage chip in top-right corner — coloured fill + border + text
 *  - 4px coloured left-rail on each tile
 *  - Stage chip tap opens a dropdown: "Move to" (restage) + "More actions"
 *  - At-a-glance signals: time signal, photo/note counts, money sub-line
 *  - CTA adapts to stage
 *  - Paid tiles render at 70% opacity; persist on list, no auto-archive
 *  - Standalone "..." overflow button removed; actions folded into chip dropdown
 *
 * NOTE: jobStatus.js uses a legacy model (draft/completed/invoice_sent/awaiting/paid)
 * that disagrees with StageStrip.jsx. Do NOT read from jobStatus.js here.
 * Stage mapping is handled by deriveDisplayStatus() in this file.
 */
import { useState, useRef, useEffect } from 'react';
import HeaderAvatar from '../components/HeaderAvatar';
import SendInvoiceModal from '../components/SendInvoiceModal';

// Canonical stage list — matches StageStrip.jsx STAGES export
const STAGES = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];

// Filter chips shown above the job list
const STATUS_FILTERS = ['All', 'Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];

// Stage palette tokens — explicit hex values to avoid color-mix() (no confirmed Safari 16.4+ baseline)
// Canonical hue = rail colour + chip text/border default
// Fill = tinted background for the chip
// Ink = chip text+border override (only for Quoted and Paid where fill≈hue)
const STAGE_META = {
  Lead:     { hue: '#3B82F6', fill: '#1a2a4a', ink: null },
  Quoted:   { hue: '#B3F0D5', fill: '#7FDFB4', ink: '#1E8A5C' },
  On:       { hue: '#5FD9A6', fill: '#1a3a2e', ink: null },
  Invoiced: { hue: '#28B581', fill: '#1a3028', ink: null },
  Overdue:  { hue: '#E5484D', fill: '#3a1a1a', ink: null },
  Paid:     { hue: '#0E6B43', fill: '#0a2a1e', ink: '#B3F0D5' },
};

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

      {/* Money-at-risk strip */}
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

      {/* Stage filter chips */}
      <div className="filter-chips" role="group" aria-label="Filter by stage">
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
            <JobTile
              key={j.id || j.cloudId}
              job={j}
              onSendInvoice={setInvoiceJob}
              onUpdateJob={onUpdateJob}
            />
          ))}
        </ul>
      )}

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

// --- Empty state copy per stage ---
function EmptyState({ filter }) {
  const copy = {
    All:      { title: 'No jobs yet', hint: 'Tap + New to log your first job.' },
    Lead:     { title: 'No leads', hint: 'Log a new lead and send a quote to get started.' },
    Quoted:   { title: 'No quotes out', hint: 'Send a quote and it will appear here.' },
    On:       { title: 'Nothing on the tools', hint: 'Accept a quote or tap + New to start a job.' },
    Invoiced: { title: 'No invoices waiting', hint: 'Mark a job complete and send the invoice.' },
    Overdue:  { title: 'No overdue invoices', hint: 'When a payment goes past due it appears here.' },
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

// --- Stage chip dropdown ---
// Replaces the old standalone "..." overflow button.
// Top section: Move to (all 6 stages). Bottom section: More actions.
function StageChipDropdown({ job, currentStage, onUpdateJob, onSendInvoice }) {
  const [open, setOpen] = useState(false);
  const chipRef = useRef(null);

  // Close on outside click
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
    // Map the canonical stage name back to the status fields the DB understands.
    // This is a local workaround to avoid touching jobStatus.js in this PR.
    // TODO(stage-cleanup): replace with a canonical `stage` field once the
    // schema is updated and jobStatus.js is retired.
    const stageMap = {
      Lead:     { jobStatus: 'lead',     paid: false, invoiceStatus: null },
      Quoted:   { jobStatus: 'quoted',   paid: false, invoiceStatus: null },
      On:       { jobStatus: 'active',   paid: false, invoiceStatus: null },
      Invoiced: { jobStatus: 'complete', paid: false, invoiceStatus: 'invoiced' },
      Overdue:  { jobStatus: 'complete', paid: false, invoiceStatus: 'invoiced', overdue: true },
      Paid:     { jobStatus: 'paid',     paid: true,  invoiceStatus: 'invoiced' },
    };
    const patch = stageMap[stage] ?? {};
    onUpdateJob({ ...job, ...patch });
  }

  function handleAction(action) {
    setOpen(false);
    switch (action) {
      case 'Edit':
        // TODO: open JobDetailDrawer in edit mode (drawer not mounted in JobsScreen yet)
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
        // Soft-delete: mark archived + deleted flag. Hard delete needs a separate onDeleteJob prop.
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
        <div
          className="jt-menu"
          role="menu"
          onClick={e => e.stopPropagation()}
        >
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

// --- Job tile (replaces JobCard) ---
function JobTile({ job, onSendInvoice, onUpdateJob }) {
  const stage = deriveDisplayStatus(job);
  const isPaid = stage === 'Paid';

  // Avatar initial — first char of customer name
  const initial = (job.customer || job.name || '?')[0].toUpperCase();

  // Time signal — most urgent variant wins
  const timeSignal = deriveTimeSignal(job, stage);

  // Job-state counts — only shown when > 0
  const photoCount = Array.isArray(job.photos) ? job.photos.length : 0;
  const noteCount = Array.isArray(job.jobNotes) ? job.jobNotes.length : (job.notes ? 1 : 0);

  // Money sub-line
  const moneySub = deriveMoneySub(job, stage);

  // Primary amount display
  const amount = Number(job.total ?? job.amount ?? 0) || 0;
  const formattedAmount = amount > 0 ? '£' + formatAmount(amount) : '—';
  const amountMuted = stage === 'Lead' || amount === 0;

  // CTA config
  const cta = getStageCTA(stage, job, { onSendInvoice, onUpdateJob });

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
    >
      {/* Header row: avatar + customer + stage chip */}
      <div className="jt-head">
        <span className="jt-avatar">{initial}</span>
        <span className="jt-customer">{job.customer || job.name || 'Unnamed job'}</span>
        <StageChipDropdown
          job={job}
          currentStage={stage}
          onUpdateJob={onUpdateJob}
          onSendInvoice={onSendInvoice}
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
        {/* TODO: Deposit chip — needs a `deposit` or `deposit_amount` field on the job schema.
            Only show for On-stage jobs. Ship without for now. */}
      </div>

      {/* Money row */}
      <div className="jt-money">
        <span className={`jt-amount${amountMuted ? ' jt-amount--muted' : ''}${stage === 'Overdue' ? ' jt-amount--overdue' : ''}`}>
          {formattedAmount}
        </span>
        {moneySub && <span className="jt-amount-sub">{moneySub}</span>}
      </div>

      {/* CTA row */}
      {cta && (
        <div className="jt-foot">
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

// --- Stage-appropriate CTA ---
function getStageCTA(stage, job, { onSendInvoice, onUpdateJob }) {
  const customer = job.customer || job.name || 'your customer';
  const amount = '£' + formatAmount(job.total ?? job.amount);

  switch (stage) {
    case 'Lead':
      return {
        label: 'Send quote →',
        mod: null,
        phoneBtn: false,
        // TODO: wire to quote send flow (separate PR)
        action: () => {},
      };

    case 'Quoted':
      return {
        label: 'Mark booked',
        mod: 'ghost',
        phoneBtn: true,
        // TODO: Mark booked → Quote→Job conversion (separate PR)
        action: () => {},
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
        // TODO: open JobDetailDrawer to receipt tab (drawer not mounted in JobsScreen yet)
        action: () => {},
      };

    default:
      return null;
  }
}

// --- Time signal — most urgent variant per stage ---
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

// --- Money sub-line adapts to stage ---
function deriveMoneySub(job, stage) {
  const amount = Number(job.total ?? job.amount ?? 0) || 0;
  switch (stage) {
    case 'Lead':
      return 'No quote yet';
    case 'Quoted':
      return amount > 0 ? 'Quote out' : null;
    case 'On': {
      const deposit = Number(job.deposit ?? 0) || 0;
      if (deposit > 0 && amount > 0) {
        return `£${formatAmount(amount - deposit)} outstanding`;
      }
      return null;
    }
    case 'Invoiced':
      return amount > 0 ? 'Awaiting payment' : null;
    case 'Overdue':
      return amount > 0 ? 'Outstanding' : null;
    case 'Paid':
      return 'Cleared';
    default:
      return null;
  }
}

/**
 * Map job fields to one of the 6 canonical display stages.
 *
 * Overdue is derived from invoiceDueDate being in the past.
 * Lead falls through at the bottom — no quote or active status.
 *
 * NOTE: jobStatus.js uses a legacy model — do NOT read from it here.
 * TODO(stage-cleanup): Add a canonical `stage` field to the jobs table so
 * this mapping can be replaced with a direct field read.
 */
function deriveDisplayStatus(job) {
  if (job.paid || job.paymentStatus === 'paid' || job.jobStatus === 'paid') return 'Paid';

  if (job.invoiceStatus === 'invoiced' || job.status === 'invoice_sent') {
    // Check if overdue
    if (job.invoiceDueDate) {
      const due = new Date(job.invoiceDueDate);
      due.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (due < today) return 'Overdue';
    }
    if (job.overdue) return 'Overdue';
    return 'Invoiced';
  }

  // complete-but-not-invoiced → On (work done, invoice not sent yet)
  if (job.jobStatus === 'complete' || job.status === 'complete') return 'On';
  if (job.jobStatus === 'active' || job.status === 'active') return 'On';

  // Explicit quoted status
  if (job.jobStatus === 'quoted' || job.status === 'quoted') return 'Quoted';
  // Legacy: anything with a quote amount but no booking confirmation → Quoted
  if (job.jobStatus === 'lead' || job.status === 'lead') return 'Lead';

  // Fallback: jobs with an amount are probably Quoted; truly empty jobs are Lead
  const amount = Number(job.total ?? job.amount ?? 0) || 0;
  return amount > 0 ? 'Quoted' : 'Lead';
}

/**
 * Calculate money-at-risk strip figures.
 */
function calcRiskFigures(jobs) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let quoted = 0, invoiced = 0, overdue = 0;
  const overdueJobs = [];

  for (const j of jobs) {
    const status = deriveDisplayStatus(j);
    const val = Number(j.total ?? j.amount ?? 0) || 0;
    if (status === 'Quoted') quoted += val;
    else if (status === 'Invoiced') invoiced += val;
    else if (status === 'Overdue') {
      overdue += val;
      overdueJobs.push(j);
    } else if (status === 'Invoiced' && j.invoiceDueDate) {
      const due = new Date(j.invoiceDueDate);
      due.setHours(0, 0, 0, 0);
      if (due < today) {
        overdue += val;
        overdueJobs.push(j);
      }
    }
  }

  overdueJobs.sort((a, b) => new Date(a.invoiceDueDate) - new Date(b.invoiceDueDate));
  return { quoted, invoiced, overdue, overdueJobs };
}

function formatAmount(val) {
  return (Number(val ?? 0) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0 });
}
