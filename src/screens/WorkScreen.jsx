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
 * Note: WorkScreen is the single canonical "Jobs" tab. The legacy JobsScreen stub was
 * deleted in the stage-consolidation PR; stage derivation now lives solely in lib/jobStatus.js.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../components/Icon';
import {
  recordCall,
  consumeCallRecord,
  clearCallRecord,
  shouldShowCallPayPrompt,
} from '../lib/callPayPrompt';
// WorkCalendar import removed (JP-LU5 PR1) — file kept on disk for future Plan-Mode feature.
import AddJobModal from '../components/AddJobModal';
import JobDetailDrawer from '../components/JobDetailDrawer';
import DrawerErrorBoundary from '../components/DrawerErrorBoundary';
import ReviewSheet from '../components/ReviewSheet';
import StageStrip from '../components/StageStrip';
import DocumentSearchOverlay from '../components/DocumentSearchOverlay';
import { logTelemetry } from '../lib/telemetry';
import { deriveDisplayStatus, requiresPriceForStage, stagePatch } from '../lib/jobStatus';
import { deleteJobWithData } from '../lib/store';
import { buildDeleteJobCopy } from '../lib/deleteJobCopy';
import { shouldShowPartPaidChip, formatPartPaidLabel } from '../lib/partPaidChip';
// JP-LU5 PR1: sortJobsByColumn, daysInStage removed from WorkScreen import —
// call sites in JobsTable deleted. Both are still exported from lib/jobSort.js.
import { jobMatchesQuery, sortJobsByStage, sortJobsForAllView, firstLineOfAddress } from '../lib/jobSort';
// JobProgressDots replaced by WorkflowCircles (feat/ohnar-six-stage-workflow)
import WorkflowCircles from '../components/WorkflowCircles';
import OhnarWordmark from '../components/OhnarWordmark';
// JP-LU5 PR1: ProGate and isPro imports removed — only used in JobsTable (deleted).
import ReceiptModal from '../components/ReceiptModal';
import {
  computeTier,
  daysPastDue,
  daysUntilDue,
  buildChaseLink,
  buildChaseMessage,
  buildPaymentDetails,
  recordChase,
  recordChaseCloud,
  isDoubleSendBlocked,
  DEFAULT_PAYMENT_TERMS_DAYS,
} from '../lib/chaseLadder';
import { supabase } from '../lib/supabase';
// JP-LU5 PR1: deriveJobRows removed from WorkScreen — was only used in JobsTable.

// JP-LU5 PR1: STORAGE_KEY ('jp.workView'), LAYOUT_STORAGE_KEY, LAYOUT_COACHMARK_KEY,
// SORT_STORAGE_KEY, VALID_SORT_COLUMNS, and DEFAULT_DIR removed — calendar and
// table-layout surfaces deleted. Existing 'calendar' localStorage values are
// harmless (subview state gone; card view is always rendered).
const FILTER_STORAGE_KEY = 'jp.workscreen.filter.v1';

// Valid stage keys — used to validate persisted selectedStage values.
const VALID_STAGES = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];

// JP-LU5 PR1: getPersistedView/persistView, getPersistedLayout/persistLayout,
// getCoachmarkSeen/markCoachmarkSeen, getPersistedSort/persistSort removed.

/**
 * Lazy-init helper for the stage filter state.
 * Reads {selectedStage, showAll} from localStorage under FILTER_STORAGE_KEY.
 * Falls back to defaults ('On', false) if absent, malformed, or if
 * selectedStage is not one of the six valid stage keys.
 */
function getPersistedFilter() {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const stage = parsed.selectedStage;
      const all = parsed.showAll;
      if (VALID_STAGES.includes(stage)) {
        return { selectedStage: stage, showAll: !!all };
      }
    }
  } catch {
    // malformed JSON or localStorage unavailable — fall back to defaults
  }
  return { selectedStage: 'On', showAll: false };
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
 * @param {number|null} forceTier
 * @param {string} payNowUrl  — pre-fetched Pay-now URL for connected traders (empty = skip)
 * @returns {boolean} true if the share-sheet was opened
 */
function chaseJobTiered(job, biz = null, forceTier = null, payNowUrl = '') {
  if (isDoubleSendBlocked(job.id)) return false;

  const phone = job.customerPhone || job.phone || job.mobile || '';
  const outstanding = Number(job.total ?? job.amount ?? 0) || 0;
  const rawTier = forceTier !== null ? forceTier : computeTier(job);

  // Grace window: job just flipped Overdue — 24h silent period, no chase surfaced.
  if (rawTier === 'grace') return false;
  const tier = rawTier;
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
    payNowUrl,
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
  // Cloud sync is fire-and-forget — localStorage tap is already recorded above.
  recordChaseCloud(job.id, supabase).catch(console.warn);
  return true;
}

/**
 * Canonical phone resolver — single source so tile and getStageCTA always agree.
 */
function resolvePhone(job) {
  return job.customerPhone || job.phone || job.mobile || '';
}

/**
 * Canonical address resolver — job.address is the primary field.
 */
function resolveAddress(job) {
  return job.address || '';
}

// jobMatchesQuery, sortJobsByStage, firstLineOfAddress imported from ../lib/jobSort.

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
// Token mapping: values marked ✓ are byte-identical to their token in all themes.
// Values marked ✗ have no exact token match and are intentionally left as hex.
const STAGE_META = {
  Lead:     { hue: 'var(--jp-blue)',       fill: 'var(--stage-fill-lead)',     ink: null },
  Quoted:   { hue: 'var(--grn-quoted)',    fill: '#7FDFB4',                    ink: '#1E8A5C' },               // fill + ink: no CSS token exists; kept as-is
  On:       { hue: 'var(--grn-on)',        fill: 'var(--stage-fill-on)',       ink: null },
  Invoiced: { hue: 'var(--grn-invoiced)', fill: 'var(--stage-fill-invoiced)', ink: null },
  Overdue:  { hue: 'var(--danger)',        fill: 'var(--stage-fill-overdue)',  ink: null },
  Paid:     { hue: 'var(--grn-paid)',      fill: 'var(--stage-fill-paid)',     ink: 'var(--grn-quoted)' },
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
function StageChipDropdown({ job, currentStage, onUpdateJob, _onSendInvoice, onSelect, onOpenJob, onCopyJob, onArchiveJob, onDeleteJob, onShowToast }) {
  const [open, setOpen] = useState(false);
  const chipRef = useRef(null);
  const menuRef = useRef(null);
  const sheetRef = useRef(null);
  const dotsRef = useRef(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  // Close on outside click / backdrop tap and Escape key
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      // Guard both the desktop dropdown (menuRef) AND the mobile sheet (sheetRef).
      // Without sheetRef, touchstart on a chip inside the sheet passes the
      // contains() check, closes the sheet, and the click event fires on an
      // unmounted node — making every interaction appear dead on mobile.
      const insideMenu  = menuRef.current  && menuRef.current.contains(e.target);
      const insideSheet = sheetRef.current && sheetRef.current.contains(e.target);
      if (
        chipRef.current && !chipRef.current.contains(e.target) &&
        !insideMenu && !insideSheet
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
    // Guard 1: a price is required to enter any money-claiming stage,
    // regardless of source. On is NOT money-claiming — a job can move
    // to On without a price (work started before pricing was agreed).
    if (requiresPriceForStage(job, stage)) {
      onOpenJob?.(job, { intent: 'price', targetStage: stage });
      return;
    }
    // Guard 2: Overdue is only reachable from Invoiced. Moving to Overdue from
    // any other stage means no invoice has been sent yet, so the stage is
    // nonsensical. Swatch is kept tappable (not pointer-events:none) so this
    // toast fires and teaches the rule.
    if (stage === 'Overdue' && currentStage !== 'Invoiced') {
      onShowToast?.('Send the invoice first — Overdue is only for invoiced jobs');
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

  // Shared menu content used in both the dropdown and the bottom-sheet.
  // The contextual heading ("Move Enel to") is rendered here so both mobile
  // sheet and desktop dropdown receive it. The standalone .jt-sheet-title that
  // was above menuContent in the mobile sheet has been removed to avoid duplication.
  const menuContent = (
    <>
      <div className="jt-sheet-title">Move {customerLabel} to</div>
      {/* One-tap restage: 6 colour swatches in a single row */}
      <div className="jt-menu-swatches" role="group" aria-label="Move to stage">
        {STAGES.map(s => {
          const sMeta = STAGE_META[s];
          const isCurrent = s === currentStage;
          // Overdue swatch is visually disabled when source stage is not Invoiced —
          // kept tappable so the guard toast fires and teaches the user the rule.
          const isOverdueBlocked = s === 'Overdue' && currentStage !== 'Invoiced';
          // Short display labels to fit 6 swatches at 375px
          const shortLabel = { Lead: 'Lead', Quoted: 'Quote', On: 'On', Invoiced: 'Inv', Overdue: 'Over', Paid: 'Paid' }[s] ?? s;
          return (
            <button
              key={s}
              type="button"
              className={`jt-swatch${isCurrent ? ' jt-swatch--current' : ''}${isOverdueBlocked ? ' jt-swatch--disabled' : ''}`}
              style={{ '--sw-hue': sMeta.hue, ...(isOverdueBlocked ? { opacity: 0.35 } : {}) }}
              role="menuitem"
              aria-pressed={isCurrent}
              aria-disabled={isOverdueBlocked || undefined}
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
      {/* Dim backdrop for mobile bottom-sheet — portalled to body so it escapes
          the .jt tile's stacking context (same reason the dropdown is portalled).
          Without the portal, fixed-position children of a position:relative tile
          are clipped to that tile's stacking context and paint behind later
          sibling tiles, even with a high z-index. */}
      {open && createPortal(
        <div
          className="jt-backdrop"
          aria-hidden="true"
          onClick={e => { e.stopPropagation(); setOpen(false); }}
        />,
        document.body
      )}

      {/* Wrapper holds the read-only label + ⋯ trigger; gives the dropdown its anchor */}
      <div ref={chipRef} className="jt-chip-wrapper">
        {/* Read-only stage name — plain low-emphasis text, no coloured pill.
            WorkflowCircles circles carry the stage colour; the label just names it.
            Invoiced and Overdue get a shape glyph so colour-blind users and
            people in bright sun can tell them apart without relying on hue alone. */}
        <span
          className={`jt-stage-name jt-stage-name--${currentStage.toLowerCase()}`}
          aria-label={`Stage: ${currentStage}`}
        >
          {currentStage === 'Invoiced' && (
            <Icon name="receipt" size={11} variant="inherit" aria-hidden="true" />
          )}
          {currentStage === 'Overdue' && (
            <Icon name="warning" size={11} variant="inherit" aria-hidden="true" />
          )}
          {currentStage}
        </span>

        {/* ⋯ overflow button — sole menu trigger */}
        <button
          ref={dotsRef}
          type="button"
          className="jt-dots"
          aria-label="Job options"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={e => {
            e.stopPropagation();
            if (!open && dotsRef.current) {
              // Anchor dropdown to the button's viewport rect.
              // Portal renders into body so fixed positioning is safe across
              // any stacking context created by parent tiles.
              const r = dotsRef.current.getBoundingClientRect();
              setMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
            }
            setOpen(v => !v);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (!open && dotsRef.current) {
                const r = dotsRef.current.getBoundingClientRect();
                setMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
              }
              setOpen(v => !v);
            }
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="8" cy="3" r="1.4"/>
            <circle cx="8" cy="8" r="1.4"/>
            <circle cx="8" cy="13" r="1.4"/>
          </svg>
        </button>

        {open && (
          <>
            {/* Desktop dropdown — portalled to body so it escapes any stacking
                context created by sibling tiles (each .jt has position:relative).
                Without the portal, tile N+1 in the DOM paints over the dropdown
                from tile N even when z-index is set, because sibling stacking
                contexts are ordered by DOM position, not z-index value. */}
            {createPortal(
              <div
                ref={menuRef}
                className="jt-menu jt-menu--dropdown"
                role="menu"
                style={{ top: menuPos.top, right: menuPos.right }}
                onClick={e => e.stopPropagation()}
              >
                {menuContent}
              </div>,
              document.body
            )}

            {/* Mobile bottom-sheet — portalled to body for the same stacking-
                context reason as the backdrop and the desktop dropdown above.
                CSS hides this variant on desktop (jt-menu--sheet display:none
                above the mobile breakpoint). */}
            {createPortal(
              <div
                ref={sheetRef}
                className="jt-menu jt-menu--sheet"
                role="menu"
                onClick={e => e.stopPropagation()}
              >
                <div className="jt-sheet-grab" aria-hidden="true" />
                {menuContent}
              </div>,
              document.body
            )}
          </>
        )}
      </div>
    </>
  );
}

/**
 * Stage-appropriate CTA config — wired to real WorkScreen handlers.
 * Invoiced + Overdue use chaseLadder for tiered WhatsApp messages.
 * Paid stage opens ReceiptModal via onViewReceipt.
 */
function getStageCTA(stage, job, { onSendInvoice, onUpdateJob, _onNewJob, onOpenJob, biz, onViewReceipt }) {
  switch (stage) {
    case 'Lead':
      return {
        label: 'Send quote',
        mod: null,
        // Opens this job's drawer with quote intent — if unpriced, the price
        // field opens automatically; after entering the price, Send quote link
        // CTA is ready for one deliberate tap.
        action: () => onOpenJob?.(job, { intent: 'quote' }),
      };

    case 'Quoted':
      return {
        label: 'Mark booked',
        mod: null,
        // Flips status to active — same behaviour as the old "Move to On →" button.
        action: () => onUpdateJob?.({ ...job, status: 'active' }),
      };

    case 'On':
      return {
        label: 'Send invoice',
        mod: null,
        action: () => { if (onSendInvoice) onSendInvoice(job); },
      };

    case 'Invoiced': {
      const blocked = isDoubleSendBlocked(job.id);
      return {
        label: blocked ? 'Chased today' : 'Chase payment',
        mod: blocked ? 'blocked' : 'urgent',
        disabled: blocked,
        markPaid: true, // 1G: surface Mark paid alongside Chase payment
        action: () => { if (!blocked) chaseJobTiered(job, biz); },
      };
    }

    case 'Overdue': {
      const blocked = isDoubleSendBlocked(job.id);
      return {
        label: blocked ? 'Chased today' : 'Chase payment',
        mod: blocked ? 'blocked' : 'urgent',
        disabled: blocked,
        markPaid: true, // 1G: surface Mark paid alongside Chase payment
        action: () => { if (!blocked) chaseJobTiered(job, biz); },
      };
    }

    case 'Paid':
      return {
        label: 'View receipt',
        mod: null,
        action: () => onViewReceipt?.(job),
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
function JobTile({ job, onSelect, onSendInvoice, onUpdateJob, onNewJob, onOpenJob, onCopyJob, onArchiveJob, onDeleteJob, biz, onShowToast, onViewReceipt, onActionRedirect, onCallJob }) {
  const stage = deriveDisplayStatus(job);
  const isPaid = stage === 'Paid';

  const timeSignal = deriveTimeSignal(job, stage);
  const moneySub = deriveMoneySub(job, stage);

  const rawAmount = job.total ?? job.amount;
  const amount = rawAmount != null ? Number(rawAmount) : null;
  const isUnpriced = amount == null || amount <= 0;
  const formattedAmount = !isUnpriced ? '£' + formatAmount(amount) : null;
  // Lead with no price gets "No price yet"; other un-priced stages show "—" as before
  const priceLine = (stage === 'Lead' && isUnpriced) ? 'No price yet' : (formattedAmount ?? '—');
  const amountMuted = isUnpriced;
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
  // 1E: First line of address appended to the secondary identity line.
  const addrLine = firstLineOfAddress(job.address);

  const cta = getStageCTA(stage, job, { onSendInvoice, onUpdateJob, onNewJob, onOpenJob, biz, onViewReceipt });
  const stageMeta = STAGE_META[stage] || STAGE_META.Lead;

  // Draft flag — shown before other signals when a draft exists
  const hasDraft = !!(job.quoteDraft || job.invoiceDraft);

  // Accepted-quote signal — shown on Quoted/On tiles when the customer has signed
  // Accepted-quote signals — two variants (PR 4):
  //   deposit paid:  "Accepted · deposit £135" (green pill)
  //   no deposit:    "Accepted · no deposit"    (grey pill)
  //   not accepted:  no accepted signal
  const isAccepted = (job.quoteStatus === 'accepted' || !!job.deposit_paid_at) && !!job.acceptedAt;
  const acceptedByName = (job.acceptedName || '').trim();
  const depositPaidOnAcceptance = !!job.deposit_paid_at;
  const depositAmountGbp = job.deposit_amount_pence > 0
    ? `£${(job.deposit_amount_pence / 100).toFixed(0)}`
    : (job.deposit_percent > 0 && (job.total ?? job.amount))
      ? `£${Math.round((job.total ?? job.amount) * job.deposit_percent / 100)}`
      : '';

  // Part-paid chip — shown on Invoiced/Overdue tiles when money has been received
  // but the balance hasn't cleared. Uses computeAmountPaid + computeBalance from
  // payments.js — do not re-implement the math here.
  const partPaid = shouldShowPartPaidChip(job, stage);
  const partPaidLabel = partPaid ? formatPartPaidLabel(job) : null;

  // Card-paid signal — card_paid_at is set by the stripe-connect-webhook when
  // a customer pays by card. Shown on Paid tiles instead of the generic "Cleared"
  // money sub-line. Brief Section 2.4: "Paid by card · <time>" subtitle.
  const isCardPaid = isPaid && !!job.card_paid_at;
  let cardPaidLabel = null;
  if (isCardPaid) {
    try {
      const d = new Date(job.card_paid_at);
      const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });
      cardPaidLabel = `Paid by card · ${time}`;
    } catch {
      cardPaidLabel = 'Paid by card';
    }
  }

  // Build signal line items in priority order (1D).
  // Priority: card-paid > accepted-quote > part-paid > draft-ready > urgent/overdue time > generic signals.
  // We collect all candidates then show only the SINGLE highest-priority one.
  // Photo/note counts move to the drawer (removed from tile per 1D spec).
  const signalCandidates = [];
  if (cardPaidLabel) {
    signalCandidates.push({ text: cardPaidLabel, cls: 'jt-signal--ok' });
  }
  if (isAccepted) {
    let acceptedText;
    if (depositPaidOnAcceptance && depositAmountGbp) {
      // Accepted with deposit paid — green, shows amount
      acceptedText = `Accepted · deposit ${depositAmountGbp}`;
    } else if (isAccepted && !depositPaidOnAcceptance && (job.deposit_percent ?? 0) > 0) {
      // Accepted but no deposit (customer chose "Accept without deposit")
      acceptedText = acceptedByName ? `Accepted · no deposit` : 'Accepted · no deposit';
    } else {
      acceptedText = acceptedByName ? `Accepted by ${acceptedByName}` : 'Quote accepted';
    }
    const cls = depositPaidOnAcceptance ? 'jt-signal--ok' : 'jt-signal--accepted';
    signalCandidates.push({ text: acceptedText, cls });
  }
  if (partPaid) {
    signalCandidates.push({ text: partPaidLabel, cls: 'jt-signal--partpaid' });
  }
  if (hasDraft) {
    signalCandidates.push({ text: '● Draft ready', cls: 'jt-signal--draft' });
  }
  if (timeSignal && (timeSignal.variant === 'urgent' || timeSignal.variant === 'warn')) {
    signalCandidates.push({ text: timeSignal.text, cls: `jt-signal--${timeSignal.variant}` });
  }
  if (moneySub) {
    signalCandidates.push({ text: moneySub, cls: 'jt-signal--mute' });
  }
  if (timeSignal && timeSignal.variant !== 'urgent' && timeSignal.variant !== 'warn') {
    signalCandidates.push({ text: timeSignal.text, cls: `jt-signal--${timeSignal.variant}` });
  }
  // Show only the single highest-priority signal (first in the ordered array).
  const topSignal = signalCandidates[0] ?? null;

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
      {/* Row 1: job name (primary) + [stage label (read-only) + ⋯ trigger].
          No stopPropagation here — the dots button stops its own propagation and the
          stage label has pointer-events:none, so tapping the title correctly opens
          the drawer. Removing the outer stopPropagation was the fix for the
          "jobs not clickable" report (title tap was being silently swallowed). */}
      <div className="jt-head">
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
          onShowToast={onShowToast}
        />
      </div>

      {/* Row 1b: customer · address — shown when either is non-empty */}
      {(secondaryLabel || addrLine) ? (
        <div className="jt-customer">
          {secondaryLabel}
          {secondaryLabel && addrLine && <span className="jt-address"> · {addrLine}</span>}
          {!secondaryLabel && addrLine && <span className="jt-address">{addrLine}</span>}
        </div>
      ) : null}
      {/* Row 2: price + top signal on one row — shorter tile, signal pins right */}
      <div className="jt-pricerow">
        <div className={`jt-price${amountMuted ? ' jt-price--muted' : ''}${amountOverdue ? ' jt-price--overdue' : ''}`}>
          {priceLine}
        </div>
        {topSignal && (
          <span className={`jt-meta-item${topSignal.cls ? ' ' + topSignal.cls : ''}`}>{topSignal.text}</span>
        )}
      </div>

      {/* Row 2b: + Add details chip — Lead tiles missing customer, address, and notes.
          Persistent until ANY of those fields is filled. Tap opens the drawer (same as
          tapping the tile body). Condition mirrors the Speed-mode bare-minimum save:
          no customer, no address, no notes — the user can enrich via the drawer. */}
      {stage === 'Lead' && !job.customer && !resolveAddress(job) && !job.notes && (
        <button
          type="button"
          className="jt-add-details-chip"
          aria-label="Add details to this job"
          onClick={e => { e.stopPropagation(); onSelect?.(job); }}
        >
          + Add details
        </button>
      )}

      {/* Workflow circles — six-stage OHNAR progress visual (compact variant) */}
      <WorkflowCircles job={job} variant="compact" />

      {/* CTA row — stopPropagation so taps don't open the drawer */}
      {cta && (
        <div className="jt-foot" onClick={e => e.stopPropagation()}>
          {/* Call button — always shown. Dials if phone exists; redirects to edit if not. */}
          <button
            type="button"
            className={`jt-action-btn${!resolvePhone(job) ? ' jt-action-btn--missing' : ''}`}
            aria-label="Call customer"
            onClick={() => {
              const phone = resolvePhone(job);
              logTelemetry('tile_action_call', { hasData: !!phone, source: 'tile' });
              if (phone) {
                onCallJob?.(job);
                window.open(`tel:${phone}`, '_self');
              } else {
                onActionRedirect?.(job, 'phone');
              }
            }}
          >
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M4 3l2-1 2 3-1.5 1.5a8 8 0 0 0 4 4L12 9l3 2-1 2a2 2 0 0 1-2 1A11 11 0 0 1 3 5a2 2 0 0 1 1-2z"/>
            </svg>
            <span>Call</span>
          </button>
          {/* Map button — always shown. Opens Google Maps if address exists; redirects to edit if not. */}
          <button
            type="button"
            className={`jt-action-btn${!resolveAddress(job) ? ' jt-action-btn--missing' : ''}`}
            aria-label="Open in maps"
            onClick={() => {
              const addr = resolveAddress(job);
              logTelemetry('tile_action_map', { hasData: !!addr, source: 'tile' });
              if (addr) {
                window.open(`https://maps.google.com/?q=${encodeURIComponent(addr)}`, '_blank', 'noopener');
              } else {
                onActionRedirect?.(job, 'address');
              }
            }}
          >
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M9 1C6.24 1 4 3.24 4 6c0 4.25 5 11 5 11s5-6.75 5-11c0-2.76-2.24-5-5-5z"/>
              <circle cx="9" cy="6" r="1.8" fill="currentColor" stroke="none"/>
            </svg>
            <span>Map</span>
          </button>
          {/* Main stage-aware CTA — single CTA fills remaining space;
              dual CTA (Invoiced/Overdue) wrapped in jt-cta-pair so the
              pair grows as a unit then splits 50/50 internally. */}
          {cta.markPaid ? (
            <div className="jt-cta-pair">
              <button
                type="button"
                className={`jt-cta${cta.mod ? ` jt-cta--${cta.mod}` : ''}`}
                onClick={cta.action}
                disabled={!!cta.disabled}
                aria-disabled={!!cta.disabled}
              >
                {cta.label}
              </button>
              <button
                type="button"
                className="jt-cta--markpaid"
                aria-label="Mark paid"
                onClick={() => onUpdateJob?.({
                  ...job,
                  paid: true,
                  status: 'paid',
                  paidAt: new Date().toISOString(),
                  paymentStatus: 'paid',
                })}
              >
                Mark paid
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`jt-cta${cta.mod ? ` jt-cta--${cta.mod}` : ''}`}
              onClick={cta.action}
              disabled={!!cta.disabled}
              aria-disabled={!!cta.disabled}
            >
              {cta.label}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// ── Empty state copy per stage ────────────────────────────────────────────────

// Overdue empty-state is the "all caught up" celebratory moment — brand-green
// CircleCheck at hero size gives warmth from colour + copy, not from emoji.
function EmptyState({ stage, onAddJob }) {
  const copy = {
    Lead:     { iconName: 'lead',       title: 'No leads yet',         hint: 'Got a phone enquiry? Log it now and OHNAR tracks it from here.', cta: true },
    Quoted:   { iconName: 'quote-sent', title: 'No quotes out',        hint: 'Tap + New job to create a quote — it lands here once sent.', cta: true },
    On:       { iconName: 'active-job', title: 'Nothing on the go',    hint: "Either you're on holiday or it's time to chase a quote." },
    Invoiced: { iconName: 'invoice',    title: 'No invoices waiting',  hint: 'Finish a job and send the invoice — it sits here until paid.' },
    Overdue:  { iconName: 'complete',   title: 'Nothing overdue',      hint: 'Good week. All invoices are in date.', branded: true },
    Paid:     { iconName: 'paid',       title: 'No paid jobs yet',     hint: 'Paid jobs show here once the money lands.' },
    All:      { iconName: 'lead',       title: 'No jobs yet',          hint: 'Log your first job and OHNAR does the maths.', cta: true },
  };
  const { iconName, title, hint, cta, branded } = copy[stage] ?? { iconName: 'lead', title: 'No jobs', hint: 'Tap + New job to get started.', cta: true };
  // branded: Overdue all-clear gets brand-green (earned positive signal); others muted
  const variant = branded ? 'brand' : 'muted';
  return (
    <div className="screen-empty">
      <div className="screen-empty-icon">
        <Icon name={iconName} size={32} variant={variant} />
      </div>
      <p className="screen-empty-title">{title}</p>
      <p className="screen-empty-hint">{hint}</p>
      {cta && onAddJob && (
        <button type="button" className="screen-empty-cta" onClick={onAddJob}>
          + New job
        </button>
      )}
    </div>
  );
}

// JP-LU5 PR1: LayoutToggle component, TABLE_EMPTY_COPY constant, and JobsTable
// component removed. Card view is always rendered. CSS tombstones in index.css.

// JP-LU5 PR1: JobsTable function removed — see tombstone comment above.

// ── Pagination constants ──────────────────────────────────────────────────────

const PAGE_SIZE = 25;

/**
 * Pager — numbered prev/next controls for a paginated list.
 *
 * Only renders when totalItems > PAGE_SIZE.
 * Mobile-first: tap targets ≥ 44px, wraps to two rows on narrow viewports.
 * Page-window algorithm: current ± 2 with ellipses, always shows first and last.
 */
function Pager({ page, totalPages, onPage, totalItems, pageSize }) {
  if (totalItems <= pageSize) return null;

  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalItems);

  // Build the window of page numbers to show.
  // Always include 1 and totalPages; show current ± 2 with ellipsis gaps.
  function buildPageWindow(current, total) {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const items = [];
    const WINDOW = 2;
    let prev = null;
    for (let p = 1; p <= total; p++) {
      if (p === 1 || p === total || (p >= current - WINDOW && p <= current + WINDOW)) {
        if (prev !== null && p - prev > 1) items.push('…');
        items.push(p);
        prev = p;
      }
    }
    return items;
  }

  const pageWindow = buildPageWindow(page, totalPages);

  return (
    <div className="pager" aria-label="Page navigation">
      <span className="pager-count" aria-live="polite" aria-atomic="true">
        Showing {startItem}–{endItem} of {totalItems}
      </span>
      <div className="pager-controls" role="group" aria-label="Page controls">
        <button
          type="button"
          className="pager-btn pager-btn--prev"
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
          aria-disabled={page === 1}
        >
          ‹
        </button>
        {pageWindow.map((item, idx) =>
          item === '…' ? (
            <span key={`ellipsis-${idx}`} className="pager-ellipsis" aria-hidden="true">…</span>
          ) : (
            <button
              key={item}
              type="button"
              className={`pager-btn pager-btn--num${item === page ? ' pager-btn--current' : ''}`}
              onClick={() => onPage(item)}
              aria-label={`Page ${item}`}
              aria-current={item === page ? 'page' : undefined}
            >
              {item}
            </button>
          )
        )}
        <button
          type="button"
          className="pager-btn pager-btn--next"
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages}
          aria-label="Next page"
          aria-disabled={page === totalPages}
        >
          ›
        </button>
      </div>
    </div>
  );
}

// ── JobsList subview ──────────────────────────────────────────────────────────

// JP-LU5 PR1: layout, colSort, onColSort, onUpgrade props removed — card view only.
function JobsList({ jobs, receipts, selectedStage, showAll, searchQuery, profile, onJobSelect, onSendInvoice, onUpdateJob, onNewJob, onOpenJob, onCopyJob, onArchiveJob, onDeleteJob, biz, onShowToast, onViewReceipt, onAddJob, onActionRedirect, onCallJob }) {
  const q = (searchQuery || '').trim();
  const listTopRef = useRef(null);

  // Pagination: always reset to page 1 when filter, search, or showAll changes.
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [selectedStage, showAll, searchQuery]);

  // When searching: ignore the stage filter — show everything that matches (1B spec).
  // When not searching and in All view: apply urgency-tier sort.
  // When not searching and in a stage view: filter to stage then sort by urgency (1C).
  let visible;
  if (q) {
    visible = jobs.filter(j => jobMatchesQuery(j, q));
  } else if (showAll) {
    visible = sortJobsForAllView(jobs, deriveDisplayStatus);
  } else {
    const stageJobs = jobs.filter(j => deriveDisplayStatus(j) === selectedStage);
    visible = sortJobsByStage(stageJobs, selectedStage);
  }

  const totalItems = visible.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const pageItems = visible.slice(pageStart, pageEnd);

  function handlePage(p) {
    setPage(p);
    // Scroll list back to top on page change
    listTopRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // Card view (always — table layout removed in JP-LU5 PR1)
  if (visible.length === 0) {
    if (q) {
      return (
        <div className="screen-empty">
          <p className="screen-empty-title">No jobs match &ldquo;{q}&rdquo;</p>
          <p className="screen-empty-hint">Check the spelling or tap + New job.</p>
        </div>
      );
    }
    return <EmptyState stage={showAll ? 'All' : selectedStage} onAddJob={onAddJob} />;
  }

  return (
    <div className="job-list-wrap">
      {/* Invisible scroll anchor — scrollIntoView targets this on page change */}
      <div ref={listTopRef} aria-hidden="true" style={{ height: 0 }} />
      <ul className="job-list">
        {pageItems.map(j => (
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
            onShowToast={onShowToast}
            onViewReceipt={onViewReceipt}
            onActionRedirect={onActionRedirect}
            onCallJob={onCallJob}
          />
        ))}
      </ul>
      <Pager
        page={safePage}
        totalPages={totalPages}
        onPage={handlePage}
        totalItems={totalItems}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}

// ── WorkScreen (root) ─────────────────────────────────────────────────────────

// JP-LU5 PR1: pendingWorkView and onPendingWorkViewConsumed removed from props —
// calendar subview gone. AppShell's handleSeeTheWeek now plain navigate('work').
export default function WorkScreen({ jobs = [], receipts = [], onNewJob, onAddJob, onAddPayment, onUpdateJob, onDeleteJob, onAddReceipt, onDeleteReceipt, onUpdateReceipt, biz, profile, initialJobId, onNavigateToCardPayments, onProfileUpdate, materials, defaultMarkup, onBrowseMaterials, onMaterialSaved, onOverlayChange }) {
  const [selectedStage, setSelectedStage] = useState(() => getPersistedFilter().selectedStage);
  const [showAll, setShowAll] = useState(() => getPersistedFilter().showAll);
  // 1B: client-side search — pure JS filter, works offline
  const [searchQuery, setSearchQuery] = useState('');
  // selectedJob drives the JobDetailDrawer — null means closed.
  // initialJobId: when set, pre-open the drawer for that job on first render.
  const [selectedJob, setSelectedJob] = useState(() => {
    if (!initialJobId) return null;
    return null; // populated once jobs prop arrives via the useEffect below
  });
  // drawerIntent / drawerTargetStage — set when opening the drawer with a goal
  // (e.g. tile CTA "Send quote →" or stage-advance guard). Cleared after use.
  const [drawerIntent, setDrawerIntent] = useState(null);
  const [drawerTargetStage, setDrawerTargetStage] = useState(null);
  // pendingEditField — when the user taps Call/Map on a job that's missing the
  // required data, we open the drawer and immediately surface the edit modal for
  // that field. Cleared once the drawer mounts and consumes it.
  const [pendingEditField, setPendingEditField] = useState(null);
  // reviewJob drives the ReviewSheet opened from tile CTAs (Send invoice on On stage).
  const [reviewJob, setReviewJob] = useState(null);
  const [toast, setToast] = useState('');
  // addJobOpen drives the inline AddJobModal — same pattern as TodayScreen.
  const [addJobOpen, setAddJobOpen] = useState(false);
  // JP-LU5 PR1: addJobDate state removed — only used by WorkCalendar path.
  // chaseStepIndex — tracks which job to nudge next in the batch-chase flow
  const [chaseStepIndex, setChaseStepIndex] = useState(0);
  // chaseBarJustChased — job that was just chased; drives the 1.5s "Chased" transition
  // state on the chase bar before it morphs to the next invoice. Null = normal state.
  const [chaseBarJustChased, setChaseBarJustChased] = useState(null);
  // confirmDeleteJob — job pending hard-delete confirmation; null = modal closed.
  const [confirmDeleteJob, setConfirmDeleteJob] = useState(null);
  // receiptJob — job whose receipt modal is open; null = closed.
  const [receiptJob, setReceiptJob] = useState(null);
  // docOverlay — which global document search overlay is open ('jobs'|'quotes'|'invoices'|null).
  // Reuses DocumentSearchOverlay exactly as TodayScreen does — not a new overlay, same component.
  const [docOverlay, setDocOverlay] = useState(null);

  // callPayPrompt — job to show the "Did [customer] pay?" prompt for after a tel: dial.
  // Set when the app regains focus/visibility after a Call tap on an unpaid job.
  // Cleared on dismiss, on "Mark paid", or when the job is already paid.
  const [callPayPrompt, setCallPayPrompt] = useState(null);
  // Track when the page hid so we can calculate away time on return.
  const hiddenAtRef = useRef(null);

  // JP-LU5 PR1: layout, colSort, upgradeSheetOpen, showCoachmark state removed.

  // If AppShell navigated here with a specific job to open (e.g. from TodayScreen
  // card-body tap), find it in the jobs array and pre-open the drawer.
  // Uses an empty dep array: initialJobId is fixed for the lifetime of this
  // WorkScreen instance (AppShell remounts WorkScreen via key prop when the user
  // taps the Jobs tab directly). Running on [jobs] would re-open the drawer on
  // every cloud refresh — that was the stuck-drawer bug.
  useEffect(() => {
    if (!initialJobId || !jobs.length) return;
    const target = jobs.find(j => String(j.id) === String(initialJobId));
    if (target) setSelectedJob(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notify AppShell when the JobDetailDrawer opens or closes so PostPaidSheet
  // can suppress itself while the drawer is still on-screen (Option A).
  useEffect(() => {
    onOverlayChange?.(selectedJob !== null);
  }, [selectedJob, onOverlayChange]);

  // Persist stage filter state whenever either value changes.
  // Wrapped in try/catch — Safari private mode throws on setItem.
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ selectedStage, showAll }));
    } catch {
      // silently swallow — private mode or storage full
    }
  }, [selectedStage, showAll]);

  // ── Call-pay prompt ────────────────────────────────────────────────────────
  // When the founder taps Call and then returns to the app, offer a one-tap
  // "Did [customer] pay? → Mark paid / Not yet" prompt.
  //
  // Uses both visibilitychange and window focus because:
  //   - visibilitychange covers the phone dialler returning on mobile
  //   - focus covers desktop / PWA window re-activation
  // hiddenAtRef captures the moment the page hid so we know how long they
  // were away; the minimum threshold (800ms) skips accidental tab swipes.
  const handleCallJob = useCallback((job) => {
    recordCall(job.id);
    hiddenAtRef.current = null; // will be set by visibilitychange 'hidden'
  }, []);

  useEffect(() => {
    function handleHide() {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
      }
    }

    function handleReturn() {
      if (document.visibilityState !== 'hidden') {
        const returnedAt = Date.now();
        const record = consumeCallRecord();
        if (!record) return;
        const liveJob = jobs.find(j => String(j.id) === String(record.jobId)) ?? null;
        if (!shouldShowCallPayPrompt({ record, job: liveJob, returnedAt })) {
          // Guard failed (already paid, too long away, wrong stage, etc.) — discard.
          return;
        }
        setCallPayPrompt(liveJob);
      }
    }

    function handleFocus() {
      // Mirrors handleReturn — fires when the PWA window regains focus
      // without a visibilitychange event (e.g. alt-tab on desktop).
      const returnedAt = Date.now();
      const record = consumeCallRecord();
      if (!record) return;
      const liveJob = jobs.find(j => String(j.id) === String(record.jobId)) ?? null;
      if (!shouldShowCallPayPrompt({ record, job: liveJob, returnedAt })) return;
      setCallPayPrompt(liveJob);
    }

    document.addEventListener('visibilitychange', handleHide);
    document.addEventListener('visibilitychange', handleReturn);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleHide);
      document.removeEventListener('visibilitychange', handleReturn);
      window.removeEventListener('focus', handleFocus);
    };
  // jobs is the dependency — re-register when the jobs list updates so the
  // closure captures the latest array (prevents stale-job lookups).
  }, [jobs]);

  // Pre-fetch Pay-now URLs for chase-eligible jobs when the trader is connected.
  // Fires on mount (and whenever jobs or connect status changes). By the time
  // the user taps Chase, the URL is already in the map — no perceptible delay.
  // create-invoice-payment-link is idempotent: same invoice → same token if
  // still pending, so calling it for N jobs on mount is safe and cheap.
  // On error, we silently skip — chase falls back to the bare message.
  const isConnected = profile?.stripe_connect_status === 'connected' && !!profile?.stripe_user_id;
  const [payNowUrls, setPayNowUrls] = useState(() => new Map());

  useEffect(() => {
    if (!isConnected || !jobs.length) return;
    let cancelled = false;

    async function prefetchAll() {
      let accessToken;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token || cancelled) return;
        accessToken = session.access_token;
      } catch {
        return; // can't get token — skip silently
      }

      // Chase-eligible: overdue or invoiced jobs that have a non-zero amount.
      // Pre-due (tier 0) jobs are included via 'Invoiced' so handlePreDueChase
      // also gets a Pay-now URL.
      const eligible = jobs.filter(j => {
        const s = deriveDisplayStatus(j);
        return (s === 'Overdue' || s === 'Invoiced') && Number(j.total ?? j.amount ?? 0) > 0;
      });

      const results = await Promise.allSettled(
        eligible.map(async (j) => {
          try {
            const res = await fetch('/.netlify/functions/create-invoice-payment-link', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ invoiceId: j.id }),
            });
            if (!res.ok) return null;
            const { payUrl } = await res.json();
            return payUrl ? { id: j.id, payUrl } : null;
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;

      setPayNowUrls(prev => {
        const next = new Map(prev);
        results.forEach(r => {
          if (r.status === 'fulfilled' && r.value) {
            next.set(r.value.id, r.value.payUrl);
          }
        });
        return next;
      });
    }

    prefetchAll();
    return () => { cancelled = true; };
  }, [isConnected, jobs]);

  // JP-LU5 PR1: switchSubview callback and pendingWorkView useEffect removed.

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
    setSearchQuery(''); // tapping a stage tab means "done searching, show this tab"
    // Sort persists across tab switches — do NOT reset colSort here.
    logTelemetry('stage_strip_select', { stage });
  };

  const handleSelectAll = () => {
    setSearchQuery(''); // switching to All view — clear any active search
    // Sort persists across tab switches — do NOT reset colSort here.
    if (showAll) {
      // Already in All mode — snap back to selectedStage.
      setShowAll(false);
      logTelemetry('stage_strip_select', { stage: 'All', action: 'exit' });
    } else {
      setShowAll(true);
      logTelemetry('stage_strip_select', { stage: 'All', action: 'enter' });
    }
  };

  // JP-LU5 PR1: handleLayoutChange, handleColSort, dismissCoachmark removed.

  // Exclude archived and deleted jobs from every rendered surface in this screen.
  // This single derivation feeds StageStrip totals, the chase bar, and JobsList
  // so counts and £ figures all agree.
  const visibleJobs = jobs.filter(j => !j?.archived && !j?.meta?.archived && !j?.deleted && !j?.meta?.deleted);

  // Money-in-flight banner figures
  const riskFigures = calcRiskFigures(visibleJobs);
  // Pre-due jobs: Invoiced (not yet Overdue), due in 1-2 days — the Day 5
  // window for a net-7 invoice. Drives the amber pre-due bar when no overdue
  // jobs exist. Sorted oldest-first (soonest due first).
  const preDueJobs = visibleJobs
    .filter(j => {
      if (deriveDisplayStatus(j) !== 'Invoiced') return false;
      const d = daysUntilDue(j);
      return d >= 1 && d <= 2;
    })
    .sort((a, b) => {
      const aDate = a.invoiceDueDate ? new Date(a.invoiceDueDate) : new Date(a.invoiceSentAt ?? 0);
      const bDate = b.invoiceDueDate ? new Date(b.invoiceDueDate) : new Date(b.invoiceSentAt ?? 0);
      return aDate - bDate;
    });

  // Batch nudge: overdue jobs that are NOT blocked by the 48h guard
  const chasableJobs = riskFigures.overdueJobs.filter(j => !isDoubleSendBlocked(j.id));

  // Tier-priority queue for Design A chase bar.
  // Rule: Tier 3 (14+ days) jumps ahead of all others; then Tier 2; then Tier 1.
  // Within each tier, oldest due date first. 'grace' tier is non-actionable and
  // is excluded (those jobs don't appear in chasableJobs anyway).
  const prioritisedChaseQueue = [...chasableJobs].sort((a, b) => {
    const ta = typeof computeTier(a) === 'number' ? computeTier(a) : 0;
    const tb = typeof computeTier(b) === 'number' ? computeTier(b) : 0;
    if (ta !== tb) return tb - ta; // higher tier first
    // Within same tier: oldest due date first
    const aDate = a.invoiceDueDate ? new Date(a.invoiceDueDate) : new Date(a.invoiceSentAt ?? 0);
    const bDate = b.invoiceDueDate ? new Date(b.invoiceDueDate) : new Date(b.invoiceSentAt ?? 0);
    return aDate - bDate;
  });

  // Pre-due heads-up: opens the Tier 0 WhatsApp message for the oldest pre-due job.
  const handlePreDueChase = () => {
    const job = preDueJobs[0];
    if (!job) return;
    const phone = job.customerPhone || job.phone || job.mobile || '';
    const outstanding = Number(job.total ?? job.amount ?? 0) || 0;
    const paymentDetails = buildPaymentDetails(biz);
    const link = buildChaseLink({
      phone,
      customerName: job.customer || job.name || '',
      amount: '£' + formatAmount(outstanding),
      jobSummary: job.summary || '',
      dueDate: job.invoiceDueDate || null,
      daysOverdue: 0,
      tier: 0,
      amountPaid: 0,
      paymentDetails,
      businessName: biz?.name || '',
      isB2B: false,
      payNowUrl: payNowUrls.get(job.id) ?? '',
    });
    const finalUrl = link ?? `https://wa.me/?text=${encodeURIComponent(
      buildChaseMessage({
        customerName: job.customer || job.name || '',
        amount: '£' + formatAmount(outstanding),
        jobSummary: job.summary || '',
        dueDate: job.invoiceDueDate || null,
        daysOverdue: 0,
        tier: 0,
        paymentDetails,
        businessName: biz?.name || '',
        isB2B: false,
      })
    )}`;
    window.open(finalUrl, '_blank', 'noopener');
  };

  // Batch chase: step through the tier-priority queue one tap at a time.
  // Each tap opens the correctly-tiered WhatsApp message; the human fires the send.
  // Tier 3 (14+ days overdue) always leads the queue; then Tier 2, then Tier 1,
  // oldest-due first within each tier. Uses the existing chaseJobTiered path so
  // message content, recordChase, and the 48h guard are unchanged.
  const handleBatchChaseStep = () => {
    const job = prioritisedChaseQueue[0];
    if (!job) return;
    const opened = chaseJobTiered(job, biz, null, payNowUrls.get(job.id) ?? '');
    if (opened) {
      setChaseStepIndex(prev => prev + 1);
      showToast(`Chased ${job.customer || job.name || 'Invoice'}`);
      // Show 1.5s "Chased" transition state on the bar before it morphs to next
      setChaseBarJustChased(job);
      setTimeout(() => setChaseBarJustChased(null), 1500);
    }
  };

  const handleJobSave = (job) => {
    setAddJobOpen(false);
    onAddJob?.(job);
    showToast('Job saved');
  };

  const openAddJob = () => setAddJobOpen(true);

  // JP-LU5 PR1: handleNewJobOnDate removed — only used by WorkCalendar render.

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
    setPendingEditField(opts?.editField ?? null);
  };

  // Called by Call/Map buttons when the job is missing the required data.
  // Opens the drawer and surfaces the edit modal for the relevant field.
  const handleActionRedirect = (job, field) => {
    handleOpenJob(job, { editField: field });
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

  // Confirmed hard-delete — cascade-removes photos, linked receipts, and the jobs row.
  const handleConfirmDeleteJob = async () => {
    const job = confirmDeleteJob;
    setConfirmDeleteJob(null);
    if (!job) return;
    try {
      await deleteJobWithData(job, receipts.filter(r => r.jobId === job.id || r.jobId === job.cloudId).map(r => r.id));
      onDeleteJob?.(job.id);
      showToast('Job deleted');
    } catch (err) {
      console.error('handleConfirmDeleteJob failed', err);
      showToast('Delete failed — try again');
    }
  };

  /**
   * Passed to JobDetailDrawer as onDeleteJob.
   * The drawer handles the confirm prompt itself (pendingDeleteAction pattern);
   * it calls this AFTER the user confirms, awaits the result, then closes itself.
   * On success this handler just removes the job from AppShell state.
   * The cascade delete (photos + receipts + row) is done inside deleteJobWithData.
   */
  const handleDrawerDeleteJob = async (job) => {
    const linkedReceiptIds = receipts
      .filter(r => r.jobId === job.id || r.jobId === job.cloudId)
      .map(r => r.id);
    await deleteJobWithData(job, linkedReceiptIds);
    // Close the drawer so the user lands back on the Jobs list
    setSelectedJob(null);
    setDrawerIntent(null);
    setDrawerTargetStage(null);
    setPendingEditField(null);
    // Notify AppShell to filter the job from React state
    onDeleteJob?.(job.id);
    // Confirm the deletion (parity with the tile path). Reached only after the
    // await resolves — a failed delete throws back to the drawer, which surfaces
    // its own error toast and keeps the drawer open.
    showToast('Job deleted');
  };

  return (
    <div className="screen work-screen">
      {/* Header */}
      <div className="screen-header">
        <h1 className="screen-title">Jobs</h1>
        <span className="screen-header-lockup">
          <OhnarWordmark size="30px" />
        </span>
        <div className="screen-header-right">
          <button className="new-btn" onClick={openAddJob}>
            <Icon name="active-job" size={16} aria-hidden="true" />
            Log a job
          </button>
        </div>
      </div>

      {/* Chase bar — Design A: one-invoice focus with tier-priority queue.
           Four mutually exclusive states (evaluated top-down):
           1. Red — overdue invoices exist; shows the most-urgent one (Tier 3 first).
              1a. Just-chased transition (1.5s green flash after a tap).
              1b. All chaseable — normal queue state.
              1c. All blocked (48h cooldown) — "all today's chases are out" grey state.
           2. Amber — no overdue, but at least one invoice due in 1-2 days.
           3. Nothing — at rest. */}
      {riskFigures.overdueJobs.length > 0 ? (() => {
        const nextJob = prioritisedChaseQueue[0] ?? null;
        const queueRemaining = prioritisedChaseQueue.length; // jobs still chaseable

        // Just-chased state: show 1.5s green confirmation before morphing
        if (chaseBarJustChased) {
          const customerShort = (chaseBarJustChased.customer || chaseBarJustChased.name || 'Invoice')
            .split(' ').slice(0, 2).join(' ');
          return (
            <div
              key={`chased-${chaseBarJustChased.id}`}
              className="chase-bar chase-bar--just-chased"
              role="region"
              aria-live="polite"
              aria-label={`Chased ${customerShort}`}
            >
              <div className="chase-bar-a-main">
                <span className="chase-bar-a-name">&#10003; Chased {customerShort}</span>
                <span className="chase-bar-a-meta">Next up in a moment&hellip;</span>
              </div>
            </div>
          );
        }

        // Queue empty: all overdue jobs are within the 48h cooldown.
        // If the user chased at least one this session, show the positive empty state.
        // Otherwise (blocked from a previous session), show the neutral blocked state.
        if (!nextJob) {
          const allChasedThisSession = chaseStepIndex > 0;
          return allChasedThisSession ? (
            <div
              className="chase-bar chase-bar--all-chased"
              role="region"
              aria-live="polite"
              aria-label="All chased"
            >
              <div className="chase-bar-a-main">
                <span className="chase-bar-a-name">All chased. Money&rsquo;s on the way.</span>
              </div>
            </div>
          ) : (
            <div
              className="chase-bar chase-bar--blocked"
              role="region"
              aria-live="polite"
              aria-label="All today's chases are out"
            >
              <div className="chase-bar-a-main">
                <span className="chase-bar-a-name">All today&rsquo;s chases are out</span>
                <span className="chase-bar-a-meta">Reply expected within 48h</span>
              </div>
            </div>
          );
        }

        // Normal state: show the next invoice to chase (nextJob is non-null here)
        const customerName = nextJob.customer || nextJob.name || 'Invoice';
        const outstanding = Number(nextJob.total ?? nextJob.amount ?? 0);
        const daysLate = Math.max(0, daysPastDue(nextJob));
        const rawTier = computeTier(nextJob);
        const tierNum = typeof rawTier === 'number' ? rawTier : 1;
        const tierLabel = tierNum === 3 ? 'final' : tierNum === 2 ? 'firm' : 'light';
        const queueLine = queueRemaining > 1
          ? `+ ${queueRemaining - 1} more to chase after this`
          : null;

        return (
          <div
            key={`chase-${nextJob.id}`}
            className={`chase-bar chase-bar--a${tierNum === 3 ? ' chase-bar--a-t3' : ''}`}
            role="region"
            aria-live="polite"
            aria-label={`${customerName} · £${formatAmount(outstanding)} · ${daysLate} days late`}
          >
            <div className="chase-bar-a-body">
              <div className="chase-bar-a-row1">
                <div className="chase-bar-a-left">
                  <span className="chase-bar-a-name">{customerName}</span>
                  <span className="chase-bar-a-amount"> &middot; £{formatAmount(outstanding)}</span>
                  <div className="chase-bar-a-meta">
                    <span className="chase-bar-a-days">{daysLate}d late</span>
                    <span className={`chase-bar-a-tier${tierNum === 3 ? ' chase-bar-a-tier--3' : ''}`}>
                      Tier {tierNum} &middot; {tierLabel}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="chase-bar-btn chase-bar-btn--a"
                  onClick={handleBatchChaseStep}
                  aria-label={`Chase ${customerName} on WhatsApp`}
                >
                  Chase on WhatsApp
                </button>
              </div>
              {queueLine && (
                <div className="chase-bar-a-queue">{queueLine}</div>
              )}
            </div>
          </div>
        );
      })() : preDueJobs.length > 0 ? (
        <div
          className="chase-bar chase-bar--predue"
          role="region"
          aria-live="polite"
          aria-label={preDueJobs.length === 1
            ? `${preDueJobs[0].customer || preDueJobs[0].name || 'Invoice'}'s invoice due in ${daysUntilDue(preDueJobs[0])} days`
            : `${preDueJobs.length} invoices due soon`}
        >
          <div className="chase-bar-left">
            <span className="chase-bar-label chase-bar-label--predue">
              {preDueJobs.length === 1
                ? `${preDueJobs[0].customer || preDueJobs[0].name || 'Invoice'}'s invoice due in ${daysUntilDue(preDueJobs[0])} ${daysUntilDue(preDueJobs[0]) === 1 ? 'day' : 'days'}`
                : `${preDueJobs.length} invoices due soon`}
            </span>
          </div>
          <button
            type="button"
            className="chase-bar-btn chase-bar-btn--predue"
            onClick={handlePreDueChase}
            aria-label="Send heads-up"
          >
            Send heads-up →
          </button>
        </div>
      ) : null}


      {/* Stage Strip — 6 equal segments, no "All" tile.
           (Text funnel summary removed — the strip already shows count + £ per stage.) */}
      <StageStrip
        jobs={visibleJobs}
        selectedStage={selectedStage}
        showAll={showAll}
        onSelectStage={handleSelectStage}
        deriveStatus={deriveDisplayStatus}
        formatAmount={formatAmount}
      />

      {/* 1B: Search bar — sticky under the stage strip, pure client-side filter. */}
      <div className="jobs-search-wrap">
        <input
          type="search"
          className={`jobs-search${searchQuery ? ' jobs-search--has-value' : ''}`}
          placeholder="Search name, job or street"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          aria-label="Search jobs"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
        {searchQuery && (
          <button
            type="button"
            className="jobs-search-clear"
            aria-label="Clear search"
            onClick={() => setSearchQuery('')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="4" y1="4" x2="12" y2="12"/>
              <line x1="12" y1="4" x2="4" y2="12"/>
            </svg>
          </button>
        )}
      </div>

      {/* JP-LU5 PR1: List/Calendar segmented control removed — card view only.
           Controls row retains: Show all pill + Records pill. */}
      <div className="work-controls-row">
        <button
          type="button"
          className={`show-all-pill${showAll ? ' show-all-pill--active' : ''}`}
          onClick={handleSelectAll}
          aria-pressed={showAll}
          aria-label={showAll ? `Back to ${selectedStage}` : 'Show all stages'}
        >
          All
        </button>
        {/* Documents pill (feat/documents-findability-v1) — renamed from "Records". */}
        <button
          type="button"
          className="show-all-pill work-records-pill"
          onClick={() => {
            logTelemetry('work_documents_open', { source: 'controls_row' });
            setDocOverlay('quotes');
          }}
          aria-label="Find a quote, invoice, receipt or job"
        >
          <Icon name="search" size={13} aria-hidden="true" />
          Documents
        </button>
      </div>

      {/* Card view — always rendered (JP-LU5 PR1: table layout removed) */}
      <JobsList
        jobs={visibleJobs}
        receipts={receipts}
        selectedStage={selectedStage}
        showAll={showAll}
        searchQuery={searchQuery}
        profile={profile}
        onJobSelect={setSelectedJob}
        onSendInvoice={setReviewJob}
        onUpdateJob={handleUpdateJob}
        onNewJob={onNewJob}
        onOpenJob={handleOpenJob}
        onCopyJob={handleCopyJob}
        onArchiveJob={handleArchiveJob}
        onDeleteJob={handleRequestDeleteJob}
        biz={biz}
        onShowToast={showToast}
        onViewReceipt={setReceiptJob}
        onAddJob={openAddJob}
        onActionRedirect={handleActionRedirect}
        onCallJob={handleCallJob}
      />

      {/* Job detail drawer — wrapped in an error boundary so a render crash
          shows a fallback instead of a blank white screen. Keyed by job id
          so the boundary resets automatically when a different job is opened. */}
      {liveSelectedJob && (
        <DrawerErrorBoundary
          key={liveSelectedJob.id}
          onClose={() => { setSelectedJob(null); setDrawerIntent(null); setDrawerTargetStage(null); setPendingEditField(null); }}
        >
          <JobDetailDrawer
            job={liveSelectedJob}
            receipts={receipts}
            biz={biz}
            profile={profile}
            jobs={jobs}
            onUpdateJob={onUpdateJob}
            onAddReceipt={onAddReceipt}
            onDeleteReceipt={onDeleteReceipt}
            onUpdateReceipt={onUpdateReceipt}
            onAddPayment={handleAddPayment}
            onDeleteJob={handleDrawerDeleteJob}
            onClose={() => { setSelectedJob(null); setDrawerIntent(null); setDrawerTargetStage(null); setPendingEditField(null); }}
            intent={drawerIntent}
            targetStage={drawerTargetStage}
            onClearIntent={() => { setDrawerIntent(null); setDrawerTargetStage(null); }}
            initialEditingField={pendingEditField}
            onClearInitialEditingField={() => setPendingEditField(null)}
            onViewReceipt={setReceiptJob}
            onNavigateToCardPayments={onNavigateToCardPayments}
            onProfileUpdate={onProfileUpdate}
            materialsLibrary={materials}
            onMaterialSaved={onMaterialSaved}
          />
        </DrawerErrorBoundary>
      )}

      {/* ReviewSheet — opened by "Send invoice" tile CTA on On-stage cards */}
      {reviewJob && (
        <ReviewSheet
          mode="invoice"
          job={reviewJob}
          biz={{ ...(biz ?? {}), stripePaymentLink: profile?.stripe_payment_link || biz?.stripePaymentLink || '' }}
          jobs={jobs}
          receipts={receipts}
          profile={profile}
          onUpdate={onUpdateJob ?? (() => {})}
          onClose={() => setReviewJob(null)}
          onDismiss={() => setReviewJob(null)}
          onEdit={() => {
            // Close ReviewSheet and open the drawer for this job so the user
            // can edit price / line items. Auto-return-to-review is deferred
            // here: the drawer's own edit-save flow does not know to re-open
            // this WorkScreen-level ReviewSheet without a separate state bridge.
            // The user lands on the drawer and can tap "Send invoice" again.
            const jobToEdit = reviewJob;
            setReviewJob(null);
            setSelectedJob(jobToEdit);
          }}
          flash={showToast}
        />
      )}

      {/* AddJobModal — inline; JP-LU5 PR1: addJobDate/calendar pre-fill removed. */}
      {addJobOpen && (
        <AddJobModal
          onClose={() => setAddJobOpen(false)}
          onSave={handleJobSave}
          materials={materials}
          defaultMarkup={defaultMarkup ?? profile?.default_markup ?? 20}
          onBrowseMaterials={onBrowseMaterials}
          onMaterialSaved={onMaterialSaved}
        />
      )}

      {/* Confirm-delete modal — minimal inline implementation (no reusable ConfirmModal exists yet) */}
      {confirmDeleteJob && (() => {
        const deleteCopy = buildDeleteJobCopy(confirmDeleteJob.customer || confirmDeleteJob.name || '');
        return (
          <div className="modal-backdrop" onClick={() => setConfirmDeleteJob(null)}>
            <div
              className="modal-card"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-modal-title"
              aria-describedby="delete-modal-body"
              onClick={e => e.stopPropagation()}
            >
              <h2 id="delete-modal-title" className="modal-card-title">{deleteCopy.title}</h2>
              <p id="delete-modal-body" className="modal-card-body">{deleteCopy.body}</p>
              <div className="modal-card-actions">
                <button
                  type="button"
                  className="modal-btn modal-btn--secondary"
                  onClick={() => setConfirmDeleteJob(null)}
                >
                  {deleteCopy.cancelLabel}
                </button>
                <button
                  type="button"
                  className="modal-btn modal-btn--danger"
                  onClick={handleConfirmDeleteJob}
                >
                  {deleteCopy.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Receipt modal — opened by "View receipt" CTA on Paid job tiles */}
      {receiptJob && (
        <ReceiptModal
          job={receiptJob}
          biz={biz}
          profile={profile}
          onUpdate={onUpdateJob}
          onClose={() => setReceiptJob(null)}
          flash={showToast}
        />
      )}

      {/* Global document search overlay — opened by Documents pill in controls row.
          feat/documents-findability-v1: receipts + profile now passed for Receipts
          mode and the Pro-gated export. Per-job document history still lives in
          DocumentsHub inside JobDetailDrawer. */}
      {docOverlay && (
        <DocumentSearchOverlay
          mode={docOverlay}
          jobs={jobs}
          receipts={receipts}
          profile={profile}
          onClose={() => setDocOverlay(null)}
          onJobSelect={(job) => {
            setDocOverlay(null);
            setSelectedJob(job);
          }}
          onCreateJob={() => { setDocOverlay(null); setAddJobOpen(true); }}
          onCreateQuote={() => { setDocOverlay(null); setAddJobOpen(true); }}
          onSendInvoice={(job) => { setDocOverlay(null); setReviewJob(job); }}
          onOpenUpgradeSheet={() => { setDocOverlay(null); }}
        />
      )}

      {/* JP-LU5 PR1: ProUpgradeSheet removed — was only wired to table-view profit lock. */}

      {toast && <div className="toast">{toast}</div>}

      {/* Call-pay prompt — appears after returning from a tel: dial on an unpaid job.
          Rendered in a portal so z-index sits above tiles and open drawers.
          Fires once per call (consumeCallRecord removes the sessionStorage entry);
          dismissed by tapping either button or the × close. */}
      {callPayPrompt && createPortal(
        <div
          className="snackbar snackbar--call-pay"
          role="alertdialog"
          aria-modal="false"
          aria-label={`Did ${callPayPrompt.customer || callPayPrompt.name || 'the customer'} pay?`}
          aria-live="polite"
        >
          <span className="snackbar__msg snackbar__call-pay-label">
            Did {callPayPrompt.customer || callPayPrompt.name || 'they'} pay
            {callPayPrompt.summary ? ` for ${callPayPrompt.summary}` : ''}?
          </span>
          <div className="snackbar__call-pay-btns">
            <button
              type="button"
              className="snackbar__call-pay-confirm"
              aria-label="Mark paid"
              onClick={() => {
                const job = callPayPrompt;
                setCallPayPrompt(null);
                clearCallRecord();
                handleUpdateJob({
                  ...job,
                  paid: true,
                  status: 'paid',
                  paidAt: new Date().toISOString(),
                  paymentStatus: 'paid',
                });
              }}
            >
              Mark paid
            </button>
            <button
              type="button"
              className="snackbar__call-pay-dismiss"
              aria-label="Not yet — dismiss"
              onClick={() => {
                clearCallRecord();
                setCallPayPrompt(null);
              }}
            >
              Not yet
            </button>
          </div>
          <button
            type="button"
            className="snackbar__close"
            aria-label="Dismiss"
            onClick={() => {
              clearCallRecord();
              setCallPayPrompt(null);
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
