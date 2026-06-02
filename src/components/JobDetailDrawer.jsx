import React, { useState, useEffect, useRef } from 'react';
import PaymentSummaryBlock from './PaymentSummaryBlock';
import PaymentHistoryList from './PaymentHistoryList';
import RecordPaymentModal from './RecordPaymentModal';
import SendInvoiceModal from './SendInvoiceModal';
import ReviewSheet from './ReviewSheet';
import AddReceiptModal from './AddReceiptModal';
import SignaturePad from './SignaturePad';
import EditFieldModal from './EditFieldModal';
import NextStepCard from './NextStepCard';
import CollapsedSectionRow from './CollapsedSectionRow';
import ProfitRibbon from './ProfitRibbon';
import ProfitBreakdownSheet from './ProfitBreakdownSheet';
import MoreDisclosure from './MoreDisclosure';
import { getDrawerSectionConfig } from '../lib/drawerSectionConfig';
import { deriveNextStepContent } from '../lib/nextStepContent';
import { sectionsNeedingAttention } from '../lib/sectionAttention';
import {
  getChaseState,
  recordChase,
  clearChase,
  buildChaseLink,
  computeTier,
  daysPastDue,
  buildPaymentDetails,
  isDoubleSendBlocked,
  lastChasedLabel,
} from '../lib/chaseLadder';
import { needsPrice, stagePatch } from '../lib/jobStatus';
import { computeBalance, computeAmountPaid, editPayment, deletePayment } from '../lib/payments';
import { gbp } from '../lib/today';
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
import { uploadJobPhoto, getSignedPhotoUrl, deleteJobPhoto } from '../lib/store';
import {
  generatePublicAccessToken,
  buildPublicQuoteUrl,
  buildShareMessage,
} from '../lib/publicQuoteToken';
import { buildWhatsAppLink } from '../lib/invoiceMessage';
import { buildQuoteWhatsAppMessage } from '../lib/quoteMessage';
import { logTelemetry } from '../lib/telemetry';
import {
  readVisits,
  writeVisits,
  computeVisitStatus,
  getScheduleMeta,
  isLastPlannedVisit,
  generateVisitId,
  tomorrowDateString,
} from '../lib/visits';

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Derives the customer phone number from whichever field the job uses.
 * Returns an empty string when no phone is present.
 */
function resolvePhone(job) {
  return job.customerPhone || job.phone || job.mobile || job.whatsapp || '';
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

/**
 * Derives how many days the invoice has been outstanding, defaulting to 0
 * when the job has no date (safe for buildChaseMessage).
 */
function daysSinceDue(job) {
  const raw = job.invoiceSentAt || job.invoiceDate || job.date;
  if (!raw) return 0;
  const due = new Date(raw);
  const diffMs = Date.now() - due.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

/**
 * Maps the job's status fields to the display badge used in the card list.
 * Mirrors deriveDisplayStatus in WorkScreen — kept inline so JobDetailDrawer
 * has no import from WorkScreen (no circular dep).
 */
function deriveStatus(job) {
  // Canonical status field takes priority — short-circuit before subordinate
  // field checks so residual jobStatus/paymentStatus cannot override a stage move.
  if (job.status === 'lead') return 'Lead';
  if (job.status === 'quoted') return 'Quoted';
  if (job.status === 'paid') return 'Paid';
  if (job.status === 'invoice_sent') return job.overdue === true ? 'Overdue' : 'Invoiced';
  if (job.status === 'complete') return 'Done';
  if (job.status === 'active') return 'Active';
  // Subordinate field fallbacks — legacy jobs that pre-date the canonical status column.
  if (job.paid || job.paymentStatus === 'paid' || job.jobStatus === 'paid') return 'Paid';
  if (job.invoiceStatus === 'invoiced') return 'Invoiced';
  if (job.jobStatus === 'complete') return 'Done';
  if (job.jobStatus === 'active') return 'Active';
  return 'Lead';
}

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
  Quoted:   'status--quoted',
  Active:   'status--active',
  Done:     'status--done',
  Invoiced: 'status--invoiced',
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

  return (
    <div className="jd-card">
      <div className="jd-card-label">Customer</div>

      {/* Name — editable when onEditName is provided; ghost-button when no customer set */}
      {customer ? (
        onEditName ? (
          <button
            type="button"
            className="jd-card-row jd-card-row--tappable"
            onClick={onEditName}
            aria-label="Edit customer name"
          >
            <span className="jd-card-row-icon" aria-hidden="true">👤</span>
            <span className="jd-card-row-val">{customer}</span>
            <span className="jd-card-row-edit" aria-hidden="true">›</span>
          </button>
        ) : (
          <div className="jd-card-row">
            <span className="jd-card-row-icon" aria-hidden="true">👤</span>
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
            <span className="jd-card-row-icon" aria-hidden="true">👤</span>
            <span className="jd-card-row-add">+ Add customer name</span>
          </button>
        )
      )}

      {/* Phone — tap number to call; ghost-button when empty */}
      {phone ? (
        <div className="jd-card-row jd-card-row--phone">
          <span className="jd-card-row-icon" aria-hidden="true">📞</span>
          <a
            href={`tel:${phone}`}
            className="jd-card-row-val jd-card-row-val--link"
            aria-label={`Call ${phone}`}
          >
            {phone}
          </a>
          {canEdit && (
            <button
              type="button"
              className="jd-card-row-edit"
              onClick={onEditPhone}
              aria-label="Edit customer phone"
            >
              ›
            </button>
          )}
        </div>
      ) : (
        canEdit && (
          <button
            type="button"
            className="jd-card-row jd-card-row--add"
            onClick={onEditPhone}
            aria-label="Add customer phone"
          >
            <span className="jd-card-row-icon" aria-hidden="true">📞</span>
            <span className="jd-card-row-add">+ Add phone</span>
          </button>
        )
      )}

      {/* Address — Maps pin tap on the icon+text, edit tap on the chevron.
          Two sibling tap targets in one row; no nested button-in-anchor.
          Read-only branch (canEdit false): whole row links to Maps.
          No-address branch: unchanged ghost-button for adding address. */}
      {address ? (
        canEdit ? (
          <div className="jd-card-row jd-card-row--split-action">
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="jd-card-row-maps-tap"
              aria-label={`Open ${address} in Maps`}
              onClick={() => logTelemetry('drawer_action_map', { source: 'drawer' })}
            >
              <span className="jd-card-row-icon" aria-hidden="true">📍</span>
              <span className="jd-card-row-val">{address}</span>
            </a>
            <button
              type="button"
              className="jd-card-row-edit-btn"
              onClick={onEditAddress}
              aria-label="Edit customer address"
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
        ) : (
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="jd-card-row jd-card-row--link"
            aria-label={`Open ${address} in Maps`}
          >
            <span className="jd-card-row-icon" aria-hidden="true">📍</span>
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
            <span className="jd-card-row-icon" aria-hidden="true">📍</span>
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
            <span className="jd-card-row-icon" aria-hidden="true">✉️</span>
            <span className="jd-card-row-val">{email}</span>
            <span className="jd-card-row-edit" aria-hidden="true">›</span>
          </button>
        ) : (
          <a href={`mailto:${email}`} className="jd-card-row jd-card-row--link">
            <span className="jd-card-row-icon" aria-hidden="true">✉️</span>
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
            <span className="jd-card-row-icon" aria-hidden="true">✉️</span>
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
            <span className="jd-card-row-icon" aria-hidden="true">📋</span>
            <span className="jd-card-row-val">{description}</span>
            <span className="jd-card-row-edit" aria-hidden="true">›</span>
          </button>
        ) : (
          <div className="jd-card-row">
            <span className="jd-card-row-icon" aria-hidden="true">📋</span>
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
            <span className="jd-card-row-icon" aria-hidden="true">📋</span>
            <span className="jd-card-row-add">+ Add description</span>
          </button>
        )
      )}

      {/* Accepted signature — read-only thumbnail shown after quote acceptance.
          When acceptedSource is 'deposit_payment' (no handwritten signature),
          show a card-acceptance badge instead of an empty signature box. */}
      {job.acceptedSource === 'deposit_payment' && !job.acceptedSignature ? (
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
      ) : job.acceptedSignature ? (
        <div className="sig-accepted-card">
          <div className="sig-accepted-label">Accepted by customer</div>
          <img
            src={job.acceptedSignature}
            alt="Customer signature"
            className="sig-accepted-img"
          />
          <div className="sig-accepted-source">
            {job.acceptedSource === 'remote'
              ? `Signed remotely${job.acceptedName ? ` by ${job.acceptedName}` : ' by customer'}`
              : job.acceptedSource === 'deposit_payment'
              ? 'Accepted by card deposit'
              : 'Signed on screen'}
          </div>
          {job.acceptedAt && (
            <div className="sig-accepted-date">
              {fmtDate(job.acceptedAt)}
            </div>
          )}
        </div>
      ) : null}
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
  const { headline, microCtas = [] } = content;
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
              <span className="jd-detail-icon" aria-hidden="true">📞</span>
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
                  <span className="jd-detail-icon">📞</span>
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
                <span className="jd-detail-icon">✉️</span>
                {hasEmail
                  ? <span className="jd-detail-edit-row-value">{email}</span>
                  : <span className="jd-detail-edit-row-add--dim">+ Add email</span>
                }
              </span>
              <span className="jd-detail-edit-chevron" aria-hidden="true">›</span>
            </button>
          ) : (
            <a href={`mailto:${email}`} className="jd-detail-row jd-detail-link">
              <span className="jd-detail-icon">✉️</span>
              <span>{email}</span>
            </a>
          )
        )}
        {hasCompleted && (
          <div className="jd-detail-row">
            <span className="jd-detail-icon">✅</span>
            <span>Completed {fmtDate(job.completedAt)}</span>
          </div>
        )}
        {hasHours && (
          <div className="jd-detail-row">
            <span className="jd-detail-icon">⏱️</span>
            <span>{job.hoursEstimate || job.hours} hrs estimated</span>
          </div>
        )}

      </div>
    </div>
  );
}

/**
 * ScheduleEditForm — inline schedule date/time editor.
 *
 * Moved out of DetailsSection (bug #4 fix) so it is a sibling of SpineBlock
 * in the drawer body rather than being nested inside the Customer card.
 * This means it is visually adjacent to the spine row that triggers it, and
 * cannot appear as a bare "Date" label in an unrelated card context.
 *
 * Only rendered when schedEditMode is true.
 */
function ScheduleEditForm({
  schedEditMode,
  schedDate,
  schedStart,
  schedEnd,
  onScheduleCancel,
  onScheduleSave,
  onScheduleDateChange,
  onScheduleStartChange,
  onScheduleEndChange,
}) {
  if (!schedEditMode) return null;
  return (
    <div className="jd-schedule-edit-form">
      <div>
        <div className="jd-schedule-edit-label">Date</div>
        <input
          type="date"
          className="jd-schedule-edit-input"
          value={schedDate || ''}
          onChange={e => onScheduleDateChange(e.target.value)}
          aria-label="Scheduled date"
        />
      </div>
      <div>
        <div className="jd-schedule-edit-label">Time (optional)</div>
        <div className="jd-schedule-edit-time-row">
          <input
            type="time"
            className="jd-schedule-edit-input"
            value={schedStart || ''}
            onChange={e => onScheduleStartChange(e.target.value)}
            aria-label="Start time"
            placeholder="Start"
          />
          <input
            type="time"
            className="jd-schedule-edit-input"
            value={schedEnd || ''}
            onChange={e => onScheduleEndChange(e.target.value)}
            aria-label="End time"
            placeholder="End"
          />
        </div>
      </div>
      <div className="jd-schedule-edit-footer">
        <button type="button" className="btn-ghost" onClick={onScheduleCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={onScheduleSave}
          disabled={!schedDate}
        >
          Save
        </button>
      </div>
    </div>
  );
}

/**
 * VisitRow — single tappable row inside the Schedule card.
 * Handles swipe-left to reveal "Mark done" action.
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
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Swipe-left state
  const [swipeOffset, setSwipeOffset] = React.useState(0);
  const [revealed, setRevealed] = React.useState(false);
  const touchStartX = React.useRef(null);
  const THRESHOLD = 60;
  const ACTION_WIDTH = 96; // px — width of the "Mark done" button revealed area

  const handleTouchStart = (e) => {
    if (!canEdit || isDone) return;
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e) => {
    if (touchStartX.current === null) return;
    const delta = e.touches[0].clientX - touchStartX.current;
    if (delta >= 0) { setSwipeOffset(0); return; } // no right-swipe
    setSwipeOffset(Math.max(delta, -ACTION_WIDTH));
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null) return;
    touchStartX.current = null;
    if (swipeOffset < -THRESHOLD) {
      setSwipeOffset(-ACTION_WIDTH);
      setRevealed(true);
    } else {
      setSwipeOffset(0);
      setRevealed(false);
    }
  };

  const closeReveal = () => {
    setSwipeOffset(0);
    setRevealed(false);
  };

  const handleMarkDone = (e) => {
    e.stopPropagation();
    onMarkDone(visit.id);
    closeReveal();
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

  const rowContent = (
    <>
      <span className="jd-card-row-icon" aria-hidden="true">📅</span>
      <span className={`jd-card-row-val${isDone ? ' visit-row-val--done' : ''}`}>
        {dateStr}{timeStr}
        <VisitStatusPill status={computedStatus} />
      </span>
      {canEdit && <span className="jd-card-row-chevron" aria-hidden="true">›</span>}
    </>
  );

  // prefers-reduced-motion: show a static "Mark done" button instead of swipe
  if (prefersReduced && canEdit && !isDone) {
    return (
      <div className="visit-row-wrap">
        <button
          type="button"
          className="jd-card-row jd-card-row--tappable"
          onClick={onTap}
          aria-label={`Edit visit on ${dateStr}`}
        >
          {rowContent}
        </button>
        <button
          type="button"
          className="visit-mark-done-static"
          onClick={() => onMarkDone(visit.id)}
          aria-label="Mark visit done"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div
      className="visit-row-wrap"
      onClick={revealed ? closeReveal : undefined}
    >
      {/* Swipeable row */}
      <button
        type="button"
        className="jd-card-row jd-card-row--tappable visit-row-inner"
        style={
          prefersReduced
            ? undefined
            : {
                transform: `translateX(${swipeOffset}px)`,
                transition: touchStartX.current !== null ? 'none' : 'transform 0.2s ease',
              }
        }
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={revealed ? (e) => { e.stopPropagation(); closeReveal(); } : onTap}
        aria-label={`Edit visit on ${dateStr}`}
      >
        {rowContent}
      </button>

      {/* Revealed action — always in the DOM, visible via swipe */}
      {canEdit && !isDone && (
        <button
          type="button"
          className="visit-action-btn"
          style={{ width: ACTION_WIDTH }}
          onClick={handleMarkDone}
          aria-label="Mark visit done"
        >
          Mark done
        </button>
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
 * QuoteBreakdownSection — editable list of job.lineItems[].
 *
 * Read mode: description + cost per row, total at foot.
 * Edit mode (toggled by "+ Edit" header button): each row gets text + number
 * inputs and an × delete button; a "+ Add line item" row appends a blank entry.
 * Save recomputes job.total from the edited items and calls onUpdateJob.
 * Cancel discards the draft.
 *
 * Edit props (all optional — section degrades to read-only when absent):
 *   editMode       – boolean
 *   editItems      – draft copy of lineItems
 *   onToggleEdit   – open edit mode (copies items into draft)
 *   onCancelEdit   – discard draft and close edit mode
 *   onSaveEdit     – persist draft via onUpdateJob, close edit mode
 *   onUpdateItem(idx, field, value) – update one field of one draft item
 *   onAddItem      – append a blank draft item
 *   onDeleteItem(idx) – remove a draft item
 */
function QuoteBreakdownSection({
  job,
  editMode,
  editItems,
  onToggleEdit,
  onCancelEdit,
  onSaveEdit,
  onUpdateItem,
  onAddItem,
  onDeleteItem,
}) {
  const items = Array.isArray(job.lineItems) ? job.lineItems.filter(i => i.desc || i.cost) : [];

  // Hide entirely in read mode when there are no items and no edit handler
  if (items.length === 0 && !onToggleEdit) return null;

  const draftTotal = Array.isArray(editItems)
    ? editItems.reduce((sum, i) => sum + Number(i.cost || 0), 0)
    : 0;

  // Enter edit mode and immediately append a blank line so the user lands on
  // an editable row — used by the empty-state "Add a line" ghost button.
  const handleAddFirstLine = () => {
    onToggleEdit();
    onAddItem();
  };

  return (
    <div className="jd-section">
      <div className="jd-section-header">
        <span>Quote breakdown</span>
      </div>

      {editMode ? (
        <div className="jd-section-body">
          {(editItems || []).map((item, idx) => (
            <div key={idx} className="jd-li-edit-row">
              <input
                type="text"
                className="jd-li-input-desc"
                placeholder="Description"
                value={item.desc || ''}
                onChange={e => onUpdateItem(idx, 'desc', e.target.value)}
                aria-label={`Line item ${idx + 1} description`}
              />
              <input
                type="number"
                className="jd-li-input-cost"
                placeholder="0.00"
                min="0"
                step="0.01"
                value={item.cost ?? ''}
                onChange={e => onUpdateItem(idx, 'cost', e.target.value)}
                aria-label={`Line item ${idx + 1} cost`}
              />
              <button
                type="button"
                className="jd-li-delete-btn"
                onClick={() => onDeleteItem(idx)}
                aria-label={`Delete line item ${idx + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="jd-li-add-btn" onClick={onAddItem}>
            + Add a line
          </button>
          <div className="jd-li-edit-footer">
            <button type="button" className="btn-ghost" onClick={onCancelEdit}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={onSaveEdit}>
              Save — {gbp(draftTotal)}
            </button>
          </div>
        </div>
      ) : (
        <div className="jd-section-body jd-section-body--flush">
          {items.length === 0 ? (
            onToggleEdit && (
              <button
                type="button"
                className="jd-card-row jd-card-row--add"
                onClick={handleAddFirstLine}
                aria-label="Add a line item"
              >
                <span className="jd-card-row-icon" aria-hidden="true">📋</span>
                <span className="jd-card-row-add">+ Add a line</span>
              </button>
            )
          ) : (
            <>
              {items.map((item, idx) => {
                const qty = Number(item.qty || item.quantity || 1);
                const unit = Number(item.cost || item.unitCost || item.price || 0);
                const lineTotal = qty * unit;
                if (onToggleEdit) {
                  return (
                    <button
                      key={idx}
                      type="button"
                      className="jd-card-row jd-card-row--tappable"
                      onClick={onToggleEdit}
                      aria-label={`Edit line item: ${item.desc || 'Line item'}`}
                    >
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
              {/* Total row removed (Design A): header £ is the canonical total.
                  Duplicate bold total beneath breakdown identified as noise. */}
              {onToggleEdit && (
                <button
                  type="button"
                  className="jd-card-row jd-card-row--add"
                  onClick={handleAddFirstLine}
                  aria-label="Add another line item"
                >
                  <span className="jd-card-row-icon" aria-hidden="true">➕</span>
                  <span className="jd-card-row-add">+ Add a line</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// QuickContactSection removed (Design A) — the phone row in DetailsSection
// (Customer card) is the canonical tap-to-call affordance.
// The duplicate Call/Text button grid is gone. Space reclaimed.

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
function ReceiptsSection({ job, receipts, onAddReceipt, onDeleteReceipt, onEditReceipt, onReceiptRowTap }) {
  // receipts shape from getTodayReceipts: { id, label, amount, photo, date, jobId, imagePath }
  // Match on both string UUID (cloud) and legacy integer-style IDs
  const jobReceipts = receipts.filter(r => {
    if (!r.jobId) return false;
    return String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId);
  });

  // Nothing to show and no handler — render nothing
  if (jobReceipts.length === 0 && !onAddReceipt) return null;

  const handleRowTap = (r) => {
    if (r.photo) {
      // Has photo: open lightbox with receipt details overlaid
      onReceiptRowTap?.(r);
    } else if (onEditReceipt) {
      // No photo: go straight to edit/detail sheet
      onEditReceipt(r);
    }
  };
  const isRowTappable = !!(onReceiptRowTap || onEditReceipt);

  const receiptRows = jobReceipts.map(r => (
    <div
      key={r.id}
      className={`jd-receipt-row${isRowTappable ? ' jd-receipt-row--tappable' : ''}`}
      onClick={isRowTappable ? () => handleRowTap(r) : undefined}
      role={isRowTappable ? 'button' : undefined}
      tabIndex={isRowTappable ? 0 : undefined}
      onKeyDown={isRowTappable ? e => { if (e.key === 'Enter' || e.key === ' ') handleRowTap(r); } : undefined}
      aria-label={
        r.photo
          ? `View ${r.label || 'Receipt'} — tap to enlarge`
          : isRowTappable
          ? `Edit receipt ${r.label || 'Receipt'}`
          : undefined
      }
    >
      {r.photo ? (
        <div className="jd-receipt-icon" aria-hidden="true">
          <img src={r.photo} alt="" className="jd-receipt-thumb" />
        </div>
      ) : (
        <div className="jd-receipt-icon" aria-hidden="true">🧾</div>
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
          <span className="jd-card-row-icon" aria-hidden="true">🧾</span>
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
          <span className="jd-card-row-icon" aria-hidden="true">➕</span>
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

  // Stage-aware section expansion — Direction 2.
  // Initialised lazily from getDrawerSectionConfig so the default open/closed
  // state is always correct for the job's current stage without a useEffect.
  // The user can tap any collapsed row to expand it; tapping again collapses it.
  const [expandedSections, setExpandedSections] = useState(() => {
    const initialStatus = (() => {
      if (job.status === 'lead') return 'Lead';
      if (job.status === 'quoted') return 'Quoted';
      if (job.status === 'paid') return 'Paid';
      if (job.status === 'invoice_sent') return job.overdue === true ? 'Overdue' : 'Invoiced';
      if (job.status === 'complete') return 'Done';
      if (job.status === 'active') return 'Active';
      if (job.paid || job.paymentStatus === 'paid' || job.jobStatus === 'paid') return 'Paid';
      if (job.invoiceStatus === 'invoiced') return 'Invoiced';
      if (job.jobStatus === 'complete') return 'Done';
      if (job.jobStatus === 'active') return 'Active';
      return 'Lead';
    })();
    const config = getDrawerSectionConfig(initialStatus);
    return new Set(config.filter(s => s.display === 'expanded').map(s => s.id));
  });

  // Photo add — hidden file input, ref kept here so the button can trigger it
  const photoInputRef = useRef(null);
  const [photoAdding, setPhotoAdding] = useState(false);

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

  // LineItems edit — inline draft state
  const [liEditMode, setLiEditMode] = useState(false);
  const [liDraft, setLiDraft] = useState([]);

  // Schedule edit — inline draft state (legacy single-visit path, kept for compatibility)
  const [schedEditMode, setSchedEditMode] = useState(false);
  const [schedDate, setSchedDate] = useState('');
  const [schedStart, setSchedStart] = useState('');
  const [schedEnd, setSchedEnd] = useState('');

  // Visit editor sheet — multi-visit path
  // editingVisit: null (closed) | { ...Visit } (existing) | { _isNew: true } (add)
  const [editingVisit, setEditingVisit] = useState(null);
  // Send invoice prompt: shown when last visit is marked done and job isn't yet invoiced
  const [showInvoicePrompt, setShowInvoicePrompt] = useState(false);

  // Customer field editing — single EditFieldModal controlled by this key.
  // null = closed; 'name' | 'phone' | 'email' | 'summary' = which field is open.
  const [editingField, setEditingField] = useState(null);

  // Close on Escape — also closes lightbox, kebab, or customer-field edit modal if open
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (lightboxSrc) { setLightboxSrc(null); setLightboxReceipt(null); return; }
        if (kebabOpen) { setKebabOpen(false); return; }
        if (editingField) { setEditingField(null); return; }
        if (editingNote) { setEditingNote(null); return; }
        if (editingPayment) { setEditingPayment(null); return; }
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, lightboxSrc, kebabOpen, editingField, editingNote, editingPayment]);

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
    const s = deriveStatus(job);
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

  const status = deriveStatus(job);
  const statusClass = STATUS_CLASS[status] || '';
  const displayName = job.customer || job.name || 'Unnamed job';
  // Only show the customer sub-line when it's present and differs from the job name —
  // avoids duplicating text when customer_name was defaulted to the job name on creation.
  const distinctCustomer = (job.customer && job.customer.trim() && job.customer.trim() !== (job.summary || '').trim())
    ? job.customer.trim()
    : '';
  const amount = job.total ?? job.amount;
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
    status === 'Lead' || status === 'Quoted' || status === 'Active' || status === 'Done'
  );
  const paymentModalMode = isPreInvoiceJob ? 'deposit' : 'payment';

  const chaseState = getChaseState(job.id);
  const tier = computeTier(job);
  const chasedLabel = lastChasedLabel(chaseState);
  const chaseBlocked = isDoubleSendBlocked(job.id);
  const daysOverdue = Math.max(0, daysPastDue(job));

  const handleChase = () => {
    if (chaseBlocked) return;
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
  // Called by EditFieldModal when editingField === 'amount'.
  const handleAmountSave = (patch) => {
    if (!onUpdateJob) return;
    const n = Number(patch.amount);
    // Build a seed line item if none exist — matches the addJobToCloud convention
    const existingItems = Array.isArray(job.lineItems) ? job.lineItems.filter(i => i.desc || i.cost > 0) : [];
    const li = existingItems.length > 0
      ? existingItems
      : [{ desc: job.summary || job.customer || job.name || 'Job', cost: n }];

    // Capture before clearing — if the user arrived via the Lead-tile "Send quote →"
    // CTA we need to continue the funnel after the price is saved.
    const wasQuoteIntent = intent === 'quote';

    if (intent === 'price' && targetStage) {
      // Merge price AND the stage advance into one write
      const stageLabel = targetStage === 'Paid' ? 'marked paid' : `moved to ${targetStage}`;
      onUpdateJob({ ...job, amount: n, total: n, lineItems: li, ...stagePatch(targetStage) });
      showFlash(`Price added · ${stageLabel}`);
    } else {
      onUpdateJob({ ...job, amount: n, total: n, lineItems: li });
      showFlash('Price added');
    }
    setEditingField(null);
    onClearIntent?.();

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
    // Reset input so the same file can be re-added if needed
    if (photoInputRef.current) photoInputRef.current.value = '';
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
  const handleDeletePhoto = async (idx) => {
    if (!window.confirm('Delete this photo?')) return;
    const entry = (job.photos || [])[idx];
    const updated = (job.photos || []).filter((_, i) => i !== idx);
    onUpdateJob({ ...job, photos: updated });
    showFlash('Photo deleted');

    // Best-effort storage cleanup for bucket entries
    if (entry && !isLegacyPhoto(entry) && entry.path) {
      deleteJobPhoto(entry.path); // fire-and-forget; failure is logged inside deleteJobPhoto
    }
  };

  // ── Note delete ───────────────────────────────────────────────────────────
  // Mirrors deleteNote in App.jsx (line 617): filter by id, write via onUpdateJob.
  const handleDeleteNote = (noteId) => {
    if (!window.confirm('Delete this note?')) return;
    const updated = (job.jobNotes || []).filter(n => n.id !== noteId);
    onUpdateJob({ ...job, jobNotes: updated });
    showFlash('Note deleted');
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
    if (!window.confirm(`Delete the ${gbp(payment.amount)} payment? You can't undo this.`)) return;
    const updated = deletePayment(job, payment.id);
    onUpdateJob(updated);
    showFlash('Payment deleted');
  };

  // ── Receipt delete ────────────────────────────────────────────────────────
  const handleDeleteReceipt = async (receiptId) => {
    if (!window.confirm('Delete this receipt?')) return;
    if (onDeleteReceipt) {
      try {
        await onDeleteReceipt(receiptId);
        showFlash('Receipt deleted');
      } catch {
        showFlash('Could not delete receipt — try again');
      }
    }
  };

  // ── LineItems edit ────────────────────────────────────────────────────────
  // Data shape: { desc: string, cost: number } — matches legacy seed and AI-generated jobs.
  const handleToggleLiEdit = () => {
    // Seed draft from the canonical lineItems, normalising all cost values to numbers.
    const base = Array.isArray(job.lineItems) ? job.lineItems : [];
    setLiDraft(base.map(i => ({ desc: i.desc || '', cost: Number(i.cost || 0) })));
    setLiEditMode(true);
  };

  const handleCancelLiEdit = () => {
    setLiEditMode(false);
    setLiDraft([]);
  };

  const handleUpdateLiItem = (idx, field, value) => {
    setLiDraft(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: field === 'cost' ? value : value };
      return next;
    });
  };

  const handleAddLiItem = () => {
    setLiDraft(prev => [...prev, { desc: '', cost: 0 }]);
  };

  const handleDeleteLiItem = (idx) => {
    setLiDraft(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSaveLiEdit = () => {
    const finalItems = liDraft
      .map(i => ({ desc: i.desc || '', cost: Number(i.cost || 0) }))
      .filter(i => i.desc || i.cost > 0); // drop blank rows
    const newTotal = finalItems.reduce((s, i) => s + i.cost, 0);
    onUpdateJob({ ...job, lineItems: finalItems, total: newTotal, amount: newTotal });
    setLiEditMode(false);
    setLiDraft([]);
    showFlash('Quote updated');
  };

  // ── Schedule edit ─────────────────────────────────────────────────────────
  const handleScheduleEdit = () => {
    setSchedDate(job.scheduledDate || '');
    setSchedStart(job.scheduledStart || '');
    setSchedEnd(job.scheduledEnd || '');
    setSchedEditMode(true);
  };

  const handleScheduleCancel = () => {
    setSchedEditMode(false);
  };

  const handleScheduleSave = () => {
    if (!schedDate) return;
    onUpdateJob({
      ...job,
      scheduledDate: schedDate || null,
      scheduledStart: schedStart || null,
      scheduledEnd: schedEnd || null,
    });
    setSchedEditMode(false);
    showFlash('Schedule updated');
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
    editLineItems:       handleToggleLiEdit,
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
        {/* Handle bar */}
        <div className="job-detail-sheet-handle" aria-hidden="true" />

        {/* Header row */}
        <div className="job-detail-header">
          <div className="job-detail-header-left">
            <div className="job-detail-title-block">
              {/* Heading: job name (summary) — primary, big. Tappable to edit when allowed. */}
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
              {/* Sub-line: customer — secondary, muted. Tappable to edit when allowed. */}
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
          <div className="job-detail-header-right">
            {/* Price row — tappable; shows "+ Add price" when un-priced */}
            {onUpdateJob && (
              <button
                type="button"
                className={`jd-price-btn${needsPrice(job) ? ' jd-price-btn--add' : ''}`}
                onClick={() => setEditingField('amount')}
                aria-label={needsPrice(job) ? 'Add job price' : 'Edit job price'}
              >
                {needsPrice(job)
                  ? <span className="jd-detail-edit-row-add">+ Add price</span>
                  : <span className="job-detail-amount">{gbp(Number(job.total ?? job.amount))}</span>
                }
                <span className="jd-customer-edit-icon" aria-hidden="true">›</span>
              </button>
            )}
            {!onUpdateJob && typeof amount === 'number' && (
              <div className="job-detail-amount">{gbp(amount)}</div>
            )}

            {/* Kebab overflow menu — secondary actions */}
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
          </div>
        </div>

        {/* Scrollable body — Stacked Cards layout (PRD 2026-05-31, Option 2) */}
        <div className="job-detail-body">
          {(() => {
            // ── Profit derivation (shared across all cards) ──────────────────
            const quote = job.total ?? job.amount ?? 0;
            const materials = receipts
              .filter(r => r.jobId && (String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId)))
              .reduce((sum, r) => sum + Number(r.amount || 0), 0);
            const profit = quote - materials;
            const margin = quote > 0 ? Math.round((profit / quote) * 100) : 0;

            // ── Attention state ──────────────────────────────────────────────
            const attention = sectionsNeedingAttention(job, nextStepContent, receipts);

            // ── Meta strings for collapsed rows ─────────────────────────────
            const lineItems = Array.isArray(job.lineItems) ? job.lineItems.filter(i => i.desc || i.cost) : [];
            const lineCount = lineItems.length;
            const quoteTotal = job.total ?? job.amount ?? 0;
            const quoteMeta = lineCount > 0
              ? `${lineCount} line${lineCount === 1 ? '' : 's'} · ${gbp(quoteTotal)}`
              : quoteTotal > 0 ? gbp(quoteTotal) : null;

            const jobReceipts = receipts.filter(r =>
              r.jobId && (String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId))
            );
            const costsMeta = jobReceipts.length > 0
              ? `${gbp(materials)} · ${jobReceipts.length} receipt${jobReceipts.length !== 1 ? 's' : ''}`
              : 'none logged yet';

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
                    showFlash('Job marked paid');
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
                editMode={liEditMode}
                editItems={liDraft}
                onToggleEdit={onUpdateJob ? handleToggleLiEdit : undefined}
                onCancelEdit={handleCancelLiEdit}
                onSaveEdit={handleSaveLiEdit}
                onUpdateItem={handleUpdateLiItem}
                onAddItem={handleAddLiItem}
                onDeleteItem={handleDeleteLiItem}
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
            const scheduledDisplay = getScheduleMeta(jobVisits, fmtDate);

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

            // ── Quote accordion: default expanded for Lead/Quoted ────────────
            const quoteDefaultExpanded =
              status === 'Lead' || status === 'Quoted' || attention.quote;

            // ── Costs accordion: default expanded at Active stage ────────────
            const costsDefaultExpanded = status === 'Active' || attention.costs;

            // ── More (Photos · Notes · Exclude) ─────────────────────────────
            const photosEl = (
              <PhotosSection
                photos={job.photos}
                onViewPhoto={setLightboxSrc}
                onAddPhoto={onUpdateJob ? () => photoInputRef.current?.click() : undefined}
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
            const hasPhotoContent = photoCount > 0;
            const hasNoteContent = (Array.isArray(job.jobNotes) && job.jobNotes.length > 0) ||
              (typeof job.notes === 'string' && job.notes.trim());
            // hasExcludeToggle is used only by ExcludeTaxRow now (lifted out of More).
            const hasExcludeToggle = !isCisUser && !!onUpdateJob;
            const hasAnyMoreContent = hasPhotoContent || hasNoteContent;
            const moreSummaryParts = [];
            if (hasPhotoContent) moreSummaryParts.push(`Photos (${photoCount})`);
            else if (onUpdateJob) moreSummaryParts.push('Photos');
            if (hasNoteContent) {
              const noteCount = Array.isArray(job.jobNotes) ? job.jobNotes.length : 0;
              moreSummaryParts.push(noteCount > 0 ? `Notes (${noteCount})` : 'Notes');
            } else if (onUpdateJob) {
              moreSummaryParts.push('Notes');
            }
            const moreSummary = moreSummaryParts.join(' · ');
            const showMore = !!moreSummary;

            return (
              <>
                {/* 1. Slim hint card — stage-aware "Next: …" copy, no button */}
                <HintCard content={nextStepContent} />

                {/* 2. Customer card — name · phone · address · email · description */}
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

                {/* 4. Schedule card — collapsible, inline edit form when open */}
                {/* 4. Schedule card — multi-visit list (Iteration A) */}
                <CollapsedSectionRow
                  key="schedule"
                  id="schedule"
                  icon="🗓️"
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

                    {/* Add visit ghost row */}
                    {onUpdateJob && (
                      <button
                        type="button"
                        className="jd-card-row jd-card-row--add"
                        onClick={() => setEditingVisit({ _isNew: true, date: tomorrowDateString(), status: 'planned' })}
                        aria-label="Add a visit"
                      >
                        <span className="jd-card-row-icon" aria-hidden="true">📅</span>
                        <span className="jd-card-row-add">+ Add visit</span>
                      </button>
                    )}
                  </div>

                  {/* Visit editor sheet */}
                  <VisitEditorSheet
                    open={!!editingVisit}
                    visit={editingVisit}
                    onSave={handleVisitSave}
                    onCancel={() => setEditingVisit(null)}
                  />
                </CollapsedSectionRow>

                {/* 6. Quote accordion */}
                <CollapsedSectionRow
                  key="quote"
                  id="quote"
                  icon="📋"
                  title="Quote"
                  meta={quoteMeta}
                  needsAttention={attention.quote}
                  defaultExpanded={quoteDefaultExpanded}
                >
                  {quoteBodyEl}
                </CollapsedSectionRow>

                {/* 7. Costs accordion */}
                <CollapsedSectionRow
                  key="costs"
                  id="costs"
                  icon="🧰"
                  title="Costs"
                  meta={costsMeta}
                  needsAttention={attention.costs}
                  defaultExpanded={costsDefaultExpanded}
                >
                  {costsBodyEl}
                </CollapsedSectionRow>

                {/* 7b. Payment block — moved below Costs, above View profit breakdown.
                    Variant A (pre-invoice, no payments yet) gets a "Deposit (optional)"
                    label so the lone Record Payment button doesn't look adrift. */}
                {paymentSections.length > 0 && (
                  <div className="jd-payment-block">
                    {isPreInvoiceJob && (job.payments || []).length === 0 && (
                      <div className="jd-section-label">Deposit (optional)</div>
                    )}
                    {paymentSections}
                  </div>
                )}

                {/* 8. View profit breakdown — opens ProfitBreakdownSheet */}
                <button
                  type="button"
                  className="jd-breakdown-btn"
                  onClick={() => setProfitSheetOpen(true)}
                  aria-label="View profit breakdown"
                >
                  View profit breakdown
                </button>

                {/* 10. More (Photos · Notes) */}
                {showMore && (
                  <MoreDisclosure
                    summary={moreSummary}
                    hasContent={hasAnyMoreContent || noteFormOpen}
                  >
                    {photosEl}
                    {(hasNoteContent || noteFormOpen || onUpdateJob) && notesEl}
                  </MoreDisclosure>
                )}

                {/* 11. B2B settings row — no card chrome, below More */}
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

          {/* Hidden file input for photo capture — rendered here so handlePhotoFiles
              has access to onUpdateJob via closure. The button lives in PhotosSection. */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handlePhotoFiles}
            aria-hidden="true"
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
      <ProfitBreakdownSheet
        open={profitSheetOpen}
        onClose={() => setProfitSheetOpen(false)}
        job={job}
        receipts={receipts}
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
        />
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
          flash={showFlash}
        />
      )}

      {/* SendInvoiceModal — paywall view (no longer opened from the review path) */}
      {invoiceModalOpen && (
        <SendInvoiceModal
          job={job}
          biz={biz ?? {}}
          profile={profile ?? null}
          jobs={jobs ?? []}
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
