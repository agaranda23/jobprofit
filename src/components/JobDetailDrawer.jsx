import React, { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import PaymentSummaryBlock from './PaymentSummaryBlock';
import PaymentHistoryList from './PaymentHistoryList';
import RecordPaymentModal from './RecordPaymentModal';
import PostPaidCostRow from './PostPaidCostRow';
import {
  shouldShowCostPrompt,
  costPromptVariant,
  recordPromptShown,
} from '../lib/postPaidCost';
import SendInvoiceModal from './SendInvoiceModal';
import ReviewSheet from './ReviewSheet';
import AddReceiptModal from './AddReceiptModal';
import SignaturePad from './SignaturePad';
import EditFieldModal from './EditFieldModal';
import NextStepCard from './NextStepCard';
import CollapsedSectionRow from './CollapsedSectionRow';
import ProfitRibbon from './ProfitRibbon';
import ProfitBreakdownSheet from './ProfitBreakdownSheet';
import { getDrawerSectionConfig } from '../lib/drawerSectionConfig';
import { deriveNextStepContent } from '../lib/nextStepContent';
import { sectionsNeedingAttention } from '../lib/sectionAttention';
import {
  recordChase,
  clearChase,
  buildChaseLink,
  computeTier,
  daysPastDue,
  buildPaymentDetails,
  isDoubleSendBlocked,
} from '../lib/chaseLadder';
import { deriveDisplayStatus, needsPrice, stagePatch } from '../lib/jobStatus';
import { computeBalance, computeAmountPaid, editPayment, deletePayment } from '../lib/payments';
import { gbp } from '../lib/today';
import { monthKey } from '../lib/cashflow';
import { supabase } from '../lib/supabase';
import { compressPhoto } from '../lib/photoCompress';
import {
  isLegacyPhoto,
  dataUrlToBlob,
  makePhotoEntry,
  getCaption,
  setCaption,
  reorderPhotos,
} from '../lib/jobPhotos';
import { uploadJobPhoto, getSignedPhotoUrl, deleteJobPhoto, getReceiptSignedUrl } from '../lib/store';
import { buildWhatsAppLink } from '../lib/invoiceMessage';
import { logTelemetry } from '../lib/telemetry';
import {
  readVisits,
  writeVisits,
  computeVisitStatus,
  computeFinishStatus,
  getScheduleMeta,
  isLastPlannedVisit,
  generateVisitId,
  tomorrowDateString,
} from '../lib/visits';
import StageTimeline from './StageTimeline';
import { buildQuoteRecordMeta, buildInvoiceRecordMeta } from '../lib/documentRecord';
// downloadQuotePDF/downloadInvoicePDF and isPro are consumed by DocumentsHub; no longer needed here.
import DocumentsHub from './DocumentsHub';

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Derives the customer phone number from whichever field the job uses.
 * Returns an empty string when no phone is present.
 */
function resolvePhone(job) {
  return job.customerPhone || job.phone || job.mobile || job.whatsapp || '';
}

/**
 * Platform-aware Maps URL: Apple Maps on iOS, Google Maps everywhere else.
 * Lifted to module level so the header action row can use it without mounting
 * inside CustomerCard's scope.
 */
function buildMapsUrl(addr) {
  const enc = encodeURIComponent(addr);
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    return `http://maps.apple.com/?q=${enc}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${enc}`;
}

/**
 * Returns true when the "Chase customer" CTA should be visible.
 * Three gates must all pass: job is unpaid, outstanding > 0, phone exists.
 */
function shouldShowChase(job) {
  const paid =
    job.paid === true ||
    job.paymentStatus === 'paid' ||
    job.jobStatus === 'paid' ||
    job.status === 'paid';
  if (paid) return false;

  const outstanding = computeBalance(job);
  if (outstanding <= 0) return false;

  return !!resolvePhone(job);
}

// deriveDisplayStatus is imported from lib/jobStatus — single source of truth
// for the six pipeline stages: Lead · Quoted · On · Invoiced · Overdue · Paid.

/** Formats an ISO date string or YYYY-MM-DD to en-GB display date. Returns '' for falsy. */
function fmtDate(raw) {
  if (!raw) return '';
  try {
    // YYYY-MM-DD strings: parse as local date to avoid UTC midnight offset
    const d = raw.length === 10 ? new Date(raw + 'T00:00:00') : new Date(raw);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return raw;
  }
}

const STATUS_CLASS = {
  Lead:     'status--lead',
  Quoted:   'status--quoted',
  On:       'status--active',
  Invoiced: 'status--invoiced',
  Overdue:  'status--overdue',
  Paid:     'status--paid',
};

// ── Section components (inline — not extracted until legacy JobDetail is fully split) ──

/**
 * Full-screen photo lightbox — tap the backdrop to close.
 * When `receipt` and `onEdit` are provided (receipt row tap path), shows a
 * details bar at the bottom with label, amount, date, and an Edit button.
 * For receipts with no photo the row opens the edit sheet directly — this
 * component is never rendered with an empty src.
 */
function PhotoLightbox({ src, onClose, receipt, onEdit }) {
  if (!src) return null;
  return (
    <div
      className="photo-lightbox-backdrop"
      onClick={onClose}
      role="dialog"
      aria-label="Photo enlarged"
      aria-modal="true"
    >
      <img src={src} alt="" className="photo-lightbox-img" />

      {receipt && (
        <div
          className="photo-lightbox-receipt-bar"
          onClick={e => e.stopPropagation()}
        >
          <div className="photo-lightbox-receipt-meta">
            <span className="photo-lightbox-receipt-label">{receipt.label || 'Receipt'}</span>
            {receipt.date && (
              <span className="photo-lightbox-receipt-date">
                {(() => {
                  try {
                    const d = receipt.date.length === 10
                      ? new Date(receipt.date + 'T00:00:00')
                      : new Date(receipt.date);
                    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
                  } catch { return receipt.date; }
                })()}
              </span>
            )}
            <span className="photo-lightbox-receipt-amount">
              {`£${(Number(receipt.amount || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </span>
          </div>
          {onEdit && (
            <button
              type="button"
              className="photo-lightbox-edit-btn"
              onClick={() => { onClose(); onEdit(receipt); }}
              aria-label="Edit receipt"
            >
              Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * CustomerCard — unified card (Stacked Cards redesign, PRD 2026-05-31).
 *
 * Replaces SpineBlock. Same field set, now wrapped in the standard jd-card chrome.
 * Field order (locked): name → phone → address → email → description.
 * Name is read-only here (it appears in the sticky header — never duplicated below).
 * Empty fields render as ghost-button "+ Add" rows.
 * No B2B toggle — that moved to the bottom settings row (Alaister override 2026-05-31).
 */
function CustomerCard({ job, onEditName, onEditPhone, onEditAddress, onEditEmail, onEditDescription }) {
  // Never fall back to job.name — that's the job title, not the customer name.
  // If job.customer is not set, show a ghost-button "+ Add customer name" instead.
  const customer = job.customer || '';
  const phone = job.customerPhone || job.phone || job.mobile || '';
  const address = job.address || '';
  const email = job.email || job.customerEmail || '';
  const description = job.description || '';
  const canEdit = typeof onEditPhone === 'function';

  const allEmpty = !customer && !phone && !address;

  return (
    <div className="jd-card">
      <div className="jd-card-label">Customer</div>

      {/* All-empty hint — shown only when name+phone+address are all absent */}
      {allEmpty && (
        <p className="jd-customer-empty-hint">
          Add their details to call, text or get directions in one tap.
        </p>
      )}

      {/* Name — editable when onEditName is provided; ghost-button when no customer set */}
      {customer ? (
        onEditName ? (
          <button
            type="button"
            className="jd-card-row jd-card-row--tappable"
            onClick={onEditName}
            aria-label="Edit customer name"
          >
            <span className="jd-card-row-icon"><Icon name="customer" size={16} variant="muted" /></span>
            <span className="jd-card-row-val">{customer}</span>
            <span className="jd-card-row-edit" aria-hidden="true">›</span>
          </button>
        ) : (
          <div className="jd-card-row">
            <span className="jd-card-row-icon"><Icon name="customer" size={16} variant="muted" /></span>
            <span className="jd-card-row-val">{customer}</span>
          </div>
        )
      ) : (
        canEdit && (
          <button
            type="button"
            className="jd-card-row jd-card-row--add"
            onClick={onEditName}
            aria-label="Add customer name"
          >
            <span className="jd-card-row-icon"><Icon name="customer" size={16} variant="muted" /></span>
            <span className="jd-card-row-add">+ Add customer name</span>
          </button>
        )
      )}

      {/* Phone — tap number to edit; action chips (Call · Text · WhatsApp) below;
          ghost-button when empty. Chips only render when phone is present. */}
      {phone ? (
        <>
          {canEdit ? (
            <button
              type="button"
              className="jd-card-row jd-card-row--tappable"
              onClick={onEditPhone}
              aria-label="Edit customer phone"
            >
              <span className="jd-card-row-icon"><Icon name="phone" size={16} variant="muted" /></span>
              <span className="jd-card-row-val">{phone}</span>
              <span className="jd-card-row-edit" aria-hidden="true">›</span>
            </button>
          ) : (
            <div className="jd-card-row">
              <span className="jd-card-row-icon"><Icon name="phone" size={16} variant="muted" /></span>
              <span className="jd-card-row-val">{phone}</span>
            </div>
          )}
        </>
      ) : (
        canEdit && (
          <button
            type="button"
            className="jd-card-row jd-card-row--add"
            onClick={onEditPhone}
            aria-label="Add customer phone"
          >
            <span className="jd-card-row-icon"><Icon name="phone" size={16} variant="muted" /></span>
            <span className="jd-card-row-add">+ Add phone</span>
          </button>
        )
      )}

      {/* Address — tap text to edit; Navigate chip below still opens Maps.
          Read-only branch (canEdit false): whole row links to Maps.
          No-address branch: unchanged ghost-button for adding address. */}
      {address ? (
        canEdit ? (
          <>
            <div className="jd-card-row jd-card-row--split-action">
              {/* .jd-card-row-maps-tap kept for minimal diff — now triggers edit, not Maps */}
              <button
                type="button"
                className="jd-card-row-maps-tap"
                onClick={onEditAddress}
                aria-label="Edit customer address"
              >
                <span className="jd-card-row-icon"><Icon name="address" size={16} variant="muted" /></span>
                <span className="jd-card-row-val">{address}</span>
              </button>
              <button
                type="button"
                className="jd-card-row-edit-btn"
                onClick={onEditAddress}
                aria-label="Edit customer address"
              >
                <span aria-hidden="true">›</span>
              </button>
            </div>
          </>
        ) : (
          <a
            href={buildMapsUrl(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="jd-card-row jd-card-row--link"
            aria-label={`Open ${address} in Maps`}
          >
            <span className="jd-card-row-icon"><Icon name="address" size={16} variant="muted" /></span>
            <span className="jd-card-row-val">{address}</span>
          </a>
        )
      ) : (
        canEdit && (
          <button
            type="button"
            className="jd-card-row jd-card-row--add"
            onClick={onEditAddress}
            aria-label="Add address"
          >
            <span className="jd-card-row-icon"><Icon name="address" size={16} variant="muted" /></span>
            <span className="jd-card-row-add">+ Add address</span>
          </button>
        )
      )}

      {/* Email — ghost-button when empty */}
      {email ? (
        canEdit ? (
          <button
            type="button"
            className="jd-card-row jd-card-row--tappable"
            onClick={onEditEmail}
            aria-label="Edit customer email"
          >
            <span className="jd-card-row-icon"><Icon name="email" size={16} variant="muted" /></span>
            <span className="jd-card-row-val">{email}</span>
            <span className="jd-card-row-edit" aria-hidden="true">›</span>
          </button>
        ) : (
          <a href={`mailto:${email}`} className="jd-card-row jd-card-row--link">
            <span className="jd-card-row-icon"><Icon name="email" size={16} variant="muted" /></span>
            <span className="jd-card-row-val">{email}</span>
          </a>
        )
      ) : (
        canEdit && (
          <button
            type="button"
            className="jd-card-row jd-card-row--add"
            onClick={onEditEmail}
            aria-label="Add customer email"
          >
            <span className="jd-card-row-icon"><Icon name="email" size={16} variant="muted" /></span>
            <span className="jd-card-row-add">+ Add email</span>
          </button>
        )
      )}

      {/* Description — ghost-button when empty */}
      {description ? (
        canEdit ? (
          <button
            type="button"
            className="jd-card-row jd-card-row--tappable"
            onClick={onEditDescription}
            aria-label="Edit job description"
          >
            <span className="jd-card-row-icon"><Icon name="note" size={16} variant="muted" /></span>
            <span className="jd-card-row-val">{description}</span>
            <span className="jd-card-row-edit" aria-hidden="true">›</span>
          </button>
        ) : (
          <div className="jd-card-row">
            <span className="jd-card-row-icon"><Icon name="note" size={16} variant="muted" /></span>
            <span className="jd-card-row-val">{description}</span>
          </div>
        )
      ) : (
        canEdit && (
          <button
            type="button"
            className="jd-card-row jd-card-row--add"
            onClick={onEditDescription}
            aria-label="Add job description"
          >
            <span className="jd-card-row-icon"><Icon name="note" size={16} variant="muted" /></span>
            <span className="jd-card-row-add">+ Add description</span>
          </button>
        )
      )}

      {/* Acceptance badge — shown in CustomerCard for any accepted quote.
          Deposit path: "Accepted by card deposit" (no signature image here).
          Signature path: "Accepted by {name}" + timestamp.
          The full handwritten signature image lives in DocumentsHub > Quotes tab. */}
      {job.acceptedSource === 'deposit_payment' && !job.acceptedSignature && (
        <div className="sig-accepted-card">
          <div className="sig-accepted-label">Accepted by card deposit</div>
          <div className="sig-accepted-source">
            Customer paid the deposit — quote accepted
          </div>
          {job.acceptedAt && (
            <div className="sig-accepted-date">
              {fmtDate(job.acceptedAt)}
            </div>
          )}
        </div>
      )}
      {job.acceptedAt && job.acceptedSource !== 'deposit_payment' && (
        <div className="sig-accepted-card">
          <div className="sig-accepted-label">
            Accepted by {job.acceptedName || 'customer'}
          </div>
          <div className="sig-accepted-source">
            {job.acceptedSource === 'remote' ? 'Signed remotely' : 'Signed on screen'}
          </div>
          <div className="sig-accepted-date">
            {fmtDate(job.acceptedAt)}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * MoneyCard — unified card showing headline quote in the label, plus costs/profit below.
 * Replaces ProfitRibbon in the Stacked Cards layout (PRD 2026-05-31).
 * Tapping opens ProfitBreakdownSheet (same behaviour as ProfitRibbon).
 * Hidden when job has no quote price.
 */
function MoneyCard({ quote, costs, profit, margin, onTap }) {
  if (!quote) return null;
  const marginColor = margin >= 30 ? 'var(--accent)' : margin >= 15 ? 'var(--warn)' : 'var(--danger)';
  const formattedQuote = typeof gbp === 'function' ? gbp(quote) : `£${quote.toFixed(2)}`;
  return (
    <button
      type="button"
      className="jd-card jd-card--money"
      onClick={onTap}
      aria-label={`Money — quoted ${formattedQuote}. Tap for profit breakdown.`}
    >
      <div className="jd-card-label">Money · Quoted {formattedQuote}</div>
      <div className="jd-money-rows">
        <div className="jd-money-row">
          <span className="jd-money-row-label">Costs</span>
          <span className="jd-money-row-val">{gbp(costs)}</span>
        </div>
        <div className="jd-money-row">
          <span className="jd-money-row-label">Profit</span>
          <span className="jd-money-row-val" style={{ color: marginColor, fontWeight: 700 }}>
            {gbp(profit)} · {margin}%
          </span>
        </div>
      </div>
    </button>
  );
}

/**
 * HintCard — slim stage-aware "Next: …" hint at the top of the scroll area.
 * No button — just the headline and optional micro-links.
 * The actual CTA lives in the sticky BottomActionBar.
 */
function HintCard({ content }) {
  if (!content) return null;
  const { headline } = content;
  return (
    <div className="jd-hint-card">
      <span className="jd-hint-label">Next</span>
      <span className="jd-hint-headline">{headline}</span>
    </div>
  );
}

/**
 * BottomActionBar — sticky bottom action bar inside the drawer.
 * Primary CTA for the current stage, always visible, thumb-zone positioned.
 * Padding uses env(safe-area-inset-bottom) ONLY — not --nav-clearance.
 * The global .bottom-nav is already hidden via body.overlay-open (index.css:600).
 */
function BottomActionBar({ content, handlers, isPaid = false }) {
  if (!content) return null;
  const { primaryCta } = content;
  const fireAction = (action) => {
    const fn = handlers?.[action];
    if (typeof fn === 'function') fn();
  };
  const isPrimaryDisabled =
    primaryCta.action === 'noop' ||
    primaryCta.label === 'Chased recently';
  return (
    <div className="jd-bottom-bar">
      <button
        type="button"
        className={`jd-bottom-bar-btn${isPaid ? ' jd-bottom-bar-btn--secondary' : ''}${isPrimaryDisabled ? ' jd-bottom-bar-btn--disabled' : ''}`}
        onClick={() => fireAction(primaryCta.action)}
        disabled={isPrimaryDisabled}
        aria-disabled={isPrimaryDisabled}
      >
        {primaryCta.label}
      </button>
    </div>
  );
}

/**
 * B2BSettingsRow — settings-style row below all cards, no card chrome.
 * B2B customer toggle on the right; label + helper text stacked on the left.
 * Fixes the "Business customerEnables statutory interest" rendering bug by
 * using display:block on the hint span (now via CSS class jd-b2b-hint).
 */
function B2BSettingsRow({ job, onToggle }) {
  if (!onToggle) return null;
  return (
    <label className="jd-b2b-row">
      <div className="jd-b2b-row-text">
        <span className="jd-b2b-row-label">Business customer</span>
        <span className="jd-b2b-hint">Enables statutory interest on final chase</span>
      </div>
      <input
        type="checkbox"
        className="jd-b2b-toggle-input"
        checked={!!job.isBusinessCustomer}
        onChange={onToggle}
        aria-label="Business customer — enables statutory late-payment interest on final chase"
      />
    </label>
  );
}

/**
 * ExcludeTaxRow — settings-style row, same visual pattern as B2BSettingsRow.
 * Lifted out of MoreDisclosure so it's always visible below the B2B row.
 * Only shown for non-CIS users (CIS users get exclude toggle inside JobTaxMeta).
 */
function ExcludeTaxRow({ job, onToggle }) {
  if (!onToggle) return null;
  return (
    <label className="jd-b2b-row">
      <div className="jd-b2b-row-text">
        <span className="jd-b2b-row-label">Exclude from tax pot</span>
        <span className="jd-exclude-tax-hint">Excludes this job from your tax pot calculation</span>
      </div>
      <input
        type="checkbox"
        className="jd-b2b-toggle-input"
        checked={!!job.excludeFromTax}
        onChange={onToggle}
        aria-label="Exclude from tax pot — excludes this job from your tax pot calculation"
      />
    </label>
  );
}

/**
 * Details section — contact (phone + email) only. Schedule edit was moved to
 * an inline block in the drawer body so it is clearly adjacent to the spine row
 * that triggers it, and never appears inside the Customer card unexpectedly.
 *
 * NOTE: "Created [date]" moved to ⋯ kebab menu (admin metadata, Design A).
 * Address and schedule live in SpineBlock above the fold.
 * Phone row is the canonical call affordance — the CONTACT card is removed.
 *
 * Customer field edit callbacks (all optional — rows degrade to read-only when absent):
 *   onEditPhone              – open EditFieldModal for customer phone
 *   onEditEmail              – open EditFieldModal for customer email
 * B2B toggle moved to B2BSettingsRow at the bottom of the drawer (Stacked Cards redesign,
 * Alaister override 2026-05-31).
 * Accepted signature moved to CustomerCard (now the top-of-scroll card).
 */
function DetailsSection({
  job,
  onEditPhone,
  onEditEmail,
}) {
  const hasPhone = !!(job.phone || job.customerPhone || job.mobile);
  const hasEmail = !!(job.email || job.customerEmail);
  const hasCompleted = !!job.completedAt;
  const hasHours = !!(job.hoursEstimate || job.hours);
  const canEditFields = typeof onEditPhone === 'function';

  const visible = hasPhone || hasEmail || hasCompleted || hasHours || canEditFields;
  if (!visible) return null;

  const phone = job.customerPhone || job.phone || job.mobile || '';
  const email = job.email || job.customerEmail || '';

  return (
    <div className="jd-section">
      <div className="jd-section-header">Customer</div>
      <div className="jd-section-body">

        {/* Phone — tap the number to call (native action sheet).
            › chevron opens EditFieldModal to change the number. */}
        {(hasPhone || canEditFields) && (
          hasPhone ? (
            <div className="jd-phone-action-row">
              <span className="jd-detail-icon"><Icon name="phone" size={16} variant="muted" /></span>
              <a
                href={`tel:${phone}`}
                className="jd-phone-action-val"
                aria-label={`Call ${phone}`}
              >
                {phone}
              </a>
              {canEditFields && (
                <button
                  type="button"
                  className="jd-phone-action-edit"
                  onClick={onEditPhone}
                  aria-label="Edit customer phone"
                >
                  ›
                </button>
              )}
            </div>
          ) : (
            canEditFields && (
              <button
                type="button"
                className="jd-detail-edit-row"
                onClick={onEditPhone}
                aria-label="Add customer phone"
              >
                <span className="jd-detail-edit-row-left">
                  <span className="jd-detail-icon"><Icon name="phone" size={16} variant="muted" /></span>
                  <span className="jd-detail-edit-row-add--dim">+ Add phone</span>
                </span>
                <span className="jd-detail-edit-chevron" aria-hidden="true">›</span>
              </button>
            )
          )
        )}

        {/* Email — always rendered when edit callback present (shows "+ Add" when empty) */}
        {(hasEmail || canEditFields) && (
          canEditFields ? (
            <button
              type="button"
              className="jd-detail-edit-row"
              onClick={onEditEmail}
              aria-label={hasEmail ? 'Edit customer email' : 'Add customer email'}
            >
              <span className="jd-detail-edit-row-left">
                <span className="jd-detail-icon"><Icon name="email" size={16} variant="muted" /></span>
                {hasEmail
                  ? <span className="jd-detail-edit-row-value">{email}</span>
                  : <span className="jd-detail-edit-row-add--dim">+ Add email</span>
                }
              </span>
              <span className="jd-detail-edit-chevron" aria-hidden="true">›</span>
            </button>
          ) : (
            <a href={`mailto:${email}`} className="jd-detail-row jd-detail-link">
              <span className="jd-detail-icon"><Icon name="email" size={16} variant="muted" /></span>
              <span>{email}</span>
            </a>
          )
        )}
        {hasCompleted && (
          <div className="jd-detail-row">
            <span className="jd-detail-icon"><Icon name="complete" size={16} variant="success" /></span>
            <span>Completed {fmtDate(job.completedAt)}</span>
          </div>
        )}
        {hasHours && (
          <div className="jd-detail-row">
            <span className="jd-detail-icon"><Icon name="hours" size={16} variant="muted" /></span>
            <span>{job.hoursEstimate || job.hours} hrs estimated</span>
          </div>
        )}

      </div>
    </div>
  );
}

/**
 * VisitRow — single tappable row inside the Schedule card.
 * "Mark done" is an always-visible pill; no swipe mechanic required.
 *
 * Props:
 *   visit      Visit object
 *   onTap      () → void — opens editor for this visit
 *   onMarkDone (visitId) → void
 *   canEdit    boolean
 */
const VISIT_STATUS_LABEL = {
  done:      'Done',
  today:     'Today',
  missed:    'Missed',
  planned:   'Upcoming',
  cancelled: 'Cancelled',
};

function VisitStatusPill({ status }) {
  return (
    <span className={`visit-status-pill visit-status-pill--${status}`} aria-label={VISIT_STATUS_LABEL[status]}>
      {VISIT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function VisitRow({ visit, onTap, onMarkDone, canEdit }) {
  const computedStatus = computeVisitStatus(visit);
  const isDone = computedStatus === 'done';

  const handleMarkDone = (e) => {
    e.stopPropagation();
    onMarkDone(visit.id);
  };

  // Format time display
  const timeStr = visit.start && visit.end
    ? ` · ${visit.start}–${visit.end}`
    : visit.start
    ? ` · ${visit.start}`
    : '';

  // Date display
  let dateStr = visit.date || 'No date';
  if (visit.date) {
    try {
      const d = new Date(visit.date + 'T00:00:00');
      dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    } catch { /* keep raw */ }
  }

  return (
    <div className="visit-row-wrap">
      <button
        type="button"
        className="jd-card-row jd-card-row--tappable visit-row-inner"
        onClick={onTap}
        aria-label={`Edit visit on ${dateStr}`}
      >
        <span className="jd-card-row-icon"><Icon name="date" size={16} variant="muted" /></span>
        <span className={`jd-card-row-val${isDone ? ' visit-row-val--done' : ''}`}>
          {dateStr}{timeStr}
          <VisitStatusPill status={computedStatus} />
        </span>
        {canEdit && <span className="jd-card-row-chevron" aria-hidden="true">›</span>}
      </button>

      {/* Always-visible "Mark done" pill — hidden once visit is done */}
      {canEdit && !isDone && (
        <button
          type="button"
          className="visit-mark-done"
          onClick={handleMarkDone}
          aria-label="Mark visit done"
        >
          Mark done
        </button>
      )}
    </div>
  );
}

function ScheduleFinishFooter({ job, jobVisits, canEdit, onEndJob, onSetTarget, onReopen, fmtDate }) {
  const targetFinishDate = job.targetFinishDate || null;
  const completedAt = job.completedAt || null;
  const isEnded = !!completedAt;
  const finishStatus = React.useMemo(() => computeFinishStatus(targetFinishDate, completedAt), [targetFinishDate, completedAt]);
  const defaultTargetDate = React.useMemo(() => {
    const withDates = [...jobVisits].filter(v => v.date).sort((a, b) => b.date.localeCompare(a.date));
    if (withDates.length > 0) return withDates[0].date;
    const t = new Date();
    return [t.getFullYear(), String(t.getMonth()+1).padStart(2,"0"), String(t.getDate()).padStart(2,"0")].join("-");
  }, [jobVisits]);
  const toneCls = finishStatus ? `jd-finish-status--${finishStatus.tone}` : "";
  const dateInputRef = React.useRef(null);
  const openTargetPicker = () => {
    const el = dateInputRef.current;
    if (!el) return;
    // showPicker() is the reliable way to open the native picker on a tap
    // (iOS Safari 16+, Android Chrome). Fall back to focus()+click() where
    // it's unavailable. Both are wrapped to swallow the NotAllowedError some
    // browsers throw when not called from a trusted gesture.
    try {
      if (typeof el.showPicker === 'function') { el.showPicker(); return; }
    } catch { /* fall through to focus fallback */ }
    try { el.focus(); el.click(); } catch { /* no-op */ }
  };
  return (
    <div className="jd-finish-line">
      <div className="jd-finish-target-row">
        <span className="jd-finish-target-lbl">{isEnded ? "Aimed for" : "Aiming to finish"}</span>
        {targetFinishDate ? (
          <>
            <span className="jd-finish-target-val">{fmtDate(targetFinishDate)}</span>
            {canEdit && !isEnded && (
              <button type="button" className="jd-finish-target-edit" onClick={openTargetPicker} aria-label="Edit target finish date">
                Edit
              </button>
            )}
          </>
        ) : (
          canEdit && !isEnded && (
            <button type="button" className="jd-finish-target-set" onClick={openTargetPicker} aria-label="Set target finish date">
              Set a date
            </button>
          )
        )}
        {canEdit && !isEnded && (
          <input
            ref={dateInputRef}
            type="date"
            className="jd-finish-date-input"
            value={targetFinishDate || defaultTargetDate}
            onChange={e => onSetTarget(e.target.value || null)}
            aria-hidden="true"
            tabIndex={-1}
          />
        )}
      </div>
      {isEnded && (
        <div className="jd-finish-actual-row">
          <span className="jd-finish-target-lbl">Finished</span>
          <span className="jd-finish-target-val">{fmtDate(completedAt)}</span>
        </div>
      )}
      {finishStatus && (
        <div className={`jd-finish-status ${toneCls}`} role="status">
          {finishStatus.tone === "ontrack" && <Icon name="check" size={14} variant="success" />}
          {finishStatus.tone === "overdue" && <Icon name="warning" size={14} variant="danger" />}
          {finishStatus.tone === "duetoday" && <Icon name="date" size={14} variant="brand" />}
          {' '}{finishStatus.label}
        </div>
      )}
      {canEdit && (
        isEnded ? (
          <button type="button" className="jd-finish-reopen-btn" onClick={onReopen}>Job ended — reopen</button>
        ) : (
          <button type="button" className="jd-finish-end-btn" onClick={onEndJob}>End job — today</button>
        )
      )}
    </div>
  );
}
/**
 * VisitEditorSheet — modal sheet for adding/editing a single visit.
 * Reuses the jd-schedule-edit-form chrome pattern.
 */
function VisitEditorSheet({ open, visit, onSave, onCancel }) {
  const [date, setDate] = React.useState('');
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [status, setStatus] = React.useState('planned');
  const [note, setNote] = React.useState('');

  // Sync fields when the sheet opens with a different visit
  React.useEffect(() => {
    if (open) {
      setDate(visit?.date || '');
      setStart(visit?.start || '');
      setEnd(visit?.end || '');
      setStatus(visit?.status || 'planned');
      setNote(visit?.note || '');
    }
  }, [open, visit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const handleSave = () => {
    if (!date) return;
    onSave({ date, start: start || undefined, end: end || undefined, status, note: note || undefined });
  };

  return (
    <div className="visit-editor-backdrop" role="dialog" aria-modal="true" aria-label="Edit visit">
      <div className="visit-editor-sheet">
        <div className="visit-editor-title">{visit?.id ? 'Edit visit' : 'Add visit'}</div>
        <div className="jd-schedule-edit-form">
          <div>
            <div className="jd-schedule-edit-label">Date</div>
            <input
              type="date"
              className="jd-schedule-edit-input"
              value={date}
              onChange={e => setDate(e.target.value)}
              aria-label="Visit date"
            />
          </div>
          <div>
            <div className="jd-schedule-edit-label">Time (optional)</div>
            <div className="jd-schedule-edit-time-row">
              <input
                type="time"
                className="jd-schedule-edit-input"
                value={start}
                onChange={e => setStart(e.target.value)}
                aria-label="Start time"
              />
              <input
                type="time"
                className="jd-schedule-edit-input"
                value={end}
                onChange={e => setEnd(e.target.value)}
                aria-label="End time"
                disabled={!start}
              />
            </div>
          </div>
          <div>
            <div className="jd-schedule-edit-label">Status</div>
            <select
              className="jd-schedule-edit-input"
              value={status}
              onChange={e => setStatus(e.target.value)}
              aria-label="Visit status"
            >
              <option value="planned">Upcoming</option>
              <option value="done">Done</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <div className="jd-schedule-edit-label">Note (optional)</div>
            <input
              type="text"
              className="jd-schedule-edit-input"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Plastering only / snag fix / etc."
              aria-label="Visit note"
              maxLength={200}
            />
          </div>
          <div className="jd-schedule-edit-footer">
            <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={!date}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * QuoteLineEditorSheet — bottom sheet for adding or editing a single quote line item.
 * Modelled on VisitEditorSheet: same backdrop/sheet chrome, same button pattern.
 *
 * Props:
 *   open     – boolean
 *   item     – { desc, cost, qty } or null (null = new item)
 *   onSave(item)   – called with { desc, cost } on Save
 *   onDelete()     – called when user taps Delete (only shown when item !== null)
 *   onCancel()     – called on Cancel / backdrop tap
 */
function QuoteLineEditorSheet({ open, item, onSave, onDelete, onCancel }) {
  const [desc, setDesc] = React.useState('');
  const [cost, setCost] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setDesc(item?.desc || '');
      setCost(item != null ? String(item.cost ?? '') : '');
    }
  }, [open, item]);

  if (!open) return null;

  const parsedCost = parseFloat(cost) || 0;
  const canSave = desc.trim().length > 0 || parsedCost > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({ desc: desc.trim(), cost: parsedCost });
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={item ? 'Edit line item' : 'Add line item'}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="modal-sheet edit-field-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-sheet-header">
          <h3 className="modal-sheet-title">{item ? 'Edit line' : 'Add a line'}</h3>
          <button type="button" className="modal-sheet-close" onClick={onCancel} aria-label="Close">✕</button>
        </div>
        <div className="edit-field-body">
          <div className="edit-field-group">
            <label className="edit-field-label">Description</label>
            <input
              type="text"
              className="edit-field-input"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="e.g. Labour, Materials, Skip hire"
              aria-label="Line item description"
              autoFocus
              maxLength={200}
            />
          </div>
          <div className="edit-field-group">
            <label className="edit-field-label">Amount (£)</label>
            <input
              type="number"
              className="edit-field-input"
              value={cost}
              onChange={e => setCost(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              aria-label="Line item amount"
              inputMode="decimal"
            />
          </div>
          <div className="edit-field-actions">
            {item && onDelete && (
              <button type="button" className="btn-ghost btn-ghost--danger" onClick={onDelete} style={{ marginRight: 'auto' }}>
                Delete
              </button>
            )}
            <button type="button" className="btn-ghost edit-field-cancel" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn-primary edit-field-save" onClick={handleSave} disabled={!canSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ProfitBarSection — hero + subline profit display.
 * "Materials" means actual receipts/expenses linked to the job (not quote lineItems).
 * Hidden entirely when job quote value is zero.
 *
 * Hero:    £{profit} profit · {margin}%   — large, bold, colour-coded by margin
 * Subline: from £{quote} quote · £{materials} materials — small, muted
 * Bar:     only shown when materials > 0 (no bar for pure-labour jobs)
 */
function ProfitBarSection({ job, receipts }) {
  const quote = job.total ?? job.amount ?? 0;
  if (!quote) return null;

  const materials = receipts
    .filter(r => r.jobId && (String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId)))
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const profit = quote - materials;
  const margin = quote > 0 ? Math.round((profit / quote) * 100) : 0;
  const matPct = quote > 0 ? Math.min((materials / quote) * 100, 100) : 0;

  const marginColor = margin >= 30 ? 'var(--accent)' : margin >= 15 ? 'var(--warn)' : 'var(--danger)';

  return (
    <div className="jd-section">
      <div className="jd-section-header">Profit</div>
      <div className="jd-section-body jd-profit-hero-body">
        <div className="jd-profit-hero" style={{ color: marginColor }}>
          {gbp(profit)} profit · {margin}%
        </div>
        <div className="jd-profit-subline">
          from {gbp(quote)} quote · {gbp(materials)} materials
        </div>
        {materials > 0 && (
          <>
            <div className="jd-profit-bar-track">
              <div
                className="jd-profit-bar-fill"
                style={{ background: `linear-gradient(90deg, var(--danger) ${matPct}%, var(--accent) ${matPct}%)` }}
              />
            </div>
            <div className="jd-profit-bar-labels">
              <span className="jd-profit-bar-label--materials">Materials {Math.round(matPct)}%</span>
              <span className="jd-profit-bar-label--profit">Profit {Math.round(100 - matPct)}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * JobTaxMeta — per-job CIS toggle (CIS users only) and exclude-from-tax toggle (all users).
 *
 * CIS-4: only rendered when profile.is_cis_subcontractor is true.
 *   Shows a CIS on/off toggle + a rate sub-selector (20/30/0) when on.
 *   Derived labour line: Labour £{labour} · −£{deduction} CIS.
 * CIS-5: exclude-from-tax toggle shown to all users below CIS.
 *   For non-CIS users it appears inside MoreDisclosure so it's unobtrusive.
 *   Stores both flags in job meta via onUpdateJob.
 *
 * onUpdateJob is optional — the section is read-only when absent.
 */
const CIS_RATE_OPTIONS = [
  { value: 20, label: '20%' },
  { value: 30, label: '30%' },
  { value: 0,  label: '0% Gross' },
];

function JobTaxMeta({ job, profile, quote, materials, onUpdateJob }) {
  const isCisUser = !!profile?.is_cis_subcontractor;
  const [showCisRates, setShowCisRates] = useState(false);

  // For CIS users: a job defaults ON at the profile default rate unless explicitly false.
  const cisOn = isCisUser ? job.cis !== false : false;
  const cisRate = job.cisRate != null ? Number(job.cisRate) : Number(profile?.cis_default_rate ?? 20);
  const excludeFromTax = !!job.excludeFromTax;

  // Derived labour = max(0, quote - materials); deduction = labour * rate/100
  const labour = Math.max(0, Number(quote || 0) - Number(materials || 0));
  const deduction = cisOn && cisRate > 0 ? labour * (cisRate / 100) : 0;

  if (!isCisUser && !onUpdateJob) return null;

  return (
    <div className="jd-tax-meta">
      {isCisUser && (
        <div className="jd-tax-meta__cis">
          <div className="jd-tax-meta__row">
            <span className="jd-tax-meta__label">CIS</span>
            {onUpdateJob ? (
              <button
                type="button"
                className={`jd-tax-meta__toggle${cisOn ? ' jd-tax-meta__toggle--on' : ''}`}
                onClick={() => {
                  onUpdateJob({ ...job, cis: !cisOn });
                  setShowCisRates(false);
                }}
                role="switch"
                aria-checked={cisOn}
              >
                {cisOn ? 'On' : 'Off'}
              </button>
            ) : (
              <span className="jd-tax-meta__value">{cisOn ? 'On' : 'Off'}</span>
            )}
          </div>

          {cisOn && (
            <>
              {deduction > 0 && (
                <p className="jd-tax-meta__math">
                  Labour {gbp(labour)} &middot; &minus;{gbp(deduction)} CIS ({cisRate}%)
                </p>
              )}
              {cisOn && cisRate === 0 && (
                <p className="jd-tax-meta__math">Gross status &mdash; no deduction</p>
              )}

              {onUpdateJob && (
                <>
                  <button
                    type="button"
                    className="jd-tax-meta__rate-toggle"
                    onClick={() => setShowCisRates(v => !v)}
                  >
                    Rate: {cisRate === 0 ? '0% Gross' : `${cisRate}%`} {showCisRates ? '▴' : '▾'}
                  </button>
                  {showCisRates && (
                    <div className="work-segments jd-tax-meta__rate-segs">
                      {CIS_RATE_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`work-segment${cisRate === opt.value ? ' work-segment--active' : ''}`}
                          onClick={() => {
                            onUpdateJob({ ...job, cis: true, cisRate: opt.value });
                            setShowCisRates(false);
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {!cisOn && (
            <p className="jd-tax-meta__off-label">Not a CIS job</p>
          )}
        </div>
      )}

      {/* Exclude-from-tax toggle — below CIS for CIS users, always available */}
      <div className="jd-tax-meta__row jd-tax-meta__row--exclude">
        <span className="jd-tax-meta__label jd-tax-meta__label--muted">Exclude from tax pot</span>
        {onUpdateJob ? (
          <button
            type="button"
            className={`jd-tax-meta__toggle jd-tax-meta__toggle--small${excludeFromTax ? ' jd-tax-meta__toggle--on' : ''}`}
            onClick={() => onUpdateJob({ ...job, excludeFromTax: !excludeFromTax })}
            role="switch"
            aria-checked={excludeFromTax}
          >
            {excludeFromTax ? 'On' : 'Off'}
          </button>
        ) : (
          <span className="jd-tax-meta__value">{excludeFromTax ? 'Yes' : 'No'}</span>
        )}
      </div>
      {excludeFromTax && (
        <p className="jd-tax-meta__exclude-hint">For money that isn&rsquo;t taxable income.</p>
      )}
    </div>
  );
}

/**
 * QuoteBreakdownSection — Schedule-mirror design (Iteration A, 2026-06-02).
 *
 * Read mode: each line item is a compact tappable row (desc · ×qty if >1 · £total · ›).
 *   Tap a row → QuoteLineEditorSheet for that specific item.
 *   Tap "+ Add a line" ghost row → QuoteLineEditorSheet pre-filled empty.
 *   Footer total shown whenever there's at least one line item.
 *
 * The old inline edit mode (editMode / editItems / onToggleEdit / etc.) is replaced by
 * the per-row sheet pattern. Props kept for backwards compat but only onSaveLine /
 * onDeleteLine / onAddLine are used.
 *
 * Props:
 *   job           – job object (reads job.lineItems)
 *   onSaveLine(idx, { desc, cost }) – persist edited item (idx = -1 for new)
 *   onDeleteLine(idx)               – remove item at idx
 */
function QuoteBreakdownSection({ job, onSaveLine, onDeleteLine }) {
  const items = Array.isArray(job.lineItems) ? job.lineItems.filter(i => i.desc || i.cost) : [];

  // sheetIdx: null = closed, -1 = new item, 0+ = editing existing item
  const [sheetIdx, setSheetIdx] = React.useState(null);

  const sheetOpen = sheetIdx !== null;
  const sheetItem = sheetIdx != null && sheetIdx >= 0 ? items[sheetIdx] : null;

  const handleSave = ({ desc, cost }) => {
    onSaveLine(sheetIdx, { desc, cost });
    setSheetIdx(null);
  };

  const handleDelete = () => {
    onDeleteLine(sheetIdx);
    setSheetIdx(null);
  };

  const quoteTotal = items.reduce((sum, i) => {
    const qty = Number(i.qty || i.quantity || 1);
    const unit = Number(i.cost || i.unitCost || i.price || 0);
    return sum + qty * unit;
  }, 0);

  const canEdit = !!onSaveLine;

  return (
    <>
      <div className="jd-section">
        <div className="jd-section-body jd-section-body--flush">
          {items.length === 0 ? (
            canEdit && (
              <div className="jd-add-pill-row jd-add-pill-row--end">
                <button
                  type="button"
                  className="jd-add-dashed jd-add-dashed--ghost"
                  onClick={() => setSheetIdx(-1)}
                  aria-label="Add a line item"
                >
                  + Add line
                </button>
              </div>
            )
          ) : (
            <>
              {items.map((item, idx) => {
                const qty = Number(item.qty || item.quantity || 1);
                const unit = Number(item.cost || item.unitCost || item.price || 0);
                const lineTotal = qty * unit;
                if (canEdit) {
                  return (
                    <button
                      key={idx}
                      type="button"
                      className="jd-card-row jd-card-row--tappable jd-card-row--quote"
                      onClick={() => setSheetIdx(idx)}
                      aria-label={`Edit line item: ${item.desc || 'Line item'}`}
                    >
                      <span className="jd-card-row-icon jd-card-row-icon--clip" aria-hidden="true"><Icon name="lead" size={16} variant="muted" /></span>
                      <span className="jd-card-row-val jd-card-row-val--flex">
                        <span className="jd-line-item-desc">
                          {item.desc || '—'}
                          {qty > 1 && (
                            <span className="jd-line-item-qty"> × {qty}</span>
                          )}
                        </span>
                        <span className="jd-line-item-cost">{gbp(lineTotal)}</span>
                      </span>
                      <span className="jd-card-row-chevron" aria-hidden="true">›</span>
                    </button>
                  );
                }
                return (
                  <div key={idx} className="jd-line-item">
                    <span className="jd-line-item-desc">
                      {item.desc || '—'}
                      {qty > 1 && (
                        <span className="jd-line-item-qty"> × {qty}</span>
                      )}
                    </span>
                    <span className="jd-line-item-cost">{gbp(lineTotal)}</span>
                  </div>
                );
              })}
              {canEdit && (
                <div className="jd-add-pill-row jd-add-pill-row--end">
                  <button
                    type="button"
                    className="jd-add-dashed jd-add-dashed--ghost"
                    onClick={() => setSheetIdx(-1)}
                    aria-label="Add another line item"
                  >
                    + Add line
                  </button>
                </div>
              )}
              <div className="jd-quote-footer-total">
                <span className="jd-quote-footer-label">Total</span>
                <span className="jd-quote-footer-amount">{gbp(quoteTotal)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <QuoteLineEditorSheet
        open={sheetOpen}
        item={sheetItem}
        onSave={handleSave}
        onDelete={sheetIdx >= 0 ? handleDelete : undefined}
        onCancel={() => setSheetIdx(null)}
      />
    </>
  );
}

// QuickContactSection removed (Design A) — the phone row in DetailsSection
// (Customer card) is the canonical tap-to-call affordance.
// The duplicate Call/Text button grid is gone. Space reclaimed.

/**
 * DocumentRecordRow has been removed (Design 2 supersedes it).
 * The hub in DocumentsHub.jsx now owns the timeline, audit line, View PDF,
 * and gated signature reveal. The data layer (documentRecord.js, chip CSS,
 * downloadQuotePDF/downloadInvoicePDF) is retained — the hub imports them
 * directly. (Removed: feat/document-records-design2, 2026-06.)
 */

/**
 * Receipts section — receipts linked to this job via jobId.
 * Tapping a receipt with a photo opens the photo lightbox.
 * Always renders (even with no linked receipts) when onAddReceipt is present,
 * so the "+ Add receipt" CTA is discoverable on jobs with no materials yet.
 *
 * onDeleteReceipt(id) — optional; when present, each receipt row gets an × button.
 */
/**
 * ReceiptsSection renders as a pill chip when there are no receipts (empty state),
 * or as a full section when at least one receipt exists.
 * Returns { pillChip: ReactElement | null, section: ReactElement | null } so the
 * parent can group all empty-section pills together on one row.
 */
/**
 * ReceiptsSection — receipts linked to this job via jobId.
 *
 * Row tap behaviour (unified):
 *   - Receipt HAS a photo → row tap opens PhotoLightbox with label/amount/date
 *     detail bar and an Edit button (via onReceiptRowTap).
 *   - Receipt has NO photo → row tap opens the edit sheet directly (same as before).
 *   - The × delete button is independent and unaffected.
 *
 * The old separate thumbnail-tap-to-enlarge is removed — the row tap now does
 * the right thing for both photo and no-photo receipts.
 */
/**
 * Single receipt row that resolves a Supabase-storage imagePath to a signed
 * URL on mount — mirroring the PhotoThumb pattern for job photos.
 *
 * Receipt photo sources (in priority order):
 *   1. r.photo — a base64 data-URL written by legacy localStorage path, OR
 *      a previously-resolved URL already in state (rare).
 *   2. r.imagePath — a Supabase storage path (cloud receipts).  Resolved to
 *      a 1-hour signed URL via getReceiptSignedUrl().
 *
 * When neither is set the row shows a plain receipt icon (no photo).
 */
function ReceiptRow({ r, isRowTappable, onRowTap, onDeleteReceipt, onReceiptRowTap }) {
  // Seed with whatever the receipt already carries (base64 or nothing).
  const [resolvedPhoto, setResolvedPhoto] = useState(r.photo || null);

  useEffect(() => {
    // Already have a usable URL — nothing to resolve.
    if (resolvedPhoto) return;
    // Cloud receipt with a storage path but no pre-resolved photo.
    if (!r.imagePath) return;
    let cancelled = false;
    getReceiptSignedUrl(r.imagePath).then((url) => {
      if (!cancelled && url) setResolvedPhoto(url);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.imagePath]);

  const hasPhoto = !!resolvedPhoto;

  const handleTap = () => {
    if (hasPhoto && onReceiptRowTap) {
      // Pass the receipt with the resolved photo URL so the lightbox can show it.
      onReceiptRowTap({ ...r, photo: resolvedPhoto });
    } else if (!hasPhoto && onRowTap) {
      onRowTap(r);
    }
  };

  return (
    <div
      className={`jd-receipt-row${isRowTappable ? ' jd-receipt-row--tappable' : ''}`}
      onClick={isRowTappable ? handleTap : undefined}
      role={isRowTappable ? 'button' : undefined}
      tabIndex={isRowTappable ? 0 : undefined}
      onKeyDown={isRowTappable ? e => { if (e.key === 'Enter' || e.key === ' ') handleTap(); } : undefined}
      aria-label={
        hasPhoto
          ? `View ${r.label || 'Receipt'} — tap to enlarge`
          : isRowTappable
          ? `Edit receipt ${r.label || 'Receipt'}`
          : undefined
      }
    >
      {hasPhoto ? (
        <div className="jd-receipt-icon" aria-hidden="true">
          <img src={resolvedPhoto} alt="" className="jd-receipt-thumb" />
        </div>
      ) : (
        <div className="jd-receipt-icon"><Icon name="receipt" size={16} variant="muted" /></div>
      )}
      <div className="jd-receipt-meta">
        <div className="jd-receipt-label">{r.label || 'Receipt'}</div>
        {r.date && <div className="jd-receipt-date">{fmtDate(r.date)}</div>}
      </div>
      <div className="jd-receipt-right">
        {isRowTappable && <span className="jd-receipt-chevron" aria-hidden="true">›</span>}
        <div className="jd-receipt-amount">{gbp(r.amount || 0)}</div>
        {onDeleteReceipt && (
          <button
            type="button"
            className="jd-receipt-delete-btn"
            onClick={e => { e.stopPropagation(); onDeleteReceipt(r.id); }}
            aria-label="Delete receipt"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function ReceiptsSection({ job, receipts, onAddReceipt, onDeleteReceipt, onEditReceipt, onReceiptRowTap }) {
  // receipts shape from getTodayReceipts: { id, label, amount, photo, date, jobId, imagePath }
  // Match on both string UUID (cloud) and legacy integer-style IDs
  const jobReceipts = receipts.filter(r => {
    if (!r.jobId) return false;
    return String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId);
  });

  // Nothing to show and no handler — render nothing
  if (jobReceipts.length === 0 && !onAddReceipt) return null;

  const isRowTappable = !!(onReceiptRowTap || onEditReceipt);

  // handleEditFallback is used by ReceiptRow when a receipt has no photo
  const handleEditFallback = onEditReceipt || null;

  const receiptRows = jobReceipts.map(r => (
    <ReceiptRow
      key={r.id}
      r={r}
      isRowTappable={isRowTappable}
      onRowTap={handleEditFallback}
      onDeleteReceipt={onDeleteReceipt}
      onReceiptRowTap={onReceiptRowTap}
    />
  ));

  // Empty state: ghost row (consistent with Schedule / Customer card pattern)
  if (jobReceipts.length === 0) {
    return (
      <div className="jd-section-body jd-section-body--flush">
        <button
          type="button"
          className="jd-card-row jd-card-row--add"
          onClick={onAddReceipt}
          aria-label="Add receipt"
        >
          <span className="jd-card-row-icon"><Icon name="receipt" size={16} variant="muted" /></span>
          <span className="jd-card-row-add">+ Add receipt</span>
        </button>
      </div>
    );
  }

  // Populated state: receipt rows + add-another ghost row at the bottom
  return (
    <div className="jd-section-body jd-section-body--flush">
      {receiptRows}
      {onAddReceipt && (
        <button
          type="button"
          className="jd-card-row jd-card-row--add"
          onClick={onAddReceipt}
          aria-label="Add another receipt"
        >
          <span className="jd-card-row-icon"><Icon name="add" size={16} variant="muted" /></span>
          <span className="jd-card-row-add">+ Add receipt</span>
        </button>
      )}
    </div>
  );
}

/**
 * Single photo thumbnail that resolves a signed URL when the entry is a
 * bucket-path object `{ path, uploadedAt }`, or renders the string directly
 * for legacy base64 entries.
 *
 * Supports:
 *   - Tap to enlarge (lightbox)
 *   - Delete button (× overlay)
 *   - Caption display + inline edit (new-format entries only)
 *   - Drag handle for reordering (shown when onReorder is provided)
 *
 * Drag-to-reorder uses the HTML5 drag-and-drop API which works on desktop
 * and Android Chrome. iOS Safari requires a long-press polyfill — we use
 * up/down arrow buttons as the mobile-first reorder affordance instead.
 *
 * @param {{
 *   entry: string|object,
 *   index: number,
 *   total: number,
 *   onViewPhoto: function,
 *   onDeletePhoto?: function,
 *   onSetCaption?: function(index, caption),
 *   onReorder?: function(fromIdx, toIdx),
 * }} props
 */
function PhotoThumb({ entry, index, total, onViewPhoto, onDeletePhoto, onSetCaption, onReorder }) {
  const isLegacy = isLegacyPhoto(entry);
  const [resolvedSrc, setResolvedSrc] = useState(isLegacy ? entry : null);
  const [captionEditing, setCaptionEditing] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');

  useEffect(() => {
    if (isLegacy) return;
    let cancelled = false;
    getSignedPhotoUrl(entry.path, 3600).then((url) => {
      if (!cancelled && url) setResolvedSrc(url);
    });
    return () => { cancelled = true; };
  }, [isLegacy, entry]);

  const caption = isLegacy ? '' : getCaption(entry);

  const handleCaptionSave = () => {
    if (onSetCaption) onSetCaption(index, captionDraft);
    setCaptionEditing(false);
  };

  const handleCaptionCancel = () => {
    setCaptionEditing(false);
  };

  const handleCaptionOpen = () => {
    setCaptionDraft(caption);
    setCaptionEditing(true);
  };

  if (!resolvedSrc) {
    return (
      <div className="jd-photo-thumb-wrap">
        <div className="jd-photo-thumb-placeholder" aria-label={`Photo ${index + 1} loading`} />
      </div>
    );
  }

  return (
    <div className="jd-photo-thumb-wrap">
      <button
        type="button"
        className="jd-photo-thumb-btn"
        onClick={() => onViewPhoto(resolvedSrc)}
        aria-label={`View photo ${index + 1}`}
      >
        <img src={resolvedSrc} alt={caption || ''} className="jd-photo-thumb" />
      </button>

      {onDeletePhoto && (
        <button
          type="button"
          className="jd-photo-delete-btn"
          onClick={() => onDeletePhoto(index)}
          aria-label={`Delete photo ${index + 1}`}
        >
          ✕
        </button>
      )}

      {/* Reorder arrows — mobile-first alternative to drag-and-drop.
          Up = move earlier in the array (lower index), Down = move later. */}
      {onReorder && total > 1 && (
        <div className="jd-photo-reorder-arrows" aria-label={`Reorder photo ${index + 1}`}>
          <button
            type="button"
            className="jd-photo-reorder-btn"
            onClick={() => onReorder(index, index - 1)}
            disabled={index === 0}
            aria-label="Move photo earlier"
          >
            ‹
          </button>
          <button
            type="button"
            className="jd-photo-reorder-btn"
            onClick={() => onReorder(index, index + 1)}
            disabled={index === total - 1}
            aria-label="Move photo later"
          >
            ›
          </button>
        </div>
      )}

      {/* Caption area — only for new-format entries */}
      {!isLegacy && onSetCaption && (
        captionEditing ? (
          <div className="jd-photo-caption-form">
            <input
              type="text"
              className="jd-photo-caption-input"
              value={captionDraft}
              onChange={e => setCaptionDraft(e.target.value)}
              placeholder="Add caption…"
              maxLength={120}
              aria-label={`Caption for photo ${index + 1}`}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleCaptionSave();
                if (e.key === 'Escape') handleCaptionCancel();
              }}
            />
            <div className="jd-photo-caption-actions">
              <button type="button" className="jd-photo-caption-cancel" onClick={handleCaptionCancel}>
                Cancel
              </button>
              <button type="button" className="jd-photo-caption-save" onClick={handleCaptionSave}>
                Save
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={`jd-photo-caption-row${caption ? '' : ' jd-photo-caption-row--empty'}`}
            onClick={handleCaptionOpen}
            aria-label={caption ? `Edit caption: ${caption}` : `Add caption to photo ${index + 1}`}
          >
            {caption || '+ caption'}
          </button>
        )
      )}

      {/* Caption read-only (no edit handler — e.g. view-only mode) */}
      {!isLegacy && !onSetCaption && caption && (
        <div className="jd-photo-caption-readonly">{caption}</div>
      )}
    </div>
  );
}

/**
 * Photos section — photos attached directly to the job (job.photos[]).
 * Tap a thumbnail to enlarge via PhotoLightbox.
 * Always renders when onAddPhoto is provided so the CTA is discoverable
 * even when there are no photos yet.
 *
 * Handles mixed photo formats:
 *   - Legacy: string (base64 data-URL) — rendered directly
 *   - New:    { path, uploadedAt, caption? } — resolved via signed URL
 *
 * The file input and its ref live in JobDetailDrawer (the parent) because
 * the async compression handler needs access to onUpdateJob. This component
 * receives onAddPhoto (a function that triggers photoInputRef.current.click())
 * and photoAdding (a loading flag) for display purposes.
 *
 * onDeletePhoto(idx)           – optional; each thumbnail gets an × button.
 * onSetCaption(idx, caption)   – optional; enables per-photo caption editing.
 * onReorder(fromIdx, toIdx)    – optional; enables reorder arrows on thumbnails.
 */
function PhotosSection({
  photos,
  onViewPhoto,
  onAddPhoto,
  photoAdding,
  onDeletePhoto,
  onSetCaption,
  onReorder,
}) {
  const hasPhotos = Array.isArray(photos) && photos.length > 0;

  if (!hasPhotos && !onAddPhoto) return null;

  if (!hasPhotos && onAddPhoto) {
    return (
      <button
        type="button"
        className="jd-pill-chip"
        onClick={onAddPhoto}
        disabled={photoAdding}
        aria-label="Add photo"
      >
        {photoAdding ? 'Adding…' : '+ Add photo'}
      </button>
    );
  }

  return (
    <div className="jd-section">
      <div className="jd-section-header jd-section-header--with-action">
        <span>Photos</span>
        {onAddPhoto && (
          <button
            type="button"
            className="jd-section-action-btn"
            onClick={onAddPhoto}
            disabled={photoAdding}
            aria-label="Add photo"
          >
            {photoAdding ? 'Adding…' : '+ Add photo'}
          </button>
        )}
      </div>
      <div className="jd-section-body">
        <div className="jd-photos-grid">
          {photos.map((entry, i) => (
            <PhotoThumb
              key={isLegacyPhoto(entry) ? `legacy-${i}` : entry.path}
              entry={entry}
              index={i}
              total={photos.length}
              onViewPhoto={onViewPhoto}
              onDeletePhoto={onDeletePhoto}
              onSetCaption={onSetCaption}
              onReorder={onReorder}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Notes section — free-form job notes (job.jobNotes[] or job.notes string).
 * Always renders when the inline form is open or when edit props are present.
 * Otherwise hides when there is no notes content.
 *
 * Edit props (all optional — section degrades gracefully when absent):
 *   onOpenNoteForm  – opens the inline form (used by "+ Add note" button)
 *   noteFormOpen    – boolean controlling whether the inline form is expanded
 *   noteSubject     – controlled value for subject input
 *   noteBody        – controlled value for body textarea
 *   onNoteSubjectChange / onNoteBodyChange – onChange handlers
 *   onSubmitNote    – fires when Save is tapped
 *   onCancelNote    – fires when Cancel is tapped (collapses form, no save)
 *   onDeleteNote(id) – optional; when present, each note gets a Delete button
 */
function NotesSection({
  job,
  onOpenNoteForm,
  noteFormOpen,
  noteSubject,
  noteBody,
  onNoteSubjectChange,
  onNoteBodyChange,
  onSubmitNote,
  onCancelNote,
  onDeleteNote,
  onEditNote,
}) {
  const structuredNotes = Array.isArray(job.jobNotes) ? job.jobNotes : [];
  // cloud jobs may have a plain notes string instead of the structured array
  const plainNotes = typeof job.notes === 'string' ? job.notes.trim() : '';

  const hasContent = structuredNotes.length > 0 || !!plainNotes;
  const canAdd = typeof onOpenNoteForm === 'function';

  // Nothing to display and no way to add — render nothing
  if (!hasContent && !canAdd) return null;

  // Empty + has handler + form not open → pill chip (rendered by parent in the empty-pill row)
  if (!hasContent && canAdd && !noteFormOpen) {
    return (
      <button
        type="button"
        className="jd-pill-chip"
        onClick={onOpenNoteForm}
        aria-label="Add note"
      >
        + Add note
      </button>
    );
  }

  return (
    <div className="jd-section">
      <div className="jd-section-header jd-section-header--with-action">
        <span>Notes</span>
        {canAdd && !noteFormOpen && (
          <button
            type="button"
            className="jd-section-action-btn"
            onClick={onOpenNoteForm}
            aria-label="Add note"
          >
            + Add note
          </button>
        )}
      </div>
      <div className="jd-section-body">
        {/* Inline add-note form — only when canAdd and form is open */}
        {canAdd && noteFormOpen && (
          <div className="jd-note-form">
            <input
              type="text"
              className="jd-note-form-subject"
              placeholder="Subject (e.g. Site visit, Customer request)"
              value={noteSubject}
              onChange={e => onNoteSubjectChange(e.target.value)}
              aria-label="Note subject"
            />
            <textarea
              className="jd-note-form-body"
              placeholder="Write your note…"
              value={noteBody}
              onChange={e => onNoteBodyChange(e.target.value)}
              rows={3}
              aria-label="Note body"
            />
            <div className="jd-note-form-actions">
              <button
                type="button"
                className="btn-ghost jd-note-form-cancel"
                onClick={onCancelNote}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary jd-note-form-save"
                onClick={onSubmitNote}
                disabled={!noteBody?.trim()}
              >
                Save note
              </button>
            </div>
          </div>
        )}

        {plainNotes && (
          <p className="jd-note-plain">{plainNotes}</p>
        )}
        {structuredNotes.length > 0 && (
          <div className="jd-notes-list">
            {[...structuredNotes].reverse().map(n => (
              <div key={n.id} className="jd-note-card">
                <div className="jd-note-meta">
                  <span className="jd-note-subject">{n.subject || 'Note'}</span>
                  <span className="jd-note-date">
                    {n.date
                      ? new Date(n.date).toLocaleString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })
                      : ''}
                  </span>
                </div>
                <p className="jd-note-body">{n.body}</p>
                <div className="jd-note-actions">
                  {onEditNote && (
                    <button
                      type="button"
                      className="jd-note-edit-btn"
                      onClick={() => onEditNote(n)}
                      aria-label="Edit note"
                    >
                      Edit
                    </button>
                  )}
                  {onDeleteNote && (
                    <button
                      type="button"
                      className="jd-note-delete-btn"
                      onClick={() => onDeleteNote(n.id)}
                      aria-label="Delete note"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * CollapsibleRow — a tap-to-expand one-liner summary for a drawer section.
 *
 * Used in stage-aware Direction 2 layout to collapse sections that aren't
 * the focus at the current stage (e.g. Profit on Invoiced, Customer on all
 * stages, Quote on Invoiced/Paid).
 *
 * Props:
 *   id         – unique id; used for aria-controls on the trigger button
 *   icon       – emoji or single character icon (14px, left side)
 *   title      – section name (e.g. "Profit", "Customer", "Quote")
 *   summary    – one-line summary text (e.g. "£333 · 100% margin")
 *   expanded   – boolean from parent expandedSections Set
 *   onToggle   – called when the row is tapped; parent updates expandedSections
 *   children   – full section content rendered when expanded
 */
function CollapsibleRow({ id, icon, title, summary, expanded, onToggle, children }) {
  const panelId = `jd-collapse-panel-${id}`;
  const triggerId = `jd-collapse-trigger-${id}`;

  return (
    <div className="jd-collapsible">
      <button
        id={triggerId}
        type="button"
        className="jd-collapsible-row"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <span className="jd-collapsible-icon" aria-hidden="true">{icon}</span>
        <span className="jd-collapsible-title">{title}</span>
        {!expanded && summary && (
          <span className="jd-collapsible-summary">{summary}</span>
        )}
        <span className="jd-collapsible-chev" aria-hidden="true">
          {expanded ? '▴' : '›'}
        </span>
      </button>
      {expanded && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          className="jd-collapsible-panel"
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ── DepositPaidBadge ──────────────────────────────────────────────────────

/**
 * DepositPaidBadge — amber-toned badge shown in the drawer when a job has a
 * paid deposit. Renders above the main payment block (PR 4).
 *
 * Props:
 *   job              — full job object (uses deposit_paid_at, deposit_amount_pence)
 *   depositToken     — invoice_payment_tokens row for the deposit (may be null)
 *   totalAmount      — job gross total (pounds, number)
 */
function DepositPaidBadge({ job, depositToken, totalAmount }) {
  if (!job?.deposit_paid_at) return null;

  const depositPence = job.deposit_amount_pence || depositToken?.amount_pence || 0;
  const depositGbp = depositPence > 0 ? gbp(depositPence / 100) : '';
  const rawBalance = totalAmount - depositPence / 100;
  const balanceClamped = Math.max(0, rawBalance);
  const balanceGbp = depositPence > 0 ? gbp(balanceClamped) : '';
  // Negative balance means the trader has edited the quote total below the
  // already-paid deposit — flag it so they know to refund the difference.
  const depositExceedsTotal = depositPence > 0 && rawBalance < 0;

  let dateLabel = '';
  try {
    const d = new Date(job.deposit_paid_at);
    dateLabel = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { /* silently skip */ }

  const receiptUrl = depositToken?.receipt_url ?? null;
  const paymentIntentId = depositToken?.stripe_payment_intent_id ?? null;
  const stripePaymentUrl = paymentIntentId
    ? `https://dashboard.stripe.com/payments/${paymentIntentId}`
    : 'https://dashboard.stripe.com/payments';

  return (
    <div className="deposit-paid-badge">
      <div className="deposit-paid-badge__title">
        Deposit paid{depositGbp ? ` · ${depositGbp}` : ''}
      </div>
      <div className="deposit-paid-badge__meta">
        Card{dateLabel ? ` · ${dateLabel}` : ''}
        {receiptUrl && (
          <> &middot; <a href={receiptUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: 'inherit', textDecoration: 'underline' }}>Receipt</a></>
        )}
        {' '}&middot;{' '}
        <a href={stripePaymentUrl} target="_blank" rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline' }}>Refund &#x2197;</a>
      </div>
      {depositExceedsTotal ? (
        <div className="deposit-balance-due deposit-balance-due--warn">
          Deposit exceeds new total — refund the difference via Stripe
        </div>
      ) : (
        balanceGbp && (
          <div className="deposit-balance-due">
            Balance due on completion: <strong>{balanceGbp}</strong>
          </div>
        )
      )}
    </div>
  );
}

// ── CardPaymentBlock ──────────────────────────────────────────────────────

/**
 * CardPaymentBlock — shown in the drawer when a job was paid by card via Stripe.
 * Brief Section 2.4 / wireframe 4.5.
 *
 * Props:
 *   job   — the full job object (uses job.card_paid_at, job.total)
 *   token — the invoice_payment_tokens row fetched from Supabase (may be null
 *            while loading or if the webhook hasn't completed yet)
 *
 * Refunded state (full):  "Refunded · £540.00"
 * Refunded state (partial): "Paid · £540.00 (refunded £100.00)"
 * Paid state: "Paid in full · £540.00" + fee breakdown + buttons
 *
 * [Receipt] — links to Stripe-hosted receipt URL (opens new tab).
 * [Refund]  — deep-links to Stripe dashboard payment page per brief decision #4.
 *             No in-app refund UI in v1.
 */
function CardPaymentBlock({ job, token }) {
  const grossPence = token?.amount_pence ?? Math.round((Number(job.total ?? job.amount ?? 0)) * 100);
  const feePence   = token?.fee_pence ?? 0;
  const netPence   = token?.net_pence ?? 0;
  const receiptUrl = token?.receipt_url ?? null;
  const refundedPence = token?.refunded_amount_pence ?? 0;
  const isFullRefund = token?.status === 'refunded';
  const isPartialRefund = !isFullRefund && refundedPence > 0;
  const paymentIntentId = token?.stripe_payment_intent_id ?? null;

  const grossGbp   = gbp(grossPence / 100);
  const feeGbp     = feePence > 0 ? gbp(feePence / 100) : null;
  const netGbp     = netPence > 0 ? gbp(netPence / 100) : null;
  const refundedGbp = gbp(refundedPence / 100);

  // Format the payment timestamp from card_paid_at or token.paid_at
  const rawTs = token?.paid_at || job.card_paid_at;
  let dateLabel = '';
  if (rawTs) {
    try {
      const d = new Date(rawTs);
      dateLabel = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
        ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      dateLabel = '';
    }
  }

  const stripePaymentUrl = paymentIntentId
    ? `https://dashboard.stripe.com/payments/${paymentIntentId}`
    : 'https://dashboard.stripe.com/payments';

  return (
    <div className="jd-card-payment-block">
      {isFullRefund ? (
        <div className="jd-card-payment-status jd-card-payment-status--refunded">
          Refunded · {grossGbp}
        </div>
      ) : (
        <div className="jd-card-payment-status jd-card-payment-status--paid">
          Paid in full · {grossGbp}
          {isPartialRefund && (
            <span className="jd-card-payment-partial-refund"> (refunded {refundedGbp})</span>
          )}
        </div>
      )}

      <div className="jd-card-payment-meta">
        Card payment{dateLabel ? ` · ${dateLabel}` : ''}
      </div>

      {feeGbp && netGbp && !isFullRefund && (
        <div className="jd-card-payment-fee-line">
          Stripe fee: {feeGbp} · Net to you: {netGbp}
        </div>
      )}

      <div className="jd-card-payment-actions">
        {receiptUrl && (
          <a
            href={receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="jd-card-payment-btn"
            aria-label="View Stripe receipt"
          >
            Receipt
          </a>
        )}
        <a
          href={stripePaymentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="jd-card-payment-btn jd-card-payment-btn--secondary"
          aria-label="Issue refund on Stripe dashboard (opens new tab)"
        >
          Refund &#x2197;
        </a>
      </div>

      {/* Chase stopped line — brief Section 2.4: "Chase stopped — paid in full"
          so the trader trusts the auto-reconcile worked. Shown below the block,
          not hidden, per the brief (don't hide chase tab, show stopped state). */}
      {!isFullRefund && (
        <div className="jd-card-payment-chase-stopped" aria-live="polite">
          Chase stopped — paid in full
        </div>
      )}
    </div>
  );
}

// ── Photo source chooser sheet ────────────────────────────────────────────

/**
 * PhotoSourceSheet — bottom action sheet that asks the user whether to take
 * a new photo or pick from their gallery.  Reuses .visit-editor-backdrop /
 * .visit-editor-sheet chrome so it matches the existing bottom-sheet look.
 *
 * Props:
 *   open            – boolean; controlled by parent
 *   onTakePhoto     – callback: close sheet then open camera input
 *   onUploadPhoto   – callback: close sheet then open gallery input
 *   onClose         – callback: close with no action
 *   triggerRef      – ref to the Add-photo button; focus returned on close
 */
function PhotoSourceSheet({ open, onTakePhoto, onUploadPhoto, onClose, triggerRef }) {
  const firstRowRef = React.useRef(null);

  // Focus first row on open; return focus to trigger on close
  React.useEffect(() => {
    if (open) {
      // rAF ensures the sheet is in the DOM before we focus
      const id = requestAnimationFrame(() => { firstRowRef.current?.focus(); });
      return () => cancelAnimationFrame(id);
    } else {
      triggerRef?.current?.focus();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes the sheet
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="photo-source-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Add photo — choose source"
      onClick={onClose}
    >
      <div
        className="photo-source-sheet"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          ref={firstRowRef}
          className="photo-source-row"
          onClick={onTakePhoto}
        >
          <span className="photo-source-icon"><Icon name="camera" size={20} variant="muted" /></span>
          Take photo
        </button>
        <button
          type="button"
          className="photo-source-row"
          onClick={onUploadPhoto}
        >
          <span className="photo-source-icon"><Icon name="photos" size={20} variant="muted" /></span>
          Upload from photos
        </button>
        <button
          type="button"
          className="photo-source-row photo-source-row--cancel"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

/**
 * JobDetailDrawer — bottom-sheet that slides up from the bottom of the screen.
 *
 * Pattern: backdrop + panel from the bottom, matching the mobile-first PWA
 * convention. Uses the same backdrop class as AccountDrawer but the panel
 * slides up rather than right (see .job-detail-sheet in index.css).
 *
 * Props:
 *   job                     – full job object (required)
 *   receipts                – flat receipts/expenses array from AppShell (filtered by jobId inside)
 *   biz                     – business settings (name, bank, VAT) — needed for invoice generation
 *   profile                 – Supabase profiles row or null — needed for paywall gating
 *   jobs                    – all jobs array — needed by nextInvoiceNumber to avoid gaps
 *   onUpdateJob(updatedJob)    – persists job field updates (photos, notes, invoiceSentAt etc.)
 *   onAddReceipt(arg)          – AppShell handler; arg = { payload, photoFile } (same shape as TodayScreen)
 *   onDeleteReceipt(receiptId) – AppShell handler; deletes from Supabase + localStorage mirror
 *   onAddPayment(job, payload) – from AppShell, persists to jobMeta side-channel
 *   onClose()                  – called when the sheet should close
 */
export default function JobDetailDrawer({
  job,
  receipts = [],
  biz,
  profile,
  jobs,
  onUpdateJob,
  onAddReceipt,
  onDeleteReceipt,
  onAddPayment,
  onClose,
  // Optional intent passed by WorkScreen when the drawer is opened with a
  // specific goal: 'quote' (user tapped "Send quote →" tile CTA) or
  // 'price' (user tried to advance stage without a price).
  intent = null,
  targetStage = null,
  onClearIntent,
  // Opens the shared ReceiptModal in WorkScreen for paid jobs.
  // Kept as an optional prop so the drawer degrades gracefully if
  // a parent doesn't wire it (e.g. TodayScreen).
  onViewReceipt,
  // Optional: called when the trader taps "Set up" in the Send Invoice connect prompt.
  // AppShell passes () => setSettingsSubView('card-payments').
  onNavigateToCardPayments,
  // Optional: saves a partial profile update to Supabase. Threaded from AppShell via
  // WorkScreen so SendInvoiceModal can persist bank details just-in-time.
  onProfileUpdate,
  // When set, the drawer immediately opens the edit modal for this field on mount.
  // Used by the Call/Map tile buttons to redirect to data entry when the field is empty.
  initialEditingField = null,
  // Called once the initialEditingField has been consumed so WorkScreen can clear it.
  onClearInitialEditingField,
}) {
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  // reviewSheetMode: null = closed, 'quote' | 'invoice' = open in that mode
  const [reviewSheetMode, setReviewSheetMode] = useState(null);
  // When the user taps "Edit quote/invoice" inside ReviewSheet, we close the
  // sheet, open the price editor, and set this so handleAmountSave knows to
  // re-open ReviewSheet automatically after saving.
  const postEditReopenReview = useRef(null); // null | 'quote' | 'invoice'
  // Documents hub — replaces the two Design 1 Quotes/Invoices record accordions
  const [docsHubOpen, setDocsHubOpen] = useState(false);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [sigPadOpen, setSigPadOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  // When the lightbox was opened from a receipt row, store the receipt object
  // so the lightbox can show its label/amount/date and wire an Edit button.
  const [lightboxReceipt, setLightboxReceipt] = useState(null);
  const [toast, setToast] = useState(null);
  const [kebabOpen, setKebabOpen] = useState(false);
  const kebabRef = useRef(null);
  // Profit breakdown sheet — opened by ribbon tap or viewProfitBreakdown action
  const [profitSheetOpen, setProfitSheetOpen] = useState(false);

  // Photo add — refs for the two hidden file inputs (camera + gallery)
  // photoInputRef kept for any legacy callers that still reference it directly.
  const photoInputRef = useRef(null);   // legacy alias → points at galleryInputRef target
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const addPhotoBtnRef = useRef(null);  // focus-return target when sheet closes
  const [photoAdding, setPhotoAdding] = useState(false);
  // Photo source chooser sheet — opened when user taps "📷 Add photo"
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);

  // Note add — inline form state
  const [noteFormOpen, setNoteFormOpen] = useState(false);
  const [noteSubject, setNoteSubject] = useState('');
  const [noteBody, setNoteBody] = useState('');

  // Note edit — EditFieldModal composite, null = closed, otherwise the note being edited
  const [editingNote, setEditingNote] = useState(null);

  // Payment edit/delete — EditFieldModal composite + confirm dialog
  const [editingPayment, setEditingPayment] = useState(null);

  // Receipt edit — null = closed, otherwise the receipt being edited
  const [editingReceipt, setEditingReceipt] = useState(null);

  // Post-paid cost capture — shown after "Mark as Paid" shortcut in the drawer.
  // null = not shown; true = prompt is active for this job.
  const [postPaidCostActive, setPostPaidCostActive] = useState(false);

  // Price accordion expansion — incremented to programmatically expand the
  // Price CollapsedSectionRow when the header price button is tapped on a
  // priced job (Option A: header is a derived read-only sum, editing goes to
  // the line-item list, not a free-number field).
  const [priceAccordionExpandTick, setPriceAccordionExpandTick] = useState(0);
  // Ref on the Price accordion wrapper so we can scroll it into view on tap.
  const priceAccordionRef = useRef(null);

  // Visit editor sheet — multi-visit path
  // editingVisit: null (closed) | { ...Visit } (existing) | { _isNew: true } (add)
  const [editingVisit, setEditingVisit] = useState(null);
  // Send invoice prompt: shown when last visit is marked done and job isn't yet invoiced
  const [showInvoicePrompt, setShowInvoicePrompt] = useState(false);
  const [showReopenConfirm, setShowReopenConfirm] = useState(false);

  // In-app delete confirmation — replaces window.confirm for photo/receipt/note/payment deletes.
  // null = no confirm pending; otherwise { title, message, onConfirm }
  const [pendingDeleteAction, setPendingDeleteAction] = useState(null);

  // Customer field editing — single EditFieldModal controlled by this key.
  // null = closed; 'name' | 'phone' | 'email' | 'summary' = which field is open.
  const [editingField, setEditingField] = useState(null);

  // Close on Escape — also closes lightbox, photo sheet, kebab, or edit modals if open
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (lightboxSrc) { setLightboxSrc(null); setLightboxReceipt(null); return; }
        if (photoSheetOpen) { setPhotoSheetOpen(false); return; }
        if (kebabOpen) { setKebabOpen(false); return; }
        if (pendingDeleteAction) { setPendingDeleteAction(null); return; }
        if (editingField) { setEditingField(null); return; }
        if (editingNote) { setEditingNote(null); return; }
        if (editingPayment) { setEditingPayment(null); return; }
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, lightboxSrc, photoSheetOpen, kebabOpen, pendingDeleteAction, editingField, editingNote, editingPayment]);

  // Scroll-chain bug fix: lock body scroll while the drawer is open.
  // Saves and restores the prior scroll position so the user lands back
  // where they were when closing the drawer.
  // overlay-open hides the bottom nav pill so it doesn't paint over the sheet CTA.
  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('overlay-open');
    return () => {
      document.body.style.overflow = '';
      document.body.classList.remove('overlay-open');
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Close kebab when clicking outside it
  useEffect(() => {
    if (!kebabOpen) return;
    const onOutside = (e) => {
      if (kebabRef.current && !kebabRef.current.contains(e.target)) {
        setKebabOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [kebabOpen]);

  // Pre-fetch Pay-now URL when the drawer opens for a chase-eligible job belonging
  // to a connected trader. Fires once on drawer mount (job.id is stable for the
  // lifetime of a single drawer instance). The URL is available long before the
  // user taps the Chase button. Falls back to '' on any error so chase still works.
  const isDrawerConnected = profile?.stripe_connect_status === 'connected' && !!profile?.stripe_user_id;
  const [payNowUrl, setPayNowUrl] = useState('');

  useEffect(() => {
    if (!isDrawerConnected || !job?.id) return;
    // Only prefetch for chase-eligible statuses — avoids a pointless network call
    // for Lead / Quoted / On / Paid jobs that will never show the Chase button.
    const s = deriveDisplayStatus(job);
    if (s !== 'Invoiced' && s !== 'Overdue') return;
    if (!Number(job.total ?? job.amount ?? 0)) return;

    let cancelled = false;

    async function prefetch() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token || cancelled) return;
        const res = await fetch('/.netlify/functions/create-invoice-payment-link', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ invoiceId: job.id }),
        });
        if (!res.ok || cancelled) return;
        const { payUrl } = await res.json();
        if (!cancelled && payUrl) setPayNowUrl(payUrl);
      } catch (err) {
        console.warn('JobDetailDrawer: pay-now prefetch failed', err?.message);
        // falls back to '' — chase proceeds without Pay-now line
      }
    }

    prefetch();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDrawerConnected, job?.id]);

  // Fetch the card payment token row when the job has card_paid_at set.
  // This drives the paid-by-card block in the drawer (brief Section 2.4).
  // Hooks must sit before any early return — hooks rule binding (PR #125).
  const [cardPaymentToken, setCardPaymentToken] = useState(null);

  useEffect(() => {
    // Only fetch when the job was paid by card (card_paid_at is the canonical signal).
    if (!job?.card_paid_at || !job?.id) return;
    let cancelled = false;

    async function fetchToken() {
      try {
        const { data, error } = await supabase
          .from('invoice_payment_tokens')
          .select('status, paid_at, amount_pence, fee_pence, net_pence, receipt_url, refunded_amount_pence, stripe_payment_intent_id')
          .eq('invoice_id', job.id)
          .eq('kind', 'invoice')
          .in('status', ['paid', 'refunded'])
          .order('paid_at', { ascending: false })
          .limit(1)
          .single();
        if (!cancelled && !error && data) setCardPaymentToken(data);
      } catch {
        // Non-fatal — drawer renders without card block; no user action needed.
      }
    }

    fetchToken();
    return () => { cancelled = true; };
  }, [job?.id, job?.card_paid_at]);

  // Fetch the deposit token row when the job has deposit_paid_at set (PR 4).
  // Drives the DepositPaidBadge. Must sit before any early return (hooks rule).
  const [depositToken, setDepositToken] = useState(null);

  useEffect(() => {
    if (!job?.deposit_paid_at || !job?.id) return;
    let cancelled = false;

    async function fetchDepositToken() {
      try {
        // Prefer the FK from deposit_payment_token_id when available;
        // fall back to querying by quote_id + kind.
        let query = supabase
          .from('invoice_payment_tokens')
          .select('status, paid_at, amount_pence, fee_pence, net_pence, receipt_url, refunded_amount_pence, stripe_payment_intent_id')
          .eq('kind', 'deposit')
          .in('status', ['paid', 'refunded']);

        if (job.deposit_payment_token_id) {
          query = query.eq('id', job.deposit_payment_token_id);
        } else {
          query = query.eq('quote_id', job.id).order('paid_at', { ascending: false }).limit(1);
        }

        const { data, error } = await query.single();
        if (!cancelled && !error && data) setDepositToken(data);
      } catch {
        // Non-fatal
      }
    }

    fetchDepositToken();
    return () => { cancelled = true; };
  }, [job?.id, job?.deposit_paid_at, job?.deposit_payment_token_id]);

  const status = deriveDisplayStatus(job);
  const displayName = job.customer || job.name || 'Unnamed job';
  // Only show the customer sub-line when it's present and differs from the job name —
  // avoids duplicating text when customer_name was defaulted to the job name on creation.
  const distinctCustomer = (job.customer && job.customer.trim() && job.customer.trim() !== (job.summary || '').trim())
    ? job.customer.trim()
    : '';
  // First name for the Call CTA label — plain JS, safe anywhere (not a hook).
  const firstName = distinctCustomer ? distinctCustomer.trim().split(/\s+/)[0] : '';
  const showChase = shouldShowChase(job);

  // Invoice send CTA gating (still used for kebab menu items)
  const invoiceAlreadySent =
    status === 'Invoiced' || status === 'Paid' ||
    !!job.invoiceSentAt || job.status === 'invoice_sent';
  const showSendInvoice = status !== 'Paid' && !invoiceAlreadySent;
  const showResendInvoice = status !== 'Paid' && invoiceAlreadySent;

  // Pre-invoice flag: drives deposit mode in RecordPaymentModal and the
  // PaymentSummaryBlock variant (Received/Quote instead of Received/Balance).
  const isPreInvoiceJob = !invoiceAlreadySent && (
    status === 'Lead' || status === 'Quoted' || status === 'On'
  );
  const paymentModalMode = isPreInvoiceJob ? 'deposit' : 'payment';

  const tier = computeTier(job);
  const chaseBlocked = isDoubleSendBlocked(job.id);
  const daysOverdue = Math.max(0, daysPastDue(job));

  const handleChase = () => {
    if (chaseBlocked) return;

    // Manual chase at ALL tiers (0/1/2/3) is free for everyone.
    // The AUTOMATIC chase ladder (Settings → Chase reminders → Auto-chase) stays Pro-gated.
    const phone = resolvePhone(job);
    const outstanding = computeBalance(job);
    const amountPaid = computeAmountPaid(job);
    const paymentDetails = buildPaymentDetails(biz);
    const link = buildChaseLink({
      phone,
      customerName: job.customer || job.name || '',
      amount: gbp(outstanding),
      jobSummary: job.summary || '',
      dueDate: job.invoiceDueDate || null,
      daysOverdue,
      tier,
      amountPaid,
      paymentDetails,
      businessName: biz?.name || '',
      isB2B: !!job.isBusinessCustomer,
      payNowUrl,
    });
    if (!link) return;
    recordChase(job.id);
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  // flash callback passed down to modals so success toasts
  // appear in the drawer context
  const showFlash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ── Customer field editing ────────────────────────────────────────────────
  // Saves the canonical modern field for each of the 4 editable customer fields.
  // Legacy fallback fields (job.name, job.phone, job.mobile) are left untouched —
  // the fallback chains (e.g. customerPhone || phone || mobile) read modern first,
  // so writing to the canonical field takes precedence without needing a migration.
  const handleCustomerFieldSave = async (patch) => {
    if (!onUpdateJob) return;
    // patch is { [fieldKey]: newValue } from EditFieldModal
    const [fieldKey, rawValue] = Object.entries(patch)[0];
    const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    const canonicalMap = {
      customer: 'customer',
      customerPhone: 'customerPhone',
      email: 'email',
      summary: 'summary',
      address: 'address',
      description: 'description',
    };
    if (!canonicalMap[fieldKey]) return;
    onUpdateJob({ ...job, [fieldKey]: value || null });
  };

  // ── Price add / edit ─────────────────────────────────────────────────────
  // Called when the user taps "Edit quote/invoice" inside ReviewSheet.
  // Closes ReviewSheet without saving a draft (the user explicitly chose to edit),
  // records the mode so line-item save handlers can re-open ReviewSheet after
  // saving, and surfaces the price/line-items edit field immediately.
  // Option A (price-reconciliation PRD 2026-06-13): if the job has existing
  // line items, route to the Price accordion (not the free-number editor).
  const handleReviewEdit = (mode) => {
    postEditReopenReview.current = mode;
    setReviewSheetMode(null);
    const existingItems = Array.isArray(job.lineItems) ? job.lineItems.filter(i => i.desc || i.cost > 0) : [];
    if (existingItems.length > 0) {
      // Expand the Price accordion and scroll to it.
      setPriceAccordionExpandTick(t => t + 1);
      requestAnimationFrame(() => {
        priceAccordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } else {
      // No items yet — open the seed-line editor.
      setEditingField('amount');
    }
  };

  // Called by EditFieldModal when editingField === 'amount'.
  const handleAmountSave = (patch) => {
    if (!onUpdateJob) return;
    const n = Number(patch.amount);
    // Build a seed line item if none exist — matches the addJobToCloud convention.
    // Option A invariant (price-reconciliation PRD 2026-06-13): total must ALWAYS
    // equal sum(lineItems). If existing items exist, derive total from them rather
    // than from the free-typed number — this path should only be reached when the
    // job has NO existing line items (the header button routes priced jobs to the
    // accordion instead). The guard here ensures the invariant holds even if this
    // function is reached via intent/review paths while items already exist.
    const existingItems = Array.isArray(job.lineItems) ? job.lineItems.filter(i => i.desc || i.cost > 0) : [];
    let li;
    let derivedTotal;
    if (existingItems.length > 0) {
      // Items already exist — never overwrite total with a free-typed number.
      // Re-derive total from the existing lines so the invariant is always upheld.
      li = existingItems;
      derivedTotal = existingItems.reduce((s, i) => s + Number(i.cost || 0), 0);
    } else {
      // No existing items — seed one line from the entered amount.
      li = [{ desc: job.summary || job.customer || job.name || 'Job', cost: n }];
      derivedTotal = n;
    }

    // Capture before clearing — if the user arrived via the Lead-tile "Send quote →"
    // CTA we need to continue the funnel after the price is saved.
    const wasQuoteIntent = intent === 'quote';

    if (intent === 'price' && targetStage) {
      // Merge price AND the stage advance into one write
      const stageLabel = targetStage === 'Paid' ? 'marked paid' : `moved to ${targetStage}`;
      onUpdateJob({ ...job, amount: derivedTotal, total: derivedTotal, lineItems: li, ...stagePatch(targetStage) });
      showFlash(`Price added · ${stageLabel}`);
    } else {
      onUpdateJob({ ...job, amount: derivedTotal, total: derivedTotal, lineItems: li });
      showFlash('Price added');
    }
    setEditingField(null);
    onClearIntent?.();

    // Return-to-review: if the user arrived here via "Edit quote/invoice" from
    // ReviewSheet, re-open it so they can re-check and send immediately.
    const reopenMode = postEditReopenReview.current;
    if (reopenMode) {
      postEditReopenReview.current = null;
      setReviewSheetMode(reopenMode);
      return;
    }

    // If the user arrived here via the Lead-tile "Send quote →" CTA, continue the
    // funnel by opening ReviewSheet in quote mode so they can actually send it.
    if (wasQuoteIntent) {
      setReviewSheetMode('quote');
    }
  };

  // Auto-open the price entry field when the drawer opens with an intent and
  // the job still has no price. Clears itself on save or dismiss.
  useEffect(() => {
    if (intent && needsPrice(job) && editingField !== 'amount') {
      setEditingField('amount');
    }
    // Only react to intent changes — not every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  // When the Lead-tile "Send quote →" CTA opens the drawer on an already-priced
  // job, skip the amount step and open ReviewSheet(quote) immediately so the
  // flow doesn't dead-end. Clears intent so we don't re-trigger.
  useEffect(() => {
    if (intent === 'quote' && !needsPrice(job) && reviewSheetMode === null) {
      setReviewSheetMode('quote');
      onClearIntent?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  // When the drawer is opened via Call/Map redirect (missing phone or address),
  // immediately surface the edit modal for that field so the user can add the data.
  // Fires once on mount; onClearInitialEditingField tells WorkScreen to reset state
  // so the field doesn't re-open if the drawer is remounted for the same job.
  useEffect(() => {
    if (!initialEditingField) return;
    setEditingField(initialEditingField);
    onClearInitialEditingField?.();
    // Intentionally runs only on mount — dep array empty so it fires once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Photo add ─────────────────────────────────────────────────────────────
  // New behaviour: compress → Blob → upload to job-photos bucket (private) →
  // store { path, uploadedAt } object in meta.photos[].
  //
  // Offline/upload-failure fallback: when uploadJobPhoto returns null (no auth,
  // no network, bucket error) the compressed base64 data-URL is kept as a legacy
  // string entry so the photo is visible immediately and survives the session.
  const handlePhotoFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPhotoAdding(true);
    const newEntries = [];
    for (const f of files) {
      try {
        const dataUrl = await compressPhoto(f);
        // Attempt to upload to private storage bucket
        const blob = dataUrlToBlob(dataUrl);
        const result = await uploadJobPhoto(blob, job.id, f.name);
        if (result?.path) {
          // Successfully uploaded — store bucket-path object
          newEntries.push(makePhotoEntry(result.path));
        } else {
          // Upload failed (offline / no auth) — fall back to legacy base64 string
          newEntries.push(dataUrl);
        }
      } catch {
        // Skip unreadable files silently — user can try again
      }
    }
    if (newEntries.length && onUpdateJob) {
      onUpdateJob({ ...job, photos: [...(job.photos || []), ...newEntries] });
      showFlash('Photo added');
    }
    setPhotoAdding(false);
    // Reset whichever input fired so the same file can be re-added if needed.
    // Previously reset photoInputRef unconditionally — that broke the camera input.
    e.target.value = '';
  };

  // ── Photo caption ─────────────────────────────────────────────────────────
  // Sets or clears the caption on a photo entry by index.
  // Only applies to new-format entries ({ path, uploadedAt }) — legacy base64
  // strings are passed through unchanged by setCaption().
  const handleSetCaption = (idx, caption) => {
    if (!onUpdateJob) return;
    const photos = job.photos || [];
    const updated = photos.map((entry, i) => i === idx ? setCaption(entry, caption) : entry);
    onUpdateJob({ ...job, photos: updated });
  };

  // ── Photo reorder ─────────────────────────────────────────────────────────
  // Moves a photo from fromIdx to toIdx in the array.
  // Uses reorderPhotos() pure helper — no storage side-effect needed.
  const handleReorderPhotos = (fromIdx, toIdx) => {
    if (!onUpdateJob) return;
    const updated = reorderPhotos(job.photos || [], fromIdx, toIdx);
    onUpdateJob({ ...job, photos: updated });
  };

  // ── Note add ──────────────────────────────────────────────────────────────
  // Shape mirrors the legacy submitNote in App.jsx (line 616):
  //   { id, subject, body, date } appended to job.jobNotes[]
  const handleSubmitNote = () => {
    const body = noteBody.trim();
    if (!body) return;
    const newNote = {
      id: `N-${Date.now()}`,
      subject: noteSubject.trim() || 'Note',
      body,
      date: new Date().toISOString(),
    };
    onUpdateJob({ ...job, jobNotes: [...(job.jobNotes || []), newNote] });
    setNoteSubject('');
    setNoteBody('');
    setNoteFormOpen(false);
    showFlash('Note added');
  };

  // ── Receipt add ───────────────────────────────────────────────────────────
  // After AddReceiptModal calls onSave(arg), we inject the jobId into the
  // payload so AppShell's handleAddReceipt can write the correct jobId to
  // Supabase / localStorage — then close the modal.
  const handleReceiptSave = async (arg) => {
    if (!onAddReceipt) return;
    const injected = {
      payload: { ...arg.payload, jobId: job.id },
      photoFile: arg.photoFile || null,
    };
    await onAddReceipt(injected);
    setReceiptModalOpen(false);
    showFlash('Receipt added');
  };

  // ── Receipt update (edit mode) ────────────────────────────────────────────
  // Called by AddReceiptModal's onUpdateReceipt callback.
  // Receipts live in the flat receipts[] array managed by AppShell, not in
  // job.receipts. AppShell owns the cloud write; we pass back the updated object
  // via onUpdateJob so the local state reflects the change immediately by
  // threading the update through the same path AppShell uses for all job meta.
  // AppShell doesn't have an onUpdateReceipt handler today, so we mirror
  // the approach for the inline receipts[] stored on the job itself when present,
  // and call onUpdateJob with the full job. If AppShell gains a dedicated
  // onUpdateReceipt in a later sprint, swap here.
  const handleReceiptUpdate = (updatedReceipt) => {
    if (!onUpdateJob) return;
    // Receipts may be stored either in job.receipts (job-embedded) or in the
    // global receipts[] prop (Supabase receipts table). For embedded receipts,
    // update job.receipts directly. For global receipts, there's no job-level
    // mutation to make — the parent AppShell would need its own handler.
    // We handle the job-embedded case here; global receipts are updated via
    // the receipts prop refresh path on the next cloud sync.
    if (Array.isArray(job.receipts)) {
      const updatedReceipts = job.receipts.map(r =>
        String(r.id) === String(updatedReceipt.id) ? updatedReceipt : r
      );
      onUpdateJob({ ...job, receipts: updatedReceipts });
    }
    // For Supabase-backed receipts, AppShell propagates the update; we just
    // close the modal and flash so the user gets immediate feedback.
    setEditingReceipt(null);
    showFlash('Receipt updated');
  };

  // ── Photo delete ──────────────────────────────────────────────────────────
  // Removes from meta.photos[] array by index.
  // For bucket-path entries ({ path, uploadedAt }), also removes the storage
  // object from the job-photos bucket — best-effort, failure does not block UI.
  // For legacy base64 string entries, nothing to clean up in storage.
  const handleDeletePhoto = (idx) => {
    setPendingDeleteAction({
      title: 'Delete this photo?',
      message: 'This photo will be permanently removed.',
      confirmLabel: 'Delete photo',
      onConfirm: async () => {
        const entry = (job.photos || [])[idx];
        const updated = (job.photos || []).filter((_, i) => i !== idx);
        onUpdateJob({ ...job, photos: updated });
        showFlash('Photo deleted');
        if (entry && !isLegacyPhoto(entry) && entry.path) {
          deleteJobPhoto(entry.path);
        }
      },
    });
  };

  // ── Note delete ───────────────────────────────────────────────────────────
  // Mirrors deleteNote in App.jsx (line 617): filter by id, write via onUpdateJob.
  const handleDeleteNote = (noteId) => {
    setPendingDeleteAction({
      title: 'Delete this note?',
      message: 'This note will be permanently removed.',
      confirmLabel: 'Delete note',
      onConfirm: () => {
        const updated = (job.jobNotes || []).filter(n => n.id !== noteId);
        onUpdateJob({ ...job, jobNotes: updated });
        showFlash('Note deleted');
      },
    });
  };

  // ── Note edit ─────────────────────────────────────────────────────────────
  // Opens EditFieldModal composite with subject + body fields seeded from the note.
  // onSave receives { subject, body }; we merge those back onto the existing note by id.
  const handleEditNote = (note) => setEditingNote(note);

  const handleSaveNoteEdit = (patch) => {
    const updated = (job.jobNotes || []).map(n =>
      n.id === editingNote.id ? { ...n, subject: patch.subject, body: patch.body } : n
    );
    onUpdateJob({ ...job, jobNotes: updated });
    setEditingNote(null);
    showFlash('Note updated');
  };

  // ── Payment edit / delete ─────────────────────────────────────────────────
  // editPayment + deletePayment are pure helpers from lib/payments — they handle
  // validation, auto-flip, and return a new job. We write through onUpdateJob.
  const handleEditPaymentSave = (patch) => {
    const amt = parseFloat(patch.amount);
    if (isNaN(amt) || amt <= 0) return;
    // Normalise method: trim + lowercase so free-text input maps cleanly
    const method = (patch.method || '').trim().toLowerCase() || 'unknown';
    const updated = editPayment(job, editingPayment.id, {
      amount: amt,
      date: patch.date || editingPayment.date,
      method,
      note: patch.note || '',
    });
    onUpdateJob(updated);
    setEditingPayment(null);
    showFlash('Payment updated');
  };

  const handleDeletePayment = (payment) => {
    setPendingDeleteAction({
      title: 'Delete this payment?',
      message: `The ${gbp(payment.amount)} payment will be permanently removed. You can't undo this.`,
      confirmLabel: 'Delete payment',
      onConfirm: () => {
        const updated = deletePayment(job, payment.id);
        onUpdateJob(updated);
        showFlash('Payment deleted');
      },
    });
  };

  // ── Receipt delete ────────────────────────────────────────────────────────
  const handleDeleteReceipt = (receiptId) => {
    setPendingDeleteAction({
      title: 'Delete this receipt?',
      message: 'The receipt and its photo will be permanently removed.',
      confirmLabel: 'Delete receipt',
      onConfirm: async () => {
        if (onDeleteReceipt) {
          try {
            await onDeleteReceipt(receiptId);
            showFlash('Receipt deleted');
          } catch {
            showFlash('Could not delete receipt — try again');
          }
        }
      },
    });
  };

  // Helper — after any line-item write, re-open ReviewSheet if the user arrived here via handleReviewEdit.
  // postEditReopenReview.current is set to 'quote'|'invoice' by handleReviewEdit.
  const maybeReopenReview = () => {
    const reopenMode = postEditReopenReview.current;
    if (reopenMode) {
      postEditReopenReview.current = null;
      setReviewSheetMode(reopenMode);
    }
  };

  // ── LineItem per-row sheet handlers (Schedule-mirror, 2026-06-02) ─────────
  // idx = -1 means "add new", 0+ means edit existing at that index.
  const handleSaveLiLine = (idx, { desc, cost }) => {
    const base = Array.isArray(job.lineItems) ? job.lineItems.filter(i => i.desc || i.cost) : [];
    let next;
    if (idx === -1) {
      next = [...base, { desc, cost: Number(cost) }];
    } else {
      next = base.map((item, i) => i === idx ? { ...item, desc, cost: Number(cost) } : item);
    }
    const newTotal = next.reduce((s, i) => s + Number(i.cost || 0), 0);
    onUpdateJob({ ...job, lineItems: next, total: newTotal, amount: newTotal });
    showFlash(idx === -1 ? 'Line added' : 'Line updated');
    maybeReopenReview();
  };

  const handleDeleteLiLine = (idx) => {
    const base = Array.isArray(job.lineItems) ? job.lineItems.filter(i => i.desc || i.cost) : [];
    const next = base.filter((_, i) => i !== idx);
    const newTotal = next.reduce((s, i) => s + Number(i.cost || 0), 0);
    onUpdateJob({ ...job, lineItems: next, total: newTotal, amount: newTotal });
    showFlash('Line removed');
    maybeReopenReview();
  };

  // ── Multi-visit handlers ──────────────────────────────────────────────────
  const handleVisitSave = (fields) => {
    const currentVisits = readVisits(job);
    let updatedVisits;

    if (editingVisit && !editingVisit._isNew) {
      // Editing existing visit — patch the entry
      updatedVisits = currentVisits.map(v =>
        v.id === editingVisit.id ? { ...v, ...fields } : v,
      );
    } else {
      // Adding new visit — append with a fresh ID
      const newVisit = { id: generateVisitId(), ...fields };
      updatedVisits = [...currentVisits, newVisit];
    }

    onUpdateJob({ ...job, ...writeVisits(job, updatedVisits) });
    setEditingVisit(null);
    showFlash(editingVisit?._isNew ? 'Visit added' : 'Visit updated');
  };

  const handleMarkVisitDone = (visitId) => {
    const currentVisits = readVisits(job);
    const updatedVisits = currentVisits.map(v =>
      v.id === visitId ? { ...v, status: 'done' } : v,
    );
    onUpdateJob({ ...job, ...writeVisits(job, updatedVisits) });

    // Auto-prompt Send Invoice if this was the last planned visit
    if (isLastPlannedVisit(currentVisits, visitId) && showSendInvoice) {
      setShowInvoicePrompt(true);
    }
    showFlash('Visit marked done');
  };

  // -- Finish-line handlers
  const handleEndJob = () => {
    if (needsPrice(job)) { setEditingField('amount'); return; }
    const cv = readVisits(job);
    const allDone = cv.map(v => v.status !== 'done' && v.status !== 'cancelled' ? { ...v, status: 'done' } : v);
    onUpdateJob({ ...job, ...writeVisits(job, allDone), completedAt: new Date().toISOString(), jobStatus: 'complete' });
    if (showSendInvoice) setShowInvoicePrompt(true);
    showFlash('Job ended');
  };
  const handleSetTarget = (dateStr) => onUpdateJob({ ...job, targetFinishDate: dateStr || null });
  const handleReopen = () => {
    onUpdateJob({ ...job, completedAt: undefined, jobStatus: 'active' });
    setShowReopenConfirm(false);
    showFlash('Job reopened');
  };

    // ── Pipeline transitions ──────────────────────────────────────────────────
  // Mirrors legacy convertToJob (App.jsx line 620) and Mark Sent (line 660).
  const handleMarkSent = () => {
    // stagePatch('Quoted') handles legacy jobs where job.status is undefined,
    // which made the old equality check silently leave the job on Lead stage.
    const isLead = job.status === 'lead' || !job.status;
    onUpdateJob({
      ...job,
      ...(isLead ? stagePatch('Quoted') : {}),
      quoteStatus: 'sent',
      quoteSentAt: job.quoteSentAt || new Date().toISOString(),
    });
    showFlash('Quote marked as sent');
  };

  const handleConvert = () => {
    // stagePatch('On') sets status:'active' (canonical field).
    // Old code only set jobStatus:'active' (legacy field), so the job never
    // left Quoted in the UI after the trader manually accepted.
    const isQuoted = job.status === 'quoted';
    onUpdateJob({ ...job, quoteStatus: 'accepted', ...(isQuoted ? stagePatch('On') : {}) });
    showFlash('Converted to active job');
  };

  // Phase F — Accept Quote with signature.
  // Called by SignaturePad.onSave with the PNG dataURL after customer signs.
  const handleSignatureSave = (signatureDataURL) => {
    setSigPadOpen(false);
    // stagePatch('On') sets status:'active' (canonical field).
    // Old code only set jobStatus:'active', leaving the job stranded on Quoted.
    const isQuoted = job.status === 'quoted';
    onUpdateJob({
      ...job,
      acceptedSignature: signatureDataURL,
      quoteStatus: 'accepted',
      acceptedAt: new Date().toISOString(),
      ...(isQuoted ? stagePatch('On') : {}),
    });
    showFlash('Quote accepted — signed by customer');
  };

  // ── Send link (Phase G-1 / B5) ───────────────────────────────────────────
  // Opens the Review sheet (quote mode) rather than firing immediately.
  // Price guard still blocks as before — no point reviewing an unpriced quote.
  const handleSendLink = () => {
    if (needsPrice(job)) {
      setEditingField('amount');
      return;
    }
    setReviewSheetMode('quote');
  };

  // Send link: visible when job has lineItems and is not yet accepted (used for kebab too)
  const showSendLink = onUpdateJob &&
    Array.isArray(job.lineItems) && job.lineItems.length > 0 &&
    job.quoteStatus !== 'accepted';

  // Mark Sent: visible when quoteStatus is 'draft' (quote exists but not yet sent)
  const showMarkSent = job.quoteStatus === 'draft' && onUpdateJob;
  // Accept Quote: the Tradify-steal CTA — shows when quote is sent but not yet accepted
  const showAcceptQuote = onUpdateJob && job.quoteStatus === 'sent' && !job.acceptedSignature;
  // Convert: fallback for jobs already accepted without a signature, or legacy quoteStatus edge cases
  const showConvert =
    onUpdateJob && !showAcceptQuote && (
      job.quoteStatus === 'sent' ||
      (job.quoteStatus === 'accepted' && (!job.jobStatus || job.jobStatus === 'quote'))
    );

  // ── Next Step hero card derivation ───────────────────────────────────────
  // Maps the job's loop position to the content for the NextStepCard hero.
  // deriveNextStepContent() is a pure function in lib/nextStepContent.js —
  // all handlers are resolved here via the `nextStepHandlers` map below.
  const isPaid =
    job.paid === true ||
    job.paymentStatus === 'paid' ||
    job.jobStatus === 'paid' ||
    job.status === 'paid';

  const isInvoiced =
    !!job.invoiceSentAt ||
    job.invoiceStatus === 'invoiced' ||
    job.status === 'invoice_sent' ||
    job.status === 'awaiting';

  const isQuoteAccepted =
    job.quoteStatus === 'accepted' ||
    (job.jobStatus === 'active' && job.quoteStatus !== 'draft' && job.quoteStatus !== 'sent');

  const isQuoteSent = job.quoteStatus === 'sent';

  // Profit for the Paid state headline: quote minus all linked receipt costs.
  const quoteValue = Number(job.total ?? job.amount ?? 0);
  const receiptCosts = receipts
    .filter(r => r.jobId && (String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId)))
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const profitForCard = quoteValue > 0 ? quoteValue - receiptCosts : null;

  const customerFirstName = (job.customer || job.name || '').split(' ')[0];

  const nextStepContent = deriveNextStepContent({
    status,
    isPaid,
    isInvoiced,
    isQuoteAccepted,
    isQuoteSent,
    showChase,
    chaseBlocked,
    tier,
    daysOverdue,
    customerFirstName,
    profit: profitForCard,
  });

  // Action token → handler map. Resolved here so all closures are in scope.
  const nextStepHandlers = {
    sendQuoteLink:       handleSendLink,
    openInvoiceModal:    () => setReviewSheetMode('invoice'),
    openPaymentModal:    () => setPaymentModalOpen(true),
    handleChase,
    openReceiptModal:    () => setReceiptModalOpen(true),
    openPhotoInput:      () => photoInputRef.current?.click(),
    openSigPad:          () => setSigPadOpen(true),
    editPrice:           () => setEditingField('amount'),
    editLineItems:       () => {},
    viewProfitBreakdown: () => setProfitSheetOpen(true),
    noop:                () => {},
  };

  // Lifted to component scope so BOTH IIFEs in the return() body can reference it.
  // Previously defined as a const inside the first IIFE (stage-aware layout block),
  // which made it invisible to the second IIFE (MoreDisclosure block) — that scoping
  // gap caused a ReferenceError on every job open, producing the blank white screen.
  const isCisUser = !!profile?.is_cis_subcontractor;

  return (
    <>
      {/* Backdrop */}
      <div
        className="drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Bottom sheet panel */}
      <div
        className="job-detail-sheet"
        role="dialog"
        aria-label={`Job detail: ${displayName}`}
        aria-modal="true"
      >
        {/* Header — PRD 2026-06-14 redesign (updated 2026-06-15): vertical stack.
            Top strip: ⋯✕ pinned right on own row.
            Mid row: left=name+customer; right=price (baseline-aligned).
            Bottom row: full-width action buttons (Call · Text · WhatsApp · Map). */}
        <div className="job-detail-header">
          {/* ⋯ kebab + ✕ close — own top strip, flex-end so they sit right */}
          <div className="jd-header-actions">
                <div className="jd-kebab-wrap" ref={kebabRef}>
                  <button
                    type="button"
                    className="jd-kebab-btn"
                    onClick={() => setKebabOpen(v => !v)}
                    aria-label="More actions"
                    aria-expanded={kebabOpen}
                    aria-haspopup="menu"
                  >
                    ⋯
                  </button>
                  {kebabOpen && (
                    <div className="jd-kebab-menu" role="menu">
                      {/* Record payment — only after invoice has been sent (Invoiced / Overdue).
                          Showing it on Lead/Quoted stages is misleading: nothing to pay yet. */}
                      {!isPaid && isInvoiced && (
                        <button
                          type="button"
                          className="jd-kebab-item"
                          role="menuitem"
                          onClick={() => { setKebabOpen(false); setPaymentModalOpen(true); }}
                        >
                          Record payment
                        </button>
                      )}
                      {/* Edit price — reachable from kebab when chip is read-only (invoiced/paid states).
                          When chip is tappable (pre-invoice), this item is omitted to avoid duplication. */}
                      {onUpdateJob && (isPaid || isInvoiced) && (
                        <button
                          type="button"
                          className="jd-kebab-item"
                          role="menuitem"
                          onClick={() => {
                            setKebabOpen(false);
                            setEditingField('amount');
                          }}
                        >
                          Edit price
                        </button>
                      )}
                      {/* Send invoice / Resend invoice */}
                      {showSendInvoice && (
                        <button
                          type="button"
                          className="jd-kebab-item"
                          role="menuitem"
                          onClick={() => {
                            setKebabOpen(false);
                            if (needsPrice(job)) { setEditingField('amount'); return; }
                            setReviewSheetMode('invoice');
                          }}
                        >
                          Send invoice
                        </button>
                      )}
                      {showResendInvoice && (
                        <button
                          type="button"
                          className="jd-kebab-item"
                          role="menuitem"
                          onClick={() => { setKebabOpen(false); setReviewSheetMode('invoice'); }}
                        >
                          Resend invoice
                        </button>
                      )}
                      {/* Send / Resend quote link */}
                      {showSendLink && (
                        <button
                          type="button"
                          className="jd-kebab-item"
                          role="menuitem"
                          onClick={() => { setKebabOpen(false); handleSendLink(); }}
                        >
                          {job.publicAccessToken ? 'Resend quote link' : 'Send quote link'}
                        </button>
                      )}
                      {/* Chase via WhatsApp */}
                      {showChase && (
                        <button
                          type="button"
                          className="jd-kebab-item"
                          role="menuitem"
                          onClick={() => { setKebabOpen(false); handleChase(); }}
                        >
                          Chase via WhatsApp
                        </button>
                      )}
                      {/* Mark Sent (draft quote) */}
                      {showMarkSent && (
                        <button
                          type="button"
                          className="jd-kebab-item"
                          role="menuitem"
                          onClick={() => { setKebabOpen(false); handleMarkSent(); }}
                        >
                          Mark as sent
                        </button>
                      )}
                      {/* Accept quote / Convert (pipeline actions) */}
                      {showAcceptQuote && (
                        <button
                          type="button"
                          className="jd-kebab-item"
                          role="menuitem"
                          onClick={() => { setKebabOpen(false); setSigPadOpen(true); }}
                        >
                          Accept quote
                        </button>
                      )}
                      {showConvert && (
                        <button
                          type="button"
                          className="jd-kebab-item"
                          role="menuitem"
                          onClick={() => { setKebabOpen(false); handleConvert(); }}
                        >
                          Convert to job
                        </button>
                      )}
                      {/* Created date — admin metadata. Moved here from Details card (Design A). */}
                      {(job.date || job.createdAt) && (
                        <div className="jd-kebab-item jd-kebab-item--meta" role="menuitem" aria-disabled="true">
                          Created {fmtDate(job.date || job.createdAt)}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <button
                  className="job-detail-close"
                  onClick={onClose}
                  aria-label="Close job detail"
                >
                  ✕
                </button>
          </div>{/* end jd-header-actions */}

          {/* Mid row — left: job name + customer; right: price (baseline-aligned) */}
          <div className="jd-header-top">
            <div className="jd-header-top-left">
              <div className="job-detail-title-block">
                {/* Job name — primary, 22/800. Tappable to edit when allowed. */}
                {onUpdateJob ? (
                  <button
                    type="button"
                    className="jd-customer-edit-btn"
                    onClick={() => setEditingField('summary')}
                    aria-label={job.summary ? 'Edit job name' : 'Add job name'}
                  >
                    {job.summary
                      ? <span className="job-detail-customer">{job.summary}</span>
                      : <span className="jd-detail-edit-row-add">+ Add job name</span>
                    }
                  </button>
                ) : (
                  <div className="job-detail-customer">{job.summary || displayName}</div>
                )}

                {/* Customer sub-line — 16/700, muted, no icon. Tappable to edit when allowed. */}
                {onUpdateJob ? (
                  <button
                    type="button"
                    className="jd-customer-subline-btn"
                    onClick={() => setEditingField('name')}
                    aria-label={distinctCustomer ? 'Edit customer' : 'Add customer'}
                  >
                    {distinctCustomer
                      ? <span className="job-detail-summary">{distinctCustomer}</span>
                      : <span className="jd-detail-edit-row-add jd-detail-edit-row-add--sm">+ Add customer</span>
                    }
                  </button>
                ) : (
                  distinctCustomer && <div className="job-detail-summary">{distinctCustomer}</div>
                )}
              </div>
            </div>

            <div className="jd-header-top-right">
              {/* Price display — right column, baseline-aligned to job name.
                  State matrix (first match wins):
                    1. Paid      → green chip, read-only
                    2. Overdue   → amber chip, read-only
                    3. Invoiced  → due chip, read-only
                    4. Un-priced → tappable "+ Add price" chip (editable mode only)
                    5. Priced    → hero price figure */}
              {(() => {
                const chipPriceHandler = () => {
                  if (needsPrice(job)) {
                    setEditingField('amount');
                  } else {
                    setPriceAccordionExpandTick(t => t + 1);
                    requestAnimationFrame(() => {
                      priceAccordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    });
                  }
                };
                const overdurePlural = daysOverdue === 1 ? 'day' : 'days';

                if (isPaid) {
                  return (
                    <div className="jd-money-chip jd-chip--paid">
                      <span className="jd-chip-primary">Paid</span>
                      <span className="jd-chip-sub">{gbp(computeAmountPaid(job))}</span>
                    </div>
                  );
                }
                if (isInvoiced && daysOverdue > 0) {
                  return (
                    <div className="jd-money-chip jd-chip--overdue">
                      <span className="jd-chip-primary">{gbp(computeBalance(job))} due</span>
                      <span className="jd-chip-sub">{daysOverdue} {overdurePlural} overdue</span>
                    </div>
                  );
                }
                if (isInvoiced) {
                  return (
                    <div className="jd-money-chip jd-chip--due">
                      <span className="jd-chip-primary">{gbp(computeBalance(job))} due</span>
                      <span className="jd-chip-sub">Invoiced</span>
                    </div>
                  );
                }
                if (!isInvoiced && needsPrice(job)) {
                  if (!onUpdateJob) return null;
                  return (
                    <button
                      type="button"
                      className="jd-money-chip jd-chip--add"
                      onClick={chipPriceHandler}
                      aria-label="Add job price"
                    >
                      <span className="jd-chip-primary">+ Add price</span>
                      <span className="jd-chip-sub">Not priced yet</span>
                    </button>
                  );
                }
                // Pre-invoice, priced — render hero price.
                if (!onUpdateJob) {
                  return (
                    <div className="jd-hero-price">
                      {gbp(Number(job.total ?? job.amount))}
                    </div>
                  );
                }
                return (
                  <button
                    type="button"
                    className="jd-hero-price"
                    onClick={chipPriceHandler}
                    aria-label="Edit price breakdown"
                  >
                    {gbp(Number(job.total ?? job.amount))}
                  </button>
                );
              })()}
            </div>
          </div>

          {/* Action row — Call · Text · WhatsApp · Map.
              Phone gates Call/Text/WhatsApp (comms group); Map always renders,
              ghosting to a '+ add address' nudge when no address is set.
              Row is omitted entirely when no phone is present. */}
          {(() => {
            const phone = resolvePhone(job);
            const address = job.address || '';
            if (!phone) return null;   // Map always renders inside; comms gate on phone
            const smsBody = firstName ? `Hi ${firstName}, ` : '';
            const waBody = firstName ? `Hi ${firstName}, ` : '';
            const smsLink = `sms:${phone}?body=${encodeURIComponent(smsBody)}`;
            const waLink = phone ? buildWhatsAppLink({ phone, message: waBody }) : '';
            return (
              <div className="jd-header-action-row">
                {phone && (
                  <a
                    href={`tel:${phone}`}
                    className="jt-action-btn"
                    aria-label={`Call ${firstName || 'customer'}`}
                    onClick={() => logTelemetry('drawer_action_call', { source: 'drawer' })}
                  >
                    <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                      <path d="M4 3l2-1 2 3-1.5 1.5a8 8 0 0 0 4 4L12 9l3 2-1 2a2 2 0 0 1-2 1A11 11 0 0 1 3 5a2 2 0 0 1 1-2z"/>
                    </svg>
                    <span>Call</span>
                  </a>
                )}
                {phone && (
                  <a
                    href={smsLink}
                    className="jt-action-btn"
                    aria-label={`Text ${firstName || 'customer'}`}
                    onClick={() => logTelemetry('drawer_action_text', { source: 'drawer' })}
                  >
                    <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                      <path d="M3 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5l-3 3V4a1 1 0 0 1 1-1z"/>
                    </svg>
                    <span>Text</span>
                  </a>
                )}
                {phone && (
                  <button
                    type="button"
                    className="jt-action-btn"
                    aria-label={`WhatsApp ${firstName || 'customer'}`}
                    onClick={() => {
                      logTelemetry('drawer_action_whatsapp', { source: 'drawer' });
                      window.open(waLink, '_blank', 'noopener');
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                      <path d="M9 1.5A7.5 7.5 0 0 0 2 9a7.47 7.47 0 0 0 1.1 3.9L1.5 16.5l3.7-1.55A7.5 7.5 0 1 0 9 1.5z"/>
                      <path d="M6.5 6.3c.1-.2.4-.6.8-.6.35 0 .7.05.8.6l.3 1.2c.05.2-.05.45-.2.6l-.4.4a4.2 4.2 0 0 0 1.9 1.9l.4-.4c.15-.15.4-.25.6-.2l1.2.3c.55.1.6.45.6.8 0 .8-.85 1.4-1.3 1.4-1.8 0-5.4-3.4-5.4-5.3 0-.45.4-1.3 1.2-1.7z"/>
                    </svg>
                    <span>WhatsApp</span>
                  </button>
                )}
                {(() => {
                  const hasAddress = !!address;
                  return (
                    <button
                      type="button"
                      className="jt-action-btn"
                      aria-label={hasAddress ? `Navigate to ${address}` : 'Add job address'}
                      onClick={() => {
                        logTelemetry('drawer_action_map', { hasData: hasAddress, source: 'drawer' });
                        if (hasAddress) {
                          window.open(buildMapsUrl(address), '_blank', 'noopener');
                        } else {
                          setEditingField('address');
                        }
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                        <path d="M9 1C6.24 1 4 3.24 4 6c0 4.25 5 11 5 11s5-6.75 5-11c0-2.76-2.24-5-5-5z"/>
                        <circle cx="9" cy="6" r="1.8" fill="currentColor" stroke="none"/>
                      </svg>
                      <span>Map</span>
                    </button>
                  );
                })()}
              </div>
            );
          })()}
        </div>

        {/* Scrollable body — Stacked Cards layout (PRD 2026-05-31, Option 2) */}
        <div className="job-detail-body">
          {(() => {
            // ── Profit derivation (shared across all cards) ──────────────────
            const quote = job.total ?? job.amount ?? 0;
            const materials = receipts
              .filter(r => r.jobId && (String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId)))
              .reduce((sum, r) => sum + Number(r.amount || 0), 0);

            // ── Attention state ──────────────────────────────────────────────
            const attention = sectionsNeedingAttention(job, nextStepContent, receipts);

            // ── Meta strings for collapsed rows ─────────────────────────────
            const quoteTotal = job.total ?? job.amount ?? 0;
            const _quoteLineCount = (job.lineItems || []).filter(i => i.desc || i.cost).length;
            const quoteMeta = quoteTotal > 0
              ? `${gbp(quoteTotal)}${_quoteLineCount > 0 ? ` (${_quoteLineCount} item${_quoteLineCount === 1 ? '' : 's'})` : ''}`
              : 'None yet';

            const jobReceipts = receipts.filter(r =>
              r.jobId && (String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId))
            );
            const costsMeta = jobReceipts.length > 0
              ? `${gbp(materials)} · ${jobReceipts.length} receipt${jobReceipts.length !== 1 ? 's' : ''}`
              : 'None yet';

            // ── Section body elements ────────────────────────────────────────
            const paymentEl = (
              <PaymentSummaryBlock
                job={job}
                onRecordPayment={() => setPaymentModalOpen(true)}
                onSendInvoice={isPreInvoiceJob ? () => setReviewSheetMode('invoice') : undefined}
                onMarkAsPaid={() => {
                  const balance = computeBalance(job);
                  if (balance > 0) {
                    logTelemetry('mark_paid', { source: 'job_drawer' });
                    onAddPayment(job, {
                      amount: balance,
                      date: new Date().toISOString().slice(0, 10),
                      method: 'unknown',
                      note: '',
                    });
                    clearChase(job.id);
                    // Payment recorded first (dopamine). Cost prompt appears after.
                    showFlash('Job marked paid');
                    const jobIncome = job.total ?? job.amount ?? 0;
                    const jobCostTotal = Array.isArray(receipts)
                      ? receipts
                          .filter(r => r.jobId === job.id || r.job_id === job.id)
                          .reduce((s, r) => s + Number(r.amount || 0), 0)
                      : 0;
                    const remindJobCosts = profile?.remind_job_costs !== false;
                    const show = onAddReceipt && shouldShowCostPrompt({
                      jobId: job.id,
                      jobIncome,
                      jobCostTotal,
                      remindJobCosts,
                    });
                    if (show) {
                      recordPromptShown(job.id);
                      setPostPaidCostActive(true);
                    }
                  }
                }}
              />
            );

            const paymentsEl = (
              <PaymentHistoryList
                job={job}
                onEditPayment={onUpdateJob ? setEditingPayment : undefined}
                onDeletePayment={onUpdateJob ? handleDeletePayment : undefined}
              />
            );

            // CIS-4 / CIS-5: tax meta shown for CIS users; non-CIS gets exclude toggle in More.
            const taxMetaEl = (isCisUser || onUpdateJob) ? (
              <JobTaxMeta
                job={job}
                profile={profile}
                quote={quote}
                materials={materials}
                onUpdateJob={onUpdateJob}
              />
            ) : null;

            const quoteBodyEl = (
              <QuoteBreakdownSection
                job={job}
                onSaveLine={onUpdateJob ? handleSaveLiLine : undefined}
                onDeleteLine={onUpdateJob ? handleDeleteLiLine : undefined}
              />
            );

            const costsBodyEl = (
              <ReceiptsSection
                job={job}
                receipts={receipts}
                onAddReceipt={onAddReceipt ? () => setReceiptModalOpen(true) : undefined}
                onDeleteReceipt={onDeleteReceipt ? handleDeleteReceipt : undefined}
                onEditReceipt={onUpdateJob ? setEditingReceipt : undefined}
                onReceiptRowTap={onUpdateJob
                  ? (r) => { setLightboxSrc(r.photo); setLightboxReceipt(r); }
                  : undefined}
              />
            );

            // ── Schedule: multi-visit aware display ──────────────────────────
            const jobVisits = readVisits(job);
            const scheduledDisplay = getScheduleMeta(jobVisits, fmtDate, job);

            // ── Stage-aware payment sections (Invoiced / Paid) ───────────────
            const sectionConfig = getDrawerSectionConfig(status);
            const paymentSections = [];
            for (const { id, display } of sectionConfig) {
              if (display === 'hidden') continue;
              if (id === 'payment' && display === 'expanded') {
                if (job.deposit_paid_at) {
                  paymentSections.push(
                    <DepositPaidBadge
                      key="deposit-paid-badge"
                      job={job}
                      depositToken={depositToken}
                      totalAmount={Number(job.total ?? job.amount ?? 0)}
                    />
                  );
                }
                if (job.card_paid_at) {
                  paymentSections.push(
                    <CardPaymentBlock
                      key="card-payment-block"
                      job={job}
                      token={cardPaymentToken}
                    />
                  );
                } else if (!job.deposit_paid_at || isPaid) {
                  paymentSections.push(<React.Fragment key="payment">{paymentEl}</React.Fragment>);
                  if (isPaid && onViewReceipt) {
                    paymentSections.push(
                      <div key="view-receipt-btn" className="jd-view-receipt-wrap">
                        <button
                          type="button"
                          className="jd-view-receipt-btn"
                          onClick={() => onViewReceipt(job)}
                        >
                          View receipt
                        </button>
                      </div>
                    );
                  }
                }
              }
              if (id === 'payments' && display === 'expanded') {
                paymentSections.push(<React.Fragment key="payments">{paymentsEl}</React.Fragment>);
              }
            }

            // ── Quote accordion: always collapsed on open (matches Schedule/Costs).
            // Previously expanded for Lead/Quoted statuses and when attention.quote
            // was set — that "prompt to quote" onboarding behaviour has been removed
            // at the founder's request for UI consistency.
            const quoteDefaultExpanded = false;

            // ── Costs accordion: always collapsed on open (matches Schedule/Quote),
            // at founder's request for UI consistency. Previously expanded for
            // active jobs (status === 'On') and when attention.costs was set.
            const costsDefaultExpanded = false;

            // ── Photos & Notes — always-visible section (no More accordion) ──
            // onAddPhoto opens the PhotoSourceSheet; PhotosSection still receives
            // it so the in-grid "+ Add photo" button also routes through the sheet.
            const photosEl = (
              <PhotosSection
                photos={job.photos}
                onViewPhoto={setLightboxSrc}
                onAddPhoto={onUpdateJob ? () => setPhotoSheetOpen(true) : undefined}
                photoAdding={photoAdding}
                onDeletePhoto={onUpdateJob ? handleDeletePhoto : undefined}
                onSetCaption={onUpdateJob ? handleSetCaption : undefined}
                onReorder={onUpdateJob ? handleReorderPhotos : undefined}
              />
            );
            const notesEl = (
              <NotesSection
                job={job}
                onOpenNoteForm={onUpdateJob ? () => setNoteFormOpen(true) : undefined}
                noteFormOpen={noteFormOpen}
                noteSubject={noteSubject}
                noteBody={noteBody}
                onNoteSubjectChange={setNoteSubject}
                onNoteBodyChange={setNoteBody}
                onSubmitNote={handleSubmitNote}
                onCancelNote={() => { setNoteFormOpen(false); setNoteSubject(''); setNoteBody(''); }}
                onDeleteNote={onUpdateJob ? handleDeleteNote : undefined}
                onEditNote={onUpdateJob ? handleEditNote : undefined}
              />
            );
            const photoCount = Array.isArray(job.photos) ? job.photos.length : 0;
            const structuredNoteCount = Array.isArray(job.jobNotes) ? job.jobNotes.length : 0;
            const noteCount = structuredNoteCount > 0
              ? structuredNoteCount
              : (typeof job.notes === 'string' && job.notes.trim() ? 1 : 0);
            // hasExcludeToggle is used only by ExcludeTaxRow now (lifted out of More).
            const hasExcludeToggle = !isCisUser && !!onUpdateJob;

            return (
              <>
                {/* 1. Slim hint card — stage-aware "Next: …" copy, no button. Pinned at top. */}
                <HintCard content={nextStepContent} />

                {/* 2. Price accordion — the number the job lives or dies on; first thing
                     both the tradesperson and customer ask.
                     priceAccordionRef lets the header price button scroll here on tap.
                     forceExpandTick lets the header button programmatically expand it. */}
                <div ref={priceAccordionRef}>
                  <CollapsedSectionRow
                    key="quote"
                    id="quote"
                    icon={<Icon name="lead" size={16} variant="muted" />}
                    title="Price"
                    meta={quoteMeta}
                    needsAttention={attention.quote}
                    defaultExpanded={quoteDefaultExpanded}
                    forceExpandTick={priceAccordionExpandTick}
                    keepMetaWhenExpanded
                  >
                    {quoteBodyEl}
                  </CollapsedSectionRow>
                </div>

                {/* 3. Documents entry row — quote/invoice status = the Get Paid loop made
                     visible (sent? signed? paid?). Earns the spot right after Price. */}
                {(() => {
                  const quoteRecord   = buildQuoteRecordMeta(job);
                  const invoiceRecord = buildInvoiceRecordMeta(job);
                  const qState = quoteRecord.state;
                  const iState = invoiceRecord.state;

                  let summary;
                  if (qState !== 'none' && iState !== 'none') {
                    summary = `${quoteRecord.chipLabel} · ${invoiceRecord.chipLabel}`;
                  } else if (qState !== 'none') {
                    summary = `Quote ${quoteRecord.chipLabel.toLowerCase()}`;
                  } else if (iState !== 'none') {
                    summary = `Invoice ${invoiceRecord.chipLabel.toLowerCase()}`;
                  } else {
                    summary = 'None yet';
                  }

                  return (
                    /* Wrap in .jd-csr so the chrome (background, border, radius,
                       flex-shrink) is inherited from the SAME class the real
                       Schedule/Price cards use — not a hand-copied value that drifts. */
                    <div key="documents-entry" className="jd-csr">
                      <button
                        type="button"
                        className="jd-csr-row jd-docs-entry"
                        onClick={() => setDocsHubOpen(true)}
                        aria-label={`Documents — ${summary}. Tap to open.`}
                      >
                        <span className="jd-docs-entry-icon">
                          <Icon name="invoice" size={16} variant="muted" />
                        </span>
                        <span className="jd-docs-entry-name">Documents</span>
                        <span className="jd-docs-entry-summary">{summary}</span>
                        <span className="jd-csr-chev" aria-hidden="true">
                          <Icon name="chevron-right" size={16} variant="muted" />
                        </span>
                      </button>
                    </div>
                  );
                })()}

                {/* 4. Schedule card — "when/where am I" — high glance-value on site,
                     but secondary to money. */}
                <CollapsedSectionRow
                  key="schedule"
                  id="schedule"
                  icon={<Icon name="date" size={16} variant="muted" />}
                  title="Schedule"
                  meta={scheduledDisplay}
                  defaultExpanded={false}
                >
                  {/* Send Invoice prompt — shown when last visit marked done */}
                  {showInvoicePrompt && (
                    <div className="visit-invoice-prompt" role="alert">
                      <span className="visit-invoice-prompt-msg">All visits done — ready to invoice?</span>
                      <button
                        type="button"
                        className="visit-invoice-prompt-btn"
                        onClick={() => {
                          setShowInvoicePrompt(false);
                          if (needsPrice(job)) { setEditingField('amount'); return; }
                          setReviewSheetMode('invoice');
                        }}
                      >
                        Send invoice
                      </button>
                      <button
                        type="button"
                        className="visit-invoice-prompt-dismiss"
                        onClick={() => setShowInvoicePrompt(false)}
                        aria-label="Dismiss"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  <div className="jd-schedule-card-body">
                    {/* Visit rows */}
                    {jobVisits.map(v => (
                      <VisitRow
                        key={v.id}
                        visit={v}
                        onTap={onUpdateJob ? () => setEditingVisit(v) : undefined}
                        onMarkDone={onUpdateJob ? handleMarkVisitDone : undefined}
                        canEdit={!!onUpdateJob}
                      />
                    ))}

                    {/* Add visit pill — ghost outline, right-aligned, vertically even; mirrors "+ Add line" */}
                    {onUpdateJob && (
                      <div className="jd-add-pill-row jd-add-pill-row--end">
                        <button
                          type="button"
                          className="jd-add-dashed"
                          onClick={() => setEditingVisit({ _isNew: true, date: tomorrowDateString(), status: 'planned' })}
                          aria-label="Add a visit"
                        >
                          + Add visit
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Finish-line footer */}
                  <ScheduleFinishFooter
                    job={job}
                    jobVisits={jobVisits}
                    canEdit={!!onUpdateJob}
                    onEndJob={handleEndJob}
                    onSetTarget={handleSetTarget}
                    onReopen={() => setShowReopenConfirm(true)}
                    fmtDate={fmtDate}
                  />
                  {showReopenConfirm && (
                    <div className="jd-finish-reopen-confirm" role="alertdialog" aria-modal="true">
                      <p className="jd-finish-reopen-confirm__msg">Reopen this job? It will go back to On.</p>
                      <div className="jd-finish-reopen-confirm__actions">
                        <button type="button" className="jd-finish-reopen-confirm__ok" onClick={handleReopen}>Reopen</button>
                        <button type="button" className="jd-finish-reopen-confirm__cancel" onClick={() => setShowReopenConfirm(false)}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {/* Visit editor sheet */}
                  <VisitEditorSheet
                    open={!!editingVisit}
                    visit={editingVisit}
                    onSave={handleVisitSave}
                    onCancel={() => setEditingVisit(null)}
                  />
                </CollapsedSectionRow>

                {/* 5. Customer card — tap-to-call/navigate utility; you usually already know
                     who it is once you're in the job, so it sits below money + scheduling. */}
                <CustomerCard
                  job={job}
                  onEditName={onUpdateJob ? () => setEditingField('name') : undefined}
                  onEditPhone={onUpdateJob ? () => setEditingField('phone') : undefined}
                  onEditAddress={onUpdateJob ? () => setEditingField('address') : undefined}
                  onEditEmail={onUpdateJob ? () => setEditingField('email') : undefined}
                  onEditDescription={onUpdateJob ? () => setEditingField('description') : undefined}
                />

                {/* CIS-4/5: tax meta (CIS toggle + exclude) */}
                {isCisUser && taxMetaEl}

                {/* 6. Costs accordion — feeds the profit/insight layer; logged occasionally. */}
                <CollapsedSectionRow
                  key="costs"
                  id="costs"
                  icon={<Icon name="materials" size={16} variant="muted" />}
                  title="Costs"
                  meta={costsMeta}
                  needsAttention={attention.costs}
                  defaultExpanded={costsDefaultExpanded}
                >
                  {costsBodyEl}
                </CollapsedSectionRow>

                {/* 7. Notes & photos — merged accordion: capture actions, low frequency.
                     Collapsed meta: "{n} note{s} · {n} photo{s}" or "None yet" when both empty.
                     Notes section rendered first (with add-note form), photos section second. */}
                {(() => {
                  const notesPhotosMeta = (() => {
                    const hasNotes = noteCount > 0;
                    const hasPhotos = photoCount > 0;
                    if (!hasNotes && !hasPhotos) return 'None yet';
                    if (hasNotes && hasPhotos) {
                      return `${noteCount} note${noteCount !== 1 ? 's' : ''} · ${photoCount} photo${photoCount !== 1 ? 's' : ''}`;
                    }
                    if (hasNotes) return `${noteCount} note${noteCount !== 1 ? 's' : ''}`;
                    return `${photoCount} photo${photoCount !== 1 ? 's' : ''}`;
                  })();

                  return (
                    <CollapsedSectionRow
                      key="notes-photos"
                      id="notes-photos"
                      icon={<Icon name="note" size={16} variant="muted" />}
                      title="Notes & photos"
                      meta={notesPhotosMeta}
                      defaultExpanded={false}
                    >
                      {notesEl}
                      {onUpdateJob && (
                        <button
                          ref={addPhotoBtnRef}
                          type="button"
                          className="jd-photos-notes-btn"
                          onClick={() => setPhotoSheetOpen(true)}
                          disabled={photoAdding}
                          aria-label="Add photo"
                        >
                          {photoAdding ? 'Adding…' : <><Icon name="camera" size={16} />{' '}Add photo</>}
                        </button>
                      )}
                      {photosEl}
                    </CollapsedSectionRow>
                  );
                })()}

                {/* 8. Timeline — low-glance audit log, not an in-the-moment need;
                     demoted out of prime real estate at the top. */}
                <CollapsedSectionRow
                  key="timeline"
                  id="timeline"
                  icon={<Icon name="date" size={16} variant="muted" />}
                  title="Timeline"
                  meta={status}
                  defaultExpanded={false}
                >
                  <StageTimeline job={job} />
                </CollapsedSectionRow>

                {/* 9. Payment block — contextual; stays in its existing low position. */}
                {paymentSections.length > 0 && (
                  <div className="jd-payment-block">
                    {isPreInvoiceJob && (job.payments || []).length === 0 && (
                      <div className="jd-section-label">Deposit (optional)</div>
                    )}
                    {paymentSections}
                  </div>
                )}

                {/* 10. View profit breakdown — opens ProfitBreakdownSheet */}
                <button
                  type="button"
                  className="jd-breakdown-btn"
                  onClick={() => setProfitSheetOpen(true)}
                  aria-label="View profit breakdown"
                >
                  View profit breakdown
                </button>

                {/* 11. B2B settings row — no card chrome, below profit breakdown */}
                <B2BSettingsRow
                  job={job}
                  onToggle={onUpdateJob ? () => {
                    onUpdateJob({ ...job, isBusinessCustomer: !job.isBusinessCustomer });
                  } : undefined}
                />

                {/* 12. Exclude-from-tax settings row — below B2B row, non-CIS only.
                    CIS users get the exclude toggle inside JobTaxMeta (above Schedule card). */}
                {hasExcludeToggle && (
                  <ExcludeTaxRow
                    job={job}
                    onToggle={() => onUpdateJob({ ...job, excludeFromTax: !job.excludeFromTax })}
                  />
                )}

                {/* Bottom padding so last card clears the sticky action bar */}
                <div className="jd-bottom-bar-spacer" aria-hidden="true" />
              </>
            );
          })()}

          {/* Hidden file inputs — camera (single shot) + gallery (multi).
              Both share the same handlePhotoFiles handler; reset is done via
              e.target.value so both inputs work on repeat selections. */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handlePhotoFiles}
            aria-hidden="true"
          />
          <input
            ref={(node) => { galleryInputRef.current = node; photoInputRef.current = node; }}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handlePhotoFiles}
            aria-hidden="true"
          />

          {/* Photo source chooser — bottom action sheet opened by 📷 Add photo */}
          <PhotoSourceSheet
            open={photoSheetOpen}
            triggerRef={addPhotoBtnRef}
            onTakePhoto={() => { setPhotoSheetOpen(false); cameraInputRef.current?.click(); }}
            onUploadPhoto={() => { setPhotoSheetOpen(false); galleryInputRef.current?.click(); }}
            onClose={() => setPhotoSheetOpen(false)}
          />
        </div>

        {/* Sticky bottom action bar — primary CTA for current stage.
            Padding-bottom: env(safe-area-inset-bottom) ONLY.
            The global .bottom-nav is hidden by body.overlay-open (index.css:600)
            so --nav-clearance (64px) must NOT be used here. */}
        <BottomActionBar
          content={nextStepContent}
          handlers={nextStepHandlers}
          isPaid={isPaid}
        />

        {/* Toast */}
        {toast && (
          <div className="job-detail-toast" role="status">{toast}</div>
        )}
      </div>

      {/* Profit breakdown sheet — Step 2. Two entry points: ribbon tap, viewProfitBreakdown action. */}
      {/* jobCountThisMonth: by-count allocation for the monthly bills estimate row. */}
      <ProfitBreakdownSheet
        open={profitSheetOpen}
        onClose={() => setProfitSheetOpen(false)}
        job={job}
        receipts={receipts}
        overheads={Array.isArray(profile?.overheads) ? profile.overheads : []}
        jobCountThisMonth={
          Array.isArray(jobs)
            ? jobs.filter(j => {
                if ((j.date || '').slice(0, 7) !== monthKey(new Date())) return false;
                return j.paid === true || j.paymentStatus === 'paid' || j.jobStatus === 'paid' || j.status === 'paid';
              }).length
            : 1
        }
      />

      {/* Photo lightbox — sits on top of everything.
          When opened from a receipt row, receipt + onEdit are passed so the
          lightbox shows label/amount/date and an Edit action. */}
      <PhotoLightbox
        src={lightboxSrc}
        onClose={() => { setLightboxSrc(null); setLightboxReceipt(null); }}
        receipt={lightboxReceipt}
        onEdit={lightboxReceipt && onUpdateJob ? setEditingReceipt : undefined}
      />

      {/* SignaturePad modal — sits above the drawer; uses modal-backdrop--top (z-index 1100) */}
      {sigPadOpen && (
        <div className="modal-backdrop modal-backdrop--top" onClick={() => setSigPadOpen(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-sheet-header">
              <h3 className="modal-sheet-title">Accept quote</h3>
              <button
                type="button"
                className="modal-sheet-close"
                onClick={() => setSigPadOpen(false)}
                aria-label="Close signature pad"
              >
                ✕
              </button>
            </div>
            <SignaturePad
              onSave={handleSignatureSave}
              onCancel={() => setSigPadOpen(false)}
              width={300}
              height={180}
            />
          </div>
        </div>
      )}

      {/* RecordPaymentModal — rendered outside the sheet so it sits on top */}
      {paymentModalOpen && (
        <RecordPaymentModal
          job={job}
          onAddPayment={onAddPayment}
          onClose={() => setPaymentModalOpen(false)}
          flash={showFlash}
          mode={paymentModalMode}
          receipts={receipts}
          onAddReceipt={onAddReceipt}
          profile={profile}
          onAutoMute={() => onProfileUpdate?.({ remind_job_costs: false })}
        />
      )}

      {/* Post-paid cost capture — inline row shown after Mark-as-Paid shortcut. */}
      {postPaidCostActive && (
        <div className="modal-backdrop" onClick={() => setPostPaidCostActive(false)}>
          <div className="modal modal--paid-success" onClick={e => e.stopPropagation()}>
            <div className="modal-paid-badge">
              {/* Branded micro-touch: brand-green CircleCheck — warmth from colour + copy below */}
              <span className="modal-paid-check"><Icon name="paid" size={32} variant="brand" /></span>
              <span className="modal-paid-label">Paid</span>
            </div>
            <PostPaidCostRow
              job={job}
              jobCostTotal={Array.isArray(receipts)
                ? receipts
                    .filter(r => r.jobId === job.id || r.job_id === job.id)
                    .reduce((s, r) => s + Number(r.amount || 0), 0)
                : 0}
              variant={costPromptVariant(
                Array.isArray(receipts)
                  ? receipts
                      .filter(r => r.jobId === job.id || r.job_id === job.id)
                      .reduce((s, r) => s + Number(r.amount || 0), 0)
                  : 0
              )}
              onSave={onAddReceipt}
              onSkip={() => setPostPaidCostActive(false)}
              onAutoMute={() => {
                setPostPaidCostActive(false);
                onProfileUpdate?.({ remind_job_costs: false });
              }}
            />
          </div>
        </div>
      )}

      {/* ReviewSheet — quote or invoice review before sending.
          Replaces the direct-fire send paths. SendInvoiceModal below is
          retained for the paywall view only and is no longer opened by any
          active caller — it will be removed in a follow-up cleanup PR. */}
      {reviewSheetMode && (
        <ReviewSheet
          mode={reviewSheetMode}
          job={job}
          biz={biz ?? {}}
          profile={profile ?? null}
          jobs={jobs ?? []}
          onUpdate={onUpdateJob ?? (() => {})}
          onClose={() => setReviewSheetMode(null)}
          onDismiss={() => setReviewSheetMode(null)}
          onEdit={onUpdateJob ? () => handleReviewEdit(reviewSheetMode) : undefined}
          flash={showFlash}
        />
      )}

      {/* DocumentsHub — Design 2 tabbed document record sheet.
          Replaces the Design 1 Quotes/Invoices accordions. Signature is gated
          behind an intentional reveal; always-on exposure removed from CustomerCard. */}
      {docsHubOpen && (
        <DocumentsHub
          open
          job={job}
          biz={biz ?? {}}
          profile={profile ?? null}
          onClose={() => setDocsHubOpen(false)}
          onBuildQuote={() => {
            setDocsHubOpen(false);
            if (needsPrice(job)) setEditingField('amount');
            else setReviewSheetMode('quote');
          }}
          onSendInvoice={() => {
            setDocsHubOpen(false);
            if (needsPrice(job)) setEditingField('amount');
            else setReviewSheetMode('invoice');
          }}
        />
      )}

      {/* SendInvoiceModal — paywall view (no longer opened from the review path) */}
      {invoiceModalOpen && (
        <SendInvoiceModal
          job={job}
          biz={biz ?? {}}
          profile={profile ?? null}
          jobs={jobs ?? []}
          receipts={receipts}
          onUpdate={onUpdateJob ?? (() => {})}
          onClose={() => setInvoiceModalOpen(false)}
          flash={showFlash}
          onNeedsPrice={() => { setInvoiceModalOpen(false); setEditingField('amount'); }}
          onNavigateToCardPayments={onNavigateToCardPayments}
          onProfileUpdate={onProfileUpdate}
        />
      )}

      {/* AddReceiptModal — add mode: pre-bound to this job; jobId injected in handleReceiptSave */}
      {receiptModalOpen && (
        <AddReceiptModal
          onClose={() => setReceiptModalOpen(false)}
          onSave={handleReceiptSave}
        />
      )}

      {/* AddReceiptModal — edit mode: opened by tapping an existing receipt row */}
      {editingReceipt && (
        <AddReceiptModal
          existingReceipt={editingReceipt}
          onUpdateReceipt={handleReceiptUpdate}
          onClose={() => setEditingReceipt(null)}
        />
      )}

      {/* Customer field EditFieldModal — single instance, configured by editingField state */}
      {editingField === 'name' && (
        <EditFieldModal
          open
          fieldKey="customer"
          fieldLabel="Customer name"
          currentValue={job.customer || ''}
          inputType="text"
          placeholder="e.g. Sarah Jones"
          onSave={handleCustomerFieldSave}
          onClose={() => setEditingField(null)}
        />
      )}
      {editingField === 'phone' && (
        <EditFieldModal
          open
          fieldKey="customerPhone"
          fieldLabel="Customer phone"
          currentValue={job.customerPhone || job.phone || job.mobile || ''}
          inputType="tel"
          placeholder="e.g. 07700 900 123"
          onSave={handleCustomerFieldSave}
          onClose={() => setEditingField(null)}
        />
      )}
      {editingField === 'email' && (
        <EditFieldModal
          open
          fieldKey="email"
          fieldLabel="Customer email"
          currentValue={job.email || job.customerEmail || ''}
          inputType="email"
          placeholder="e.g. customer@example.com"
          onSave={handleCustomerFieldSave}
          onClose={() => setEditingField(null)}
        />
      )}
      {editingField === 'summary' && (
        <EditFieldModal
          open
          fieldKey="summary"
          fieldLabel="Job name"
          currentValue={job.summary || ''}
          inputType="text"
          placeholder="e.g. Kitchen refit, 14 Elm Road"
          onSave={handleCustomerFieldSave}
          onClose={() => setEditingField(null)}
        />
      )}
      {/* Address — spine block tap-to-edit (Design A) */}
      {editingField === 'address' && (
        <EditFieldModal
          open
          fieldKey="address"
          fieldLabel="Address"
          currentValue={job.address || ''}
          inputType="text"
          placeholder="e.g. 14 Elm Road, Manchester, M1 1AA"
          onSave={handleCustomerFieldSave}
          onClose={() => setEditingField(null)}
        />
      )}
      {/* Description — one-line job scope text, new field, Design A */}
      {editingField === 'description' && (
        <EditFieldModal
          open
          fieldKey="description"
          fieldLabel="Job description"
          currentValue={job.description || ''}
          inputType="text"
          placeholder="e.g. Replace bathroom tiling and re-grout — 2 days"
          onSave={handleCustomerFieldSave}
          onClose={() => setEditingField(null)}
        />
      )}

      {/* Amount add/edit — numeric field; opens automatically when intent requires a price */}
      {editingField === 'amount' && (
        <EditFieldModal
          open
          fieldKey="amount"
          fieldLabel="Job price (£)"
          currentValue={needsPrice(job) ? '' : String(Number(job.total ?? job.amount ?? 0))}
          inputType="number"
          placeholder="e.g. 380"
          helpText={
            intent === 'quote'
              ? 'Add a price before you can quote this job.'
              : intent === 'price' && targetStage === 'Paid'
              ? 'Add a price before you can mark this paid.'
              : intent === 'price'
              ? 'Pop a price in first — then this job can move forward.'
              : 'What you\'re charging for the whole job. You can change it later.'
          }
          validate={v => {
            const n = Number(v);
            if (!v || isNaN(n) || n <= 0) return 'Enter a price above £0';
            return null;
          }}
          onSave={handleAmountSave}
          onClose={() => { setEditingField(null); onClearIntent?.(); }}
        />
      )}

      {/* Note edit — composite mode with subject + body fields */}
      {editingNote && (
        <EditFieldModal
          open
          title="Edit note"
          fields={[
            {
              key: 'subject',
              label: 'Subject',
              value: editingNote.subject || '',
              inputType: 'text',
              placeholder: 'e.g. Site visit, Customer request',
            },
            {
              key: 'body',
              label: 'Note',
              value: editingNote.body || '',
              inputType: 'textarea',
              rows: 4,
              placeholder: 'Write your note…',
              validate: v => (!v?.trim() ? 'Note body cannot be empty' : null),
            },
          ]}
          onSave={handleSaveNoteEdit}
          onClose={() => setEditingNote(null)}
        />
      )}

      {/* Delete confirmation overlay — replaces window.confirm for photo/receipt/note/payment deletes.
          Rendered on top of all other modals (z-index via .jd-delete-confirm-backdrop). */}
      {pendingDeleteAction && (
        <div
          className="jd-delete-confirm-backdrop"
          onClick={() => setPendingDeleteAction(null)}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="jd-delete-confirm-title"
        >
          <div
            className="jd-delete-confirm-sheet"
            onClick={e => e.stopPropagation()}
          >
            <p id="jd-delete-confirm-title" className="jd-delete-confirm__title">
              {pendingDeleteAction.title}
            </p>
            {pendingDeleteAction.message && (
              <p className="jd-delete-confirm__msg">{pendingDeleteAction.message}</p>
            )}
            <div className="jd-delete-confirm__actions">
              <button
                type="button"
                className="jd-delete-confirm__cancel"
                onClick={() => setPendingDeleteAction(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="jd-delete-confirm__ok"
                onClick={() => {
                  const action = pendingDeleteAction;
                  setPendingDeleteAction(null);
                  action.onConfirm();
                }}
              >
                {pendingDeleteAction.confirmLabel || 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment edit — composite mode with amount, date, method, note fields */}
      {editingPayment && (
        <EditFieldModal
          open
          title="Edit payment"
          fields={[
            {
              key: 'amount',
              label: 'Amount (£)',
              value: String(editingPayment.amount ?? ''),
              inputType: 'number',
              placeholder: '0.00',
              validate: v => {
                const n = parseFloat(v);
                return (isNaN(n) || n <= 0) ? 'Amount must be greater than zero' : null;
              },
            },
            {
              key: 'date',
              label: 'Date',
              value: editingPayment.date || '',
              inputType: 'text',
              placeholder: 'YYYY-MM-DD',
            },
            {
              key: 'method',
              label: 'Method',
              value: editingPayment.method || '',
              inputType: 'text',
              placeholder: 'cash | bank | card',
            },
            {
              key: 'note',
              label: 'Note (optional)',
              value: editingPayment.note || '',
              inputType: 'text',
              placeholder: 'e.g. 50% deposit',
            },
          ]}
          onSave={handleEditPaymentSave}
          onClose={() => setEditingPayment(null)}
        />
      )}

    </>
  );
}
