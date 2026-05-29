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
import { daysSinceInvoice, needsPrice, requiresPriceForStage, stagePatch } from '../lib/jobStatus';
import { deleteJobFromCloud } from '../lib/store';
import {
  computeTier,
  daysPastDue,
  buildChaseLink,
  buildPaymentDetails,
  recordChase,
  clearChase,
  isDoubleSendBlocked,
  getChaseState,
  lastChasedLabel,
} from '../lib/chaseLadder';

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
  // Canonical status field takes priority — short-circuit before any subordinate
  // field checks so residual jobStatus/paymentStatus from a previous Paid state
  // cannot override a deliberate stage move.
  if (job.status === 'lead') return 'Lead';
  if (job.status === 'quoted') return 'Quoted';
  if (job.status === 'paid') return 'Paid';
  if (job.status === 'active') return 'On';
  if (job.status === 'complete') return 'On';
  if (job.status === 'invoice_sent') {
    if (isOverdue(job)) return 'Overdue';
    return 'Invoiced';
  }
  // Subordinate field fallbacks — for legacy jobs that pre-date the canonical
  // status column and for jobs written by older code paths.
  if (job.paid || job.paymentStatus === 'paid' || job.jobStatus === 'paid') return 'Paid';
  // Overdue must be checked before Invoiced — overdue takes priority
  if (job.invoiceStatus === 'invoiced') {
    if (isOverdue(job)) return 'Overdue';
    return 'Invoiced';
  }
  // complete-but-not-invoiced → On: work done, invoice not sent yet
  if (job.jobStatus === 'complete') return 'On';
  if (job.jobStatus === 'active') return 'On';
  return 'Lead';
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
 * Open WhatsApp share-sheet with a tiered chase message for a specific job.
 * Tier is derived from days-past-due-date (chaseLadder). Records the chase on open.
 * Returns false when blocked by 48h double-send guard.
 *
 * @param {object} job
 * @param {object|null} biz  — biz settings from WorkScreen props (may be null)
 * @returns {boolean} true if the share-sheet was opened
 */
function chaseJobTiered(job, biz = null) {
  if (isDoubleSendBlocked(job.id)) return false;

  const phone = job.customerPhone || job.phone || job.mobile || '';
  const outstanding = Number(job.total ?? job.amount ?? 0) || 0;
  const tier = computeTier(job);
  const daysOverdue = Math.max(0, daysPastDue(job));
  const paymentDetails = buildPaymentDetails(biz);

  const link = buildChaseLink({
    phone,
    customerName: job.customer || job.name || '',
    amount: '£' + formatAmount(outstanding),
    jobSummary: job.summary || '',
    dueDate: job.invoiceDueDate || null,
    daysOverdue,
    tier,
    amountPaid: 0,
    paymentDetails,
    businessName: biz?.name || '',
    isB2B: false,
  });

  // link is null when there's no phone — open wa.me without a recipient so the
  // user can pick the contact manually in WhatsApp.
  const finalUrl = link ?? `https://wa.me/?text=${encodeURIComponent(
    [
      `Hi ${job.customer || job.name || 'there'},`,
      `just chasing the invoice for £${formatAmount(outstanding)}`,
      daysOverdue > 0 ? `— now ${daysOverdue} days overdue.` : '.',
      paymentDetails || '',
      biz?.name || '',
    ].filter(Boolean).join(' ')
  )}`;

  window.open(finalUrl, '_blank', 'noopener');
  recordChase(job.id);
  return true;
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
 * StageChipDropdown — read-only stage label + ⋯ overflow trigger.
 *
 * The stage label (coloured pill) is now purely informational — no click handler.
 * The ⋯ button (top-right of header) is the sole menu trigger.
 *
 * Desktop (>640px): anchored dropdown beneath the ⋯ button.
 * Mobile (≤640px):  bottom-sheet over a dim backdrop — never buries tiles.
 *
 * "Move to" is a single row of 6 colour swatches (one-tap restage).
 * "More actions" is 4 compact chips below a divider.
 * All moveToStage() mapping logic is unchanged.
 */
function StageChipDropdown({ job, currentStage, onUpdateJob, onSendInvoice, onSelect, onOpenJob, onCopyJob, onArchiveJob, onDeleteJob }) {
  const [open, setOpen] = useState(false);
  const chipRef = useRef(null);
  const menuRef = useRef(null);

  // Close on outside click / backdrop tap and Escape key
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (
        chipRef.current && !chipRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const meta = STAGE_META[currentStage] || STAGE_META.Lead;
  const ink = meta.ink || meta.hue;

  function moveToStage(stage) {
    setOpen(false);
    if (!onUpdateJob) return;
    // Guard: a price is required to enter any money-claiming stage,
    // regardless of source. On is NOT money-claiming — a job can move
    // to On without a price (work started before pricing was agreed).
    if (requiresPriceForStage(job, stage)) {
      onOpenJob?.(job, { intent: 'price', targetStage: stage });
      return;
    }
    // stagePatch is the single source of truth (exported from jobStatus.js).
    const patch = stagePatch(stage);
    onUpdateJob({ ...job, ...patch });
  }

  function handleAction(action) {
    setOpen(false);
    switch (action) {
      case 'Edit':
        onSelect?.(job);
        break;
      case 'Duplicate':
        onCopyJob?.(job);
        break;
      case 'Archive':
        onArchiveJob?.(job);
        break;
      case 'Delete':
        // Opens confirmation modal in WorkScreen — hard-delete on confirm.
        onDeleteJob?.(job);
        break;
      default:
        break;
    }
  }

  const customerLabel = job.customer || job.name || 'Job';

  // Shared menu content used in both the dropdown and the bottom-sheet
  const menuContent = (
    <>
      <div className="jt-menu-label">Move to</div>
      {/* One-tap restage: 6 colour swatches in a single row */}
      <div className="jt-menu-swatches" role="group" aria-label="Move to stage">
        {STAGES.map(s => {
          const sMeta = STAGE_META[s];
          const isCurrent = s === currentStage;
          // Short display labels to fit 6 swatches at 375px
          const shortLabel = { Lead: 'Lead', Quoted: 'Quote', On: 'On', Invoiced: 'Inv', Overdue: 'Over', Paid: 'Paid' }[s] ?? s;
          return (
            <button
              key={s}
              type="button"
              className={`jt-swatch${isCurrent ? ' jt-swatch--current' : ''}`}
              style={{ '--sw-hue': sMeta.hue }}
              role="menuitem"
              aria-pressed={isCurrent}
              onClick={() => moveToStage(s)}
            >
              <span className="jt-swatch-dot">
                {isCurrent && (
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
                    <path d="M2 5.5l2.5 2.5 4.5-4.5"/>
                  </svg>
                )}
              </span>
              <span className="jt-swatch-label">{shortLabel}</span>
            </button>
          );
        })}
      </div>
      <div className="jt-menu-divider" />
      {/* Compact action chips */}
      <div className="jt-menu-actions" role="group" aria-label="More actions">
        {[
          { key: 'Edit',      label: 'Edit' },
          { key: 'Duplicate', label: 'Copy' },
          { key: 'Archive',   label: 'Archive' },
          { key: 'Delete',    label: 'Delete', danger: true },
        ].map(a => (
          <button
            key={a.key}
            type="button"
            className={`jt-action-chip${a.danger ? ' jt-action-chip--danger' : ''}`}
            role="menuitem"
            onClick={() => handleAction(a.key)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
      {/* Dim backdrop for mobile bottom-sheet — tapping it closes the menu */}
      {open && (
        <div
          className="jt-backdrop"
          aria-hidden="true"
          onClick={e => { e.stopPropagation(); setOpen(false); }}
        />
      )}

      {/* Wrapper holds the read-only label + ⋯ trigger; gives the dropdown its anchor */}
      <div ref={chipRef} className="jt-chip-wrapper">
        {/* Read-only stage label — coloured pill, no interaction */}
        <span
          className={`jt-stage-label jt-stage-label--${currentStage.toLowerCase()}`}
          style={{ '--chip-hue': meta.hue, '--chip-fill': meta.fill, '--chip-ink': ink }}
          aria-label={`Stage: ${currentStage}`}
        >
          {currentStage}
        </span>

        {/* ⋯ overflow button — sole menu trigger */}
        <button
          type="button"
          className="jt-dots"
          aria-label="Job options"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="8" cy="3" r="1.4"/>
            <circle cx="8" cy="8" r="1.4"/>
            <circle cx="8" cy="13" r="1.4"/>
          </svg>
        </button>

        {open && (
          <>
            {/* Desktop anchored dropdown — hidden on mobile via CSS.
                ref={menuRef} used by click-outside guard on desktop. */}
            <div
              ref={menuRef}
              className="jt-menu jt-menu--dropdown"
              role="menu"
              onClick={e => e.stopPropagation()}
            >
              {menuContent}
            </div>

            {/* Mobile bottom-sheet — hidden on desktop via CSS.
                Backdrop (.jt-backdrop) handles the outside-tap close on mobile
                so no separate ref needed here. */}
            <div
              className="jt-menu jt-menu--sheet"
              role="menu"
              onClick={e => e.stopPropagation()}
            >
              <div className="jt-sheet-grab" aria-hidden="true" />
              <div className="jt-sheet-title">Move {customerLabel} to</div>
              {menuContent}
            </div>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Stage-appropriate CTA config — wired to real WorkScreen handlers.
 * Invoiced + Overdue use chaseLadder for tiered WhatsApp messages.
 */
function getStageCTA(stage, job, { onSendInvoice, onUpdateJob, onNewJob, onOpenJob, biz }) {
  switch (stage) {
    case 'Lead':
      return {
        label: 'Send quote →',
        mod: null,
        phoneBtn: false,
        // Opens this job's drawer with quote intent — if unpriced, the price
        // field opens automatically; after entering the price, Send quote link
        // CTA is ready for one deliberate tap.
        action: () => onOpenJob?.(job, { intent: 'quote' }),
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

    case 'Invoiced': {
      const blocked = isDoubleSendBlocked(job.id);
      return {
        label: blocked ? 'Chased today' : 'Chase payment',
        mod: 'ghost',
        phoneBtn: false,
        disabled: blocked,
        action: () => { if (!blocked) chaseJobTiered(job, biz); },
      };
    }

    case 'Overdue': {
      const blocked = isDoubleSendBlocked(job.id);
      return {
        label: blocked ? 'Chased today' : 'Chase payment →',
        mod: blocked ? 'muted' : 'urgent',
        phoneBtn: !blocked,
        disabled: blocked,
        action: () => { if (!blocked) chaseJobTiered(job, biz); },
      };
    }

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
 * JobTile — slim 3-row tile (PRD redesign 2026-05-28).
 *
 * Row 1 (header):  job name (primary, big) · stage label (read-only) · ⋯ button
 * Row 1b:          customer name (secondary, muted) — only when non-empty
 * Row 2 (£):       price on its own line
 * Row 3 (signals): time signal · money state · photo/note counts (· separated)
 * CTA row:         full-width, stage-aware, ≥44px, unchanged logic
 *
 * Avatar circle removed (2026-05-29). Job name promoted to primary label.
 * Customer demoted to secondary line; falls back: if summary empty, customer
 * becomes the primary label so the tile is never a bare "Untitled job".
 */
function JobTile({ job, onSelect, onSendInvoice, onUpdateJob, onNewJob, onOpenJob, onCopyJob, onArchiveJob, onDeleteJob, biz }) {
  const stage = deriveDisplayStatus(job);
  const isPaid = stage === 'Paid';

  const timeSignal = deriveTimeSignal(job, stage);
  const photoCount = Array.isArray(job.photos) ? job.photos.length : 0;
  const noteCount = Array.isArray(job.jobNotes) ? job.jobNotes.length : (job.notes ? 1 : 0);
  const moneySub = deriveMoneySub(job, stage);

  const rawAmount = job.total ?? job.amount;
  const amount = rawAmount != null ? Number(rawAmount) : null;
  const isUnpriced = amount == null || amount <= 0;
  const formattedAmount = !isUnpriced ? '£' + formatAmount(amount) : null;
  // Lead with no price gets "No price yet"; other un-priced stages show "—" as before
  const priceLine = (stage === 'Lead' && isUnpriced) ? 'No price yet' : (formattedAmount ?? '—');
  const amountMuted = stage === 'Lead' || isUnpriced;
  const amountOverdue = stage === 'Overdue';

  // Primary / secondary label logic:
  // - If job has a name (summary), it's the big primary line; customer drops to secondary.
  // - If summary is empty but customer exists, customer becomes the primary so the tile
  //   never shows "Untitled job" when a recognisable label is available.
  const jobName = (job.summary || '').trim();
  const customerName = (job.customer || job.name || '').trim();
  const primaryLabel = jobName || customerName || 'Untitled job';
  // Only show customer on the secondary line when it's non-empty AND distinct from the
  // primary label — prevents duplicating the job name when no separate customer was entered.
  const secondaryLabel = (jobName && customerName && customerName !== jobName) ? customerName : '';

  const cta = getStageCTA(stage, job, { onSendInvoice, onUpdateJob, onNewJob, onOpenJob, biz });
  const stageMeta = STAGE_META[stage] || STAGE_META.Lead;

  // "Last chased" chip — shown on Invoiced and Overdue tiles after a chase is recorded
  const chaseState = (stage === 'Invoiced' || stage === 'Overdue') ? getChaseState(job.id) : null;
  const chasedChip = lastChasedLabel(chaseState);

  // Build signal line items (Row 3) — separated by · in CSS
  const signals = [];
  if (timeSignal) signals.push({ text: timeSignal.text, cls: `jt-signal--${timeSignal.variant}` });
  if (moneySub)   signals.push({ text: moneySub, cls: 'jt-signal--mute' });
  if (photoCount > 0) signals.push({ text: null, photoCount });
  if (noteCount > 0)  signals.push({ text: null, noteCount });

  return (
    <li
      className={`jt jt--${stage.toLowerCase()}`}
      style={{
        '--jt-hue': stageMeta.hue,
        '--jt-fill': stageMeta.fill,
        '--jt-ink': stageMeta.ink || stageMeta.hue,
        opacity: isPaid ? 0.7 : 1,
        position: 'relative',
      }}
      onClick={() => onSelect?.(job)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(job); }}
      aria-label={`View details for ${primaryLabel}`}
    >
      {/* Row 1: job name (primary) + [stage label (read-only) + ⋯ trigger] */}
      <div className="jt-head" onClick={e => e.stopPropagation()}>
        <h3 className="jt-title">
          {primaryLabel.slice(0, 72)}{primaryLabel.length > 72 ? '…' : ''}
        </h3>
        <StageChipDropdown
          job={job}
          currentStage={stage}
          onUpdateJob={onUpdateJob}
          onSendInvoice={onSendInvoice}
          onSelect={onSelect}
          onOpenJob={onOpenJob}
          onCopyJob={onCopyJob}
          onArchiveJob={onArchiveJob}
          onDeleteJob={onDeleteJob}
        />
      </div>

      {/* Row 1b: customer name (secondary) — only shown when non-empty */}
      {secondaryLabel ? (
        <div className="jt-customer">{secondaryLabel}</div>
      ) : null}
      {/* Row 2b: price on its own line, directly under title */}
      <div className={`jt-price${amountMuted ? ' jt-price--muted' : ''}${amountOverdue ? ' jt-price--overdue' : ''}`}>
        {priceLine}
      </div>

      {/* Row 3: one merged signal line — time · money state · counts */}
      {signals.length > 0 && (
        <div className="jt-signals">
          {signals.map((sig, i) => (
            <span key={i} className="jt-signal-group">
              {i > 0 && <span className="jt-meta-sep">·</span>}
              {sig.photoCount != null ? (
                <span className={`jt-meta-item${sig.cls ? ' ' + sig.cls : ''}`}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <rect x="1.5" y="2.5" width="9" height="7" rx="1"/>
                    <circle cx="6" cy="6" r="1.5"/>
                  </svg>
                  {sig.photoCount}
                </span>
              ) : sig.noteCount != null ? (
                <span className={`jt-meta-item${sig.cls ? ' ' + sig.cls : ''}`}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M2 2h6l2 2v6H2z"/>
                    <path d="M3.5 5h5M3.5 7h5"/>
                  </svg>
                  {sig.noteCount}
                </span>
              ) : (
                <span className={`jt-meta-item${sig.cls ? ' ' + sig.cls : ''}`}>{sig.text}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* CTA row — stopPropagation so taps don't open the drawer */}
      {cta && (
        <div className="jt-foot" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            className={`jt-cta${cta.mod ? ` jt-cta--${cta.mod}` : ''}`}
            onClick={cta.action}
            disabled={!!cta.disabled}
            aria-disabled={!!cta.disabled}
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
          {chasedChip && (
            <span className="jt-chased-chip">{chasedChip}</span>
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

function JobsList({ jobs, selectedStage, showAll, onJobSelect, onSendInvoice, onUpdateJob, onNewJob, onOpenJob, onCopyJob, onArchiveJob, onDeleteJob, biz }) {
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
              onOpenJob={onOpenJob}
              onCopyJob={onCopyJob}
              onArchiveJob={onArchiveJob}
              onDeleteJob={onDeleteJob}
              biz={biz}
            />
          ))}
        </ul>
      )}
    </>
  );
}

// ── WorkScreen (root) ─────────────────────────────────────────────────────────

export default function WorkScreen({ jobs = [], receipts = [], onNewJob, onAddJob, onAddPayment, onUpdateJob, onDeleteJob, onAddReceipt, onDeleteReceipt, biz, profile }) {
  const [subview, setSubview] = useState(getPersistedView);
  const [selectedStage, setSelectedStage] = useState('On');
  const [showAll, setShowAll] = useState(false);
  // selectedJob drives the JobDetailDrawer — null means closed.
  const [selectedJob, setSelectedJob] = useState(null);
  // drawerIntent / drawerTargetStage — set when opening the drawer with a goal
  // (e.g. tile CTA "Send quote →" or stage-advance guard). Cleared after use.
  const [drawerIntent, setDrawerIntent] = useState(null);
  const [drawerTargetStage, setDrawerTargetStage] = useState(null);
  // invoiceJob drives the SendInvoiceModal from the "Send invoice →" Advance Button.
  const [invoiceJob, setInvoiceJob] = useState(null);
  const [toast, setToast] = useState('');
  // addJobOpen drives the inline AddJobModal — same pattern as TodayScreen.
  const [addJobOpen, setAddJobOpen] = useState(false);
  // chaseStepIndex — tracks which job to nudge next in the batch-chase flow
  const [chaseStepIndex, setChaseStepIndex] = useState(0);
  // confirmDeleteJob — job pending hard-delete confirmation; null = modal closed.
  const [confirmDeleteJob, setConfirmDeleteJob] = useState(null);

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

  // Exclude archived and deleted jobs from every rendered surface in this screen.
  // This single derivation feeds StageStrip totals, the chase bar, and JobsList
  // so counts and £ figures all agree.
  const visibleJobs = jobs.filter(j => !j?.archived && !j?.meta?.archived && !j?.deleted && !j?.meta?.deleted);

  // Money-in-flight banner figures
  const riskFigures = calcRiskFigures(visibleJobs);
  const oldestOverdue = riskFigures.overdueJobs[0] ?? null;

  // Batch nudge: overdue jobs that are NOT blocked by the 48h guard
  const chasableJobs = riskFigures.overdueJobs.filter(j => !isDoubleSendBlocked(j.id));

  const handleChase = () => {
    if (!oldestOverdue) return;
    chaseJobTiered(oldestOverdue, biz);
  };

  // Batch chase: step through chasable jobs one tap at a time.
  // Each tap opens the correctly-tiered WhatsApp message; the human fires the send.
  const handleBatchChaseStep = () => {
    const safeIndex = chaseStepIndex % Math.max(chasableJobs.length, 1);
    const job = chasableJobs[safeIndex];
    if (!job) return;
    const opened = chaseJobTiered(job, biz);
    if (opened) {
      setChaseStepIndex(safeIndex + 1);
      showToast(`Chased ${job.customer || job.name || 'Invoice'}`);
    }
  };

  const handleJobSave = (job) => {
    setAddJobOpen(false);
    onAddJob?.(job);
    showToast('Job saved');
  };

  const openAddJob = () => setAddJobOpen(true);

  // Wraps onUpdateJob to fire a confirmation toast when a job is moved to Paid
  // via the stage-chip dropdown. JobDetailDrawer has its own showFlash for the
  // drawer path; this covers the tile path where no other feedback fires.
  const handleUpdateJob = (updated) => {
    const prev = jobs.find(j => j.id === updated.id);
    const becomingPaid = updated.paid === true && !(prev?.paid === true || prev?.paymentStatus === 'paid');
    if (becomingPaid) {
      const amt = Number(updated.total ?? updated.amount ?? 0) || 0;
      showToast(amt > 0 ? `£${formatAmount(amt)} marked paid` : 'Job marked paid');
    }
    onUpdateJob?.(updated);
  };

  // Opens a job's drawer with an optional intent (e.g. 'quote', 'price').
  // Called by tile CTAs and the stage-advance guard in StageChipDropdown.
  const handleOpenJob = (job, opts) => {
    setSelectedJob(job);
    setDrawerIntent(opts?.intent ?? null);
    setDrawerTargetStage(opts?.targetStage ?? null);
  };

  // Duplicates a job as a new Lead, carrying customer + price details but
  // resetting all invoice/payment/date fields. Delegates to onAddJob (AppShell)
  // so the existing cloud write + localStorage dual-write path is reused.
  const handleCopyJob = (job) => {
    const payload = {
      customer: job.customer || job.name || '',
      name: job.summary || job.customer || job.name || 'Job',
      summary: job.summary || '',
      phone: job.phone || '',
      email: job.email || '',
      address: job.address || '',
      notes: job.notes || '',
      amount: job.total ?? job.amount ?? null,
      lineItems: job.lineItems ?? [],
      // Reset to Lead — no payment, no invoice signals
      paid: false,
      status: 'lead',
      invoiceStatus: null,
      paidAt: null,
      invoiceSentAt: null,
      invoiceDueDate: null,
      overdue: false,
      source: 'Copy',
    };
    onAddJob?.(payload);
    showToast('Job copied');
  };

  // Archives a job by setting meta.archived and stamping meta.archivedAt.
  // The job stays in the DB — a future "Archived" view will let users restore it.
  const handleArchiveJob = (job) => {
    handleUpdateJob({
      ...job,
      archived: true,
      meta: { ...(job.meta || {}), archived: true, archivedAt: new Date().toISOString() },
    });
    showToast('Job archived');
  };

  // Opens the confirmation modal. The actual hard-delete fires on confirm.
  const handleRequestDeleteJob = (job) => {
    setConfirmDeleteJob(job);
  };

  // Confirmed hard-delete — removes the row from Supabase and local state.
  // Storage objects in meta.photos[] are left for a follow-up cleanup task.
  const handleConfirmDeleteJob = async () => {
    const job = confirmDeleteJob;
    setConfirmDeleteJob(null);
    if (!job) return;
    try {
      await deleteJobFromCloud(job.id);
      onDeleteJob?.(job.id);
      showToast('Job deleted');
    } catch (err) {
      console.error('handleConfirmDeleteJob failed', err);
      showToast('Delete failed — try again');
    }
  };

  return (
    <div className="screen work-screen">
      {/* Header */}
      <div className="screen-header">
        <h1 className="screen-title">Jobs</h1>
        <div className="screen-header-right">
          <button className="new-btn" onClick={openAddJob}>+ New job</button>
        </div>
      </div>

      {/* Overdue chase bar — only rendered when at least one job is Overdue.
           At rest (invoiced but nothing overdue) the StageStrip alone carries that info. */}
      {riskFigures.overdueJobs.length > 0 && (
        <div
          className="chase-bar"
          role="region"
          aria-live="polite"
          aria-label={`${riskFigures.overdueJobs.length === 1 ? '1 overdue invoice' : `${riskFigures.overdueJobs.length} overdue invoices`}`}
        >
          <div className="chase-bar-left">
            <span className="chase-bar-amount">£{formatAmount(riskFigures.overdue)}</span>
            <span className="chase-bar-label">
              {' '}overdue · {riskFigures.overdueJobs.length === 1 ? '1 invoice' : `${riskFigures.overdueJobs.length} invoices`}
            </span>
          </div>
          <button
            type="button"
            className="chase-bar-btn"
            onClick={handleBatchChaseStep}
            aria-label={`Chase ${riskFigures.overdueJobs.length === 1 ? '1 overdue invoice' : `${riskFigures.overdueJobs.length} overdue invoices`}`}
          >
            Chase →
          </button>
        </div>
      )}


      {/* Stage Strip — deriveStatus + formatAmount passed as props (avoids circular import) */}
      <StageStrip
        jobs={visibleJobs}
        selectedStage={selectedStage}
        showAll={showAll}
        onSelectStage={handleSelectStage}
        deriveStatus={deriveDisplayStatus}
        formatAmount={formatAmount}
      />

      {/* Batch-chase nudge bar — shown on Overdue stage when there are un-chased jobs.
           Each tap opens the next job's correctly-tiered WhatsApp message one at a time.
           The app never sends autonomously — the human taps send in WhatsApp. */}
      {selectedStage === 'Overdue' && !showAll && chasableJobs.length > 0 && (
        <div className="chase-nudge-bar" role="region" aria-label="Chase nudge">
          <span className="chase-nudge-text">
            {chasableJobs.length === 1
              ? '1 invoice needs chasing'
              : `${chasableJobs.length} invoices need chasing`}
          </span>
          <button
            type="button"
            className="chase-nudge-btn"
            onClick={handleBatchChaseStep}
          >
            Chase next →
          </button>
        </div>
      )}

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
          {showAll ? 'Stage view' : 'Show all'}
        </button>
      </div>

      {/* Subview */}
      {subview === 'list' ? (
        <JobsList
          jobs={visibleJobs}
          selectedStage={selectedStage}
          showAll={showAll}
          onJobSelect={setSelectedJob}
          onSendInvoice={setInvoiceJob}
          onUpdateJob={handleUpdateJob}
          onNewJob={onNewJob}
          onOpenJob={handleOpenJob}
          onCopyJob={handleCopyJob}
          onArchiveJob={handleArchiveJob}
          onDeleteJob={handleRequestDeleteJob}
          biz={biz}
        />
      ) : (
        <WorkCalendar jobs={visibleJobs} onNewJobOnDate={onNewJob} />
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
          onClose={() => { setSelectedJob(null); setDrawerIntent(null); setDrawerTargetStage(null); }}
          intent={drawerIntent}
          targetStage={drawerTargetStage}
          onClearIntent={() => { setDrawerIntent(null); setDrawerTargetStage(null); }}
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

      {/* Confirm-delete modal — minimal inline implementation (no reusable ConfirmModal exists yet) */}
      {confirmDeleteJob && (
        <div className="modal-backdrop" onClick={() => setConfirmDeleteJob(null)}>
          <div
            className="modal-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-modal-title"
            aria-describedby="delete-modal-body"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="delete-modal-title" className="modal-card-title">Delete this job?</h2>
            <p id="delete-modal-body" className="modal-card-body">This can&apos;t be undone.</p>
            <div className="modal-card-actions">
              <button
                type="button"
                className="modal-btn modal-btn--secondary"
                onClick={() => setConfirmDeleteJob(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--danger"
                onClick={handleConfirmDeleteJob}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
