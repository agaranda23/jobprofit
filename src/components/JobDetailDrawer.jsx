import React, { useState, useEffect, useRef } from 'react';
import PaymentSummaryBlock from './PaymentSummaryBlock';
import PaymentHistoryList from './PaymentHistoryList';
import RecordPaymentModal from './RecordPaymentModal';
import SendInvoiceModal from './SendInvoiceModal';
import AddReceiptModal from './AddReceiptModal';
import SignaturePad from './SignaturePad';
import EditFieldModal from './EditFieldModal';
import {
  getChaseState,
  recordChase,
  buildChaseLink,
  computeTier,
  lastChasedLabel,
} from '../lib/chaseLadder';
import { computeBalance, computeAmountPaid, editPayment, deletePayment } from '../lib/payments';
import { gbp } from '../lib/today';
import { compressPhoto } from '../lib/photoCompress';
import {
  isLegacyPhoto,
  dataUrlToBlob,
  makePhotoEntry,
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
  if (job.paid || job.paymentStatus === 'paid' || job.jobStatus === 'paid') return 'Paid';
  if (job.invoiceStatus === 'invoiced' || job.status === 'invoice_sent') return 'Invoiced';
  if (job.jobStatus === 'complete' || job.status === 'complete') return 'Done';
  if (job.jobStatus === 'active' || job.status === 'active') return 'Active';
  return 'Quoted';
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
 * Full-screen photo lightbox — tap anywhere to close.
 * Mirrors the PhotoModal in App.jsx (kept inline to avoid cross-file dep on the monolith).
 */
function PhotoLightbox({ src, onClose }) {
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
    </div>
  );
}

/**
 * Details section — job description, address, contact, dates.
 * Hidden when there is no renderable content.
 *
 * Schedule edit props (all optional — degrades gracefully when absent):
 *   schedEditMode        – boolean; shows the inline edit form
 *   schedDate            – draft scheduledDate (YYYY-MM-DD)
 *   schedStart           – draft scheduledStart (HH:MM)
 *   schedEnd             – draft scheduledEnd (HH:MM)
 *   onScheduleEdit       – open edit form
 *   onScheduleCancel     – discard and close
 *   onScheduleSave       – persist via onUpdateJob and close
 *   onScheduleDateChange / onScheduleStartChange / onScheduleEndChange
 *
 * Customer field edit callbacks (all optional — rows degrade to read-only when absent):
 *   onEditSummary  – open EditFieldModal for job description
 *   onEditPhone    – open EditFieldModal for customer phone
 *   onEditEmail    – open EditFieldModal for customer email
 */
function DetailsSection({
  job,
  schedEditMode,
  schedDate,
  schedStart,
  schedEnd,
  onScheduleEdit,
  onScheduleCancel,
  onScheduleSave,
  onScheduleDateChange,
  onScheduleStartChange,
  onScheduleEndChange,
  onEditSummary,
  onEditPhone,
  onEditEmail,
}) {
  const hasDesc = !!job.summary;
  const hasAddress = !!job.address;
  const hasPhone = !!(job.phone || job.customerPhone || job.mobile);
  const hasEmail = !!(job.email || job.customerEmail);
  const hasDate = !!(job.date || job.createdAt);
  const hasScheduled = !!job.scheduledDate;
  const hasCompleted = !!job.completedAt;
  const hasHours = !!(job.hoursEstimate || job.hours);
  const canEditSchedule = typeof onScheduleEdit === 'function';
  const canEditFields = typeof onEditPhone === 'function';

  const visible = hasDesc || hasAddress || hasPhone || hasEmail || hasDate ||
    hasScheduled || hasCompleted || hasHours || canEditSchedule || canEditFields;
  if (!visible) return null;

  const phone = job.customerPhone || job.phone || job.mobile || '';
  const email = job.email || job.customerEmail || '';
  const scheduledTime =
    job.scheduledStart && job.scheduledEnd
      ? `${job.scheduledStart} – ${job.scheduledEnd}`
      : job.scheduledStart || '';

  return (
    <div className="jd-section">
      <div className="jd-section-header jd-section-header--with-action">
        <span>Details</span>
        {canEditSchedule && !schedEditMode && (
          <button
            type="button"
            className="jd-section-action-btn"
            onClick={onScheduleEdit}
            aria-label="Edit schedule"
          >
            {hasScheduled ? 'Edit schedule' : '+ Schedule'}
          </button>
        )}
      </div>
      <div className="jd-section-body">
        {/* Job description — tappable when edit callback provided */}
        {canEditFields ? (
          <button
            type="button"
            className="jd-detail-desc-edit-wrap"
            onClick={onEditSummary}
            aria-label={hasDesc ? 'Edit job description' : 'Add job description'}
          >
            {hasDesc
              ? <p className="jd-detail-desc" style={{ margin: 0, flex: 1 }}>{job.summary}</p>
              : <span className="jd-detail-desc-add">+ Add description</span>
            }
            <span className="jd-detail-desc-edit-chevron" aria-hidden="true">›</span>
          </button>
        ) : (
          hasDesc && <p className="jd-detail-desc">{job.summary}</p>
        )}

        {hasAddress && (
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="jd-detail-row jd-detail-link"
          >
            <span className="jd-detail-icon">📍</span>
            <span>{job.address}</span>
          </a>
        )}

        {/* Phone — always rendered when edit callback present (shows "+ Add" when empty) */}
        {(hasPhone || canEditFields) && (
          canEditFields ? (
            <button
              type="button"
              className="jd-detail-edit-row"
              onClick={onEditPhone}
              aria-label={hasPhone ? 'Edit customer phone' : 'Add customer phone'}
            >
              <span className="jd-detail-edit-row-left">
                <span className="jd-detail-icon">📞</span>
                {hasPhone
                  ? <span className="jd-detail-edit-row-value">{phone}</span>
                  : <span className="jd-detail-edit-row-add">+ Add phone</span>
                }
              </span>
              <span className="jd-detail-edit-chevron" aria-hidden="true">›</span>
            </button>
          ) : (
            <a href={`tel:${phone}`} className="jd-detail-row jd-detail-link">
              <span className="jd-detail-icon">📞</span>
              <span>{phone}</span>
            </a>
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
                  : <span className="jd-detail-edit-row-add">+ Add email</span>
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
        {hasDate && (
          <div className="jd-detail-row">
            <span className="jd-detail-icon">📅</span>
            <span>Created {fmtDate(job.date || job.createdAt)}</span>
          </div>
        )}
        {!schedEditMode && hasScheduled && (
          <div className="jd-detail-row">
            <span className="jd-detail-icon">🗓️</span>
            <span>
              Scheduled {fmtDate(job.scheduledDate)}
              {scheduledTime ? ` · ${scheduledTime}` : ''}
            </span>
          </div>
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

        {/* Inline schedule edit form */}
        {schedEditMode && (
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
        )}

        {/* Accepted signature — read-only thumbnail shown after quote acceptance */}
        {job.acceptedSignature && (
          <div className="sig-accepted-card">
            <div className="sig-accepted-label">Accepted by customer</div>
            <img
              src={job.acceptedSignature}
              alt="Customer signature"
              className="sig-accepted-img"
            />
            {/* G-2: distinguish remote signature from on-screen (Phase F) */}
            <div className="sig-accepted-source">
              {job.acceptedSource === 'remote'
                ? `Signed remotely${job.acceptedName ? ` by ${job.acceptedName}` : ' by customer'}`
                : 'Signed on screen'}
            </div>
            {job.acceptedAt && (
              <div className="sig-accepted-date">
                {fmtDate(job.acceptedAt)}
              </div>
            )}
          </div>
        )}
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

  const readTotal = items.reduce((sum, i) => {
    const qty = Number(i.qty || i.quantity || 1);
    const unit = Number(i.cost || i.unitCost || i.price || 0);
    return sum + qty * unit;
  }, 0);

  // In read mode: hide when there is exactly one line item and its value equals
  // the job total — the header already shows the total so the breakdown adds nothing.
  const jobTotal = job.total ?? job.amount ?? 0;
  if (!editMode && items.length === 1 && !onToggleEdit) {
    const singleQty = Number(items[0].qty || items[0].quantity || 1);
    const singleUnit = Number(items[0].cost || items[0].unitCost || items[0].price || 0);
    if (singleQty * singleUnit === jobTotal && jobTotal > 0) return null;
  }

  const draftTotal = Array.isArray(editItems)
    ? editItems.reduce((sum, i) => sum + Number(i.cost || 0), 0)
    : 0;

  return (
    <div className="jd-section">
      <div className="jd-section-header jd-section-header--with-action">
        <span>Quote breakdown</span>
        {onToggleEdit && !editMode && (
          <button
            type="button"
            className="jd-section-action-btn"
            onClick={onToggleEdit}
            aria-label="Edit quote breakdown"
          >
            Edit
          </button>
        )}
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
            + Add line item
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
            <div style={{ padding: '12px 0', color: 'var(--text-dim)', fontSize: 14 }}>
              No line items yet.
            </div>
          ) : (
            items.map((item, idx) => {
              const qty = Number(item.qty || item.quantity || 1);
              const unit = Number(item.cost || item.unitCost || item.price || 0);
              const lineTotal = qty * unit;
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
            })
          )}
          {items.length > 0 && (
            <div className="jd-line-total">
              <span className="jd-line-total-label">Total</span>
              <span className="jd-line-total-value">{gbp(readTotal)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * QuickContactSection — tap-to-call / sms / email row.
 * Only renders buttons for contact methods that actually exist on the job.
 * Hidden entirely when neither phone nor email is present.
 * WhatsApp is intentionally omitted — it already exists in the Chase CTA.
 */
function QuickContactSection({ job }) {
  const phone = job.customerPhone || job.phone || job.mobile || '';
  const email = job.email || job.customerEmail || '';

  if (!phone && !email) return null;

  return (
    <div className="jd-section">
      <div className="jd-section-header">Contact</div>
      <div className="jd-section-body">
        <div className="jd-contact-row">
          {phone && (
            <a href={`tel:${phone}`} className="jd-contact-btn" aria-label={`Call ${phone}`}>
              <span aria-hidden="true">📞</span>
              <span>Call</span>
            </a>
          )}
          {phone && (
            <a href={`sms:${phone}`} className="jd-contact-btn" aria-label={`Text ${phone}`}>
              <span aria-hidden="true">💬</span>
              <span>Text</span>
            </a>
          )}
          {email && (
            <a href={`mailto:${email}`} className="jd-contact-btn" aria-label={`Email ${email}`}>
              <span aria-hidden="true">✉️</span>
              <span>Email</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

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
function ReceiptsSection({ job, receipts, onViewPhoto, onAddReceipt, onDeleteReceipt, onEditReceipt }) {
  // receipts shape from getTodayReceipts: { id, label, amount, photo, date, jobId, imagePath }
  // Match on both string UUID (cloud) and legacy integer-style IDs
  const jobReceipts = receipts.filter(r => {
    if (!r.jobId) return false;
    return String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId);
  });

  // Nothing to show and no handler — render nothing
  if (jobReceipts.length === 0 && !onAddReceipt) return null;

  // Empty + has handler → pill chip (rendered by parent in the empty-pill row)
  if (jobReceipts.length === 0 && onAddReceipt) {
    return (
      <button
        type="button"
        className="jd-pill-chip"
        onClick={onAddReceipt}
        aria-label="Add receipt"
      >
        + Add receipt
      </button>
    );
  }

  // Has content → full section
  return (
    <div className="jd-section">
      <div className="jd-section-header jd-section-header--with-action">
        <span>Receipts</span>
        {onAddReceipt && (
          <button
            type="button"
            className="jd-section-action-btn"
            onClick={onAddReceipt}
            aria-label="Add receipt"
          >
            + Add receipt
          </button>
        )}
      </div>
      <div className="jd-section-body jd-section-body--flush">
        {jobReceipts.map(r => (
          <div
            key={r.id}
            className={`jd-receipt-row${onEditReceipt ? ' jd-receipt-row--tappable' : ''}`}
            onClick={onEditReceipt ? () => onEditReceipt(r) : undefined}
            role={onEditReceipt ? 'button' : undefined}
            tabIndex={onEditReceipt ? 0 : undefined}
            onKeyDown={onEditReceipt ? e => { if (e.key === 'Enter' || e.key === ' ') onEditReceipt(r); } : undefined}
            aria-label={onEditReceipt ? `Edit receipt ${r.label || 'Receipt'}` : undefined}
          >
            {r.photo ? (
              <button
                type="button"
                className="jd-receipt-thumb-btn"
                onClick={e => { e.stopPropagation(); onViewPhoto(r.photo); }}
                aria-label="View receipt photo"
              >
                <img src={r.photo} alt="" className="jd-receipt-thumb" />
              </button>
            ) : (
              <div className="jd-receipt-icon" aria-hidden="true">🧾</div>
            )}
            <div className="jd-receipt-meta">
              <div className="jd-receipt-label">{r.label || 'Receipt'}</div>
              {r.date && <div className="jd-receipt-date">{fmtDate(r.date)}</div>}
            </div>
            <div className="jd-receipt-right">
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
        ))}
      </div>
    </div>
  );
}

/**
 * Single photo thumbnail that resolves a signed URL when the entry is a
 * bucket-path object `{ path, uploadedAt }`, or renders the string directly
 * for legacy base64 entries.
 *
 * @param {{ entry: string|object, index: number, onViewPhoto: function, onDeletePhoto?: function }} props
 */
function PhotoThumb({ entry, index, onViewPhoto, onDeletePhoto }) {
  // Legacy base64 string — render directly; no async resolution needed.
  const isLegacy = isLegacyPhoto(entry);
  const [resolvedSrc, setResolvedSrc] = useState(isLegacy ? entry : null);

  useEffect(() => {
    if (isLegacy) return; // already set above
    let cancelled = false;
    getSignedPhotoUrl(entry.path, 3600).then((url) => {
      if (!cancelled && url) setResolvedSrc(url);
    });
    return () => { cancelled = true; };
  }, [isLegacy, entry]);

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
        <img src={resolvedSrc} alt="" className="jd-photo-thumb" />
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
 *   - New:    { path, uploadedAt } object — resolved via signed URL from job-photos bucket
 *
 * The file input and its ref live in JobDetailDrawer (the parent) because
 * the async compression handler needs access to onUpdateJob. This component
 * receives onAddPhoto (a function that triggers photoInputRef.current.click())
 * and photoAdding (a loading flag) for display purposes.
 *
 * onDeletePhoto(idx) — optional; when present, each thumbnail gets an × button.
 */
/**
 * PhotosSection renders as a pill chip when there are no photos (empty state),
 * or as a full section when photos exist.
 */
function PhotosSection({ photos, onViewPhoto, onAddPhoto, photoAdding, onDeletePhoto }) {
  const hasPhotos = Array.isArray(photos) && photos.length > 0;

  // Nothing to show and no handler — render nothing
  if (!hasPhotos && !onAddPhoto) return null;

  // Empty + has handler → pill chip (rendered by parent in the empty-pill row)
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

  // Has content → full section
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
              key={i}
              entry={entry}
              index={i}
              onViewPhoto={onViewPhoto}
              onDeletePhoto={onDeletePhoto}
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
}) {
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [sigPadOpen, setSigPadOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [toast, setToast] = useState(null);
  const [kebabOpen, setKebabOpen] = useState(false);
  const kebabRef = useRef(null);

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

  // Schedule edit — inline draft state
  const [schedEditMode, setSchedEditMode] = useState(false);
  const [schedDate, setSchedDate] = useState('');
  const [schedStart, setSchedStart] = useState('');
  const [schedEnd, setSchedEnd] = useState('');

  // Customer field editing — single EditFieldModal controlled by this key.
  // null = closed; 'name' | 'phone' | 'email' | 'summary' = which field is open.
  const [editingField, setEditingField] = useState(null);

  // Close on Escape — also closes lightbox, kebab, or customer-field edit modal if open
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (lightboxSrc) { setLightboxSrc(null); return; }
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

  const status = deriveStatus(job);
  const statusClass = STATUS_CLASS[status] || '';
  const displayName = job.customer || job.name || 'Unnamed job';
  const amount = job.total ?? job.amount;
  const showChase = shouldShowChase(job);

  // Invoice send CTA gating (still used for kebab menu items)
  const invoiceAlreadySent =
    status === 'Invoiced' || status === 'Paid' ||
    !!job.invoiceSentAt || job.status === 'invoice_sent';
  const showSendInvoice = status !== 'Paid' && !invoiceAlreadySent;
  const showResendInvoice = status !== 'Paid' && invoiceAlreadySent;

  const chaseState = getChaseState(job.id);
  const tier = computeTier(chaseState);
  const chasedLabel = lastChasedLabel(chaseState);

  const handleChase = () => {
    const phone = resolvePhone(job);
    const outstanding = computeBalance(job);
    const amountPaid = computeAmountPaid(job);
    const link = buildChaseLink({
      phone,
      name: job.customer || job.name || '',
      amountOutstanding: gbp(outstanding),
      daysSinceDue: daysSinceDue(job),
      tier,
      amountPaid,
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
    };
    if (!canonicalMap[fieldKey]) return;
    onUpdateJob({ ...job, [fieldKey]: value || null });
  };

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

  // ── Pipeline transitions ──────────────────────────────────────────────────
  // Mirrors legacy convertToJob (App.jsx line 620) and Mark Sent (line 660).
  const handleMarkSent = () => {
    onUpdateJob({ ...job, quoteStatus: 'sent' });
    showFlash('Quote marked as sent');
  };

  const handleConvert = () => {
    onUpdateJob({ ...job, quoteStatus: 'accepted', jobStatus: 'active' });
    showFlash('Converted to active job');
  };

  // Phase F — Accept Quote with signature.
  // Called by SignaturePad.onSave with the PNG dataURL after customer signs.
  const handleSignatureSave = (signatureDataURL) => {
    setSigPadOpen(false);
    onUpdateJob({
      ...job,
      acceptedSignature: signatureDataURL,
      quoteStatus: 'accepted',
      acceptedAt: new Date().toISOString(),
      jobStatus: 'active',
    });
    showFlash('Quote accepted — signed by customer');
  };

  // ── Send link (Phase G-1 / B5) ───────────────────────────────────────────
  // Lazily generates a publicAccessToken on first tap, then:
  //   • WhatsApp-first: if the customer has a phone, open wa.me with the quote
  //     URL and a pre-filled message so WhatsApp opens directly to their chat.
  //   • Fallback: no phone → Web Share API (OS share sheet).
  //   • Last resort: no phone AND no Web Share API → clipboard copy.
  const handleSendLink = async () => {
    // Ensure the job has a token — generate one if not
    let token = job.publicAccessToken;
    if (!token) {
      token = generatePublicAccessToken();
      // Persist immediately so the token survives if the user closes the drawer
      if (onUpdateJob) {
        onUpdateJob({ ...job, publicAccessToken: token });
      }
    }

    const quoteUrl = buildPublicQuoteUrl(token);
    const phone = resolvePhone(job);

    if (phone) {
      // WhatsApp-first: open wa.me deep-link with recipient + pre-filled message
      const message = buildQuoteWhatsAppMessage({ job, biz, quoteUrl });
      const link = buildWhatsAppLink({ phone, message });
      window.open(link, '_blank', 'noopener');
      logTelemetry('quote_send', { channel: 'whatsapp' });
      return;
    }

    // No phone — fall back to OS share sheet
    if (navigator.share) {
      const customerName = job.customer || job.name || '';
      const businessName = biz?.name || biz?.business_name || job.businessName || job.business_name || '';
      const shareText = buildShareMessage(quoteUrl, customerName, businessName);
      try {
        await navigator.share({ title: 'Your quote', text: shareText, url: quoteUrl });
        logTelemetry('quote_send', { channel: 'share' });
        return;
      } catch (err) {
        // User cancelled the share sheet — treat as no-op, not an error
        if (err?.name === 'AbortError') return;
        // Share failed for another reason — fall through to clipboard
      }
    }

    // No phone AND no Web Share API — clipboard copy
    try {
      await navigator.clipboard.writeText(quoteUrl);
      showFlash('Link copied — paste it in WhatsApp');
      logTelemetry('quote_send', { channel: 'clipboard' });
    } catch {
      showFlash('Could not copy link — share this URL: ' + quoteUrl);
    }
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

  // ── Stateful primary CTA derivation ──────────────────────────────────────
  // Maps the job's position in the Get Paid loop to a single primary action.
  // All handlers are defined above — derivation lives here so handleSendLink
  // is in scope.
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

  let primaryCtaLabel = null;
  let primaryCtaHandler = null;
  const primaryCtaClass = 'btn-primary job-detail-cta-primary';

  if (!isPaid) {
    if (isInvoiced && showChase) {
      primaryCtaLabel = 'Chase via WhatsApp';
      primaryCtaHandler = handleChase;
    } else if (isInvoiced) {
      primaryCtaLabel = 'Record payment';
      primaryCtaHandler = () => setPaymentModalOpen(true);
    } else if (isQuoteAccepted) {
      primaryCtaLabel = 'Send invoice';
      primaryCtaHandler = () => setInvoiceModalOpen(true);
    } else if (isQuoteSent) {
      primaryCtaLabel = 'Resend quote link';
      primaryCtaHandler = handleSendLink;
    } else {
      primaryCtaLabel = 'Send quote link';
      primaryCtaHandler = handleSendLink;
    }
  }

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
            <span className={`job-status-pill ${statusClass}`}>{status[0]}</span>
            <div className="job-detail-title-block">
              {onUpdateJob ? (
                <button
                  type="button"
                  className="jd-customer-edit-btn"
                  onClick={() => setEditingField('name')}
                  aria-label="Edit customer name"
                >
                  <span className="job-detail-customer">{displayName}</span>
                  <span className="jd-customer-edit-icon" aria-hidden="true">›</span>
                </button>
              ) : (
                <div className="job-detail-customer">{displayName}</div>
              )}
              {job.summary && (
                <div className="job-detail-summary">{job.summary}</div>
              )}
            </div>
          </div>
          <div className="job-detail-header-right">
            {typeof amount === 'number' && (
              <div className="job-detail-amount">
                {gbp(amount)}
              </div>
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
                  {/* Record payment — always visible when not paid */}
                  {!isPaid && (
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
                      onClick={() => { setKebabOpen(false); setInvoiceModalOpen(true); }}
                    >
                      Send invoice
                    </button>
                  )}
                  {showResendInvoice && (
                    <button
                      type="button"
                      className="jd-kebab-item"
                      role="menuitem"
                      onClick={() => { setKebabOpen(false); setInvoiceModalOpen(true); }}
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

        {/* Scrollable body */}
        <div className="job-detail-body">
          {/* Payment summary — self-gates; only renders when there's payment state */}
          <PaymentSummaryBlock
            job={job}
            onRecordPayment={() => setPaymentModalOpen(true)}
            onMarkAsPaid={() => {
              const balance = computeBalance(job);
              if (balance > 0) {
                onAddPayment(job, {
                  amount: balance,
                  date: new Date().toISOString().slice(0, 10),
                  method: 'unknown',
                  note: '',
                });
                showFlash('Job marked paid');
              }
            }}
          />

          {/* Single stateful primary CTA — one action, the right action for the job's state */}
          {primaryCtaLabel && primaryCtaHandler && (
            <div className="job-detail-cta-row">
              <button
                type="button"
                className={primaryCtaClass}
                onClick={primaryCtaHandler}
              >
                {primaryCtaLabel}
              </button>
              {primaryCtaLabel === 'Chase via WhatsApp' && chasedLabel && (
                <span className="job-detail-chased-label">{chasedLabel}</span>
              )}
            </div>
          )}

          {/* ── Content sections ── */}

          {/* Profit overview — sits above the details so profitability is front-and-centre */}
          <ProfitBarSection job={job} receipts={receipts} />

          {/* Job details (description, address, contact, dates, schedule edit) */}
          <DetailsSection
            job={job}
            schedEditMode={schedEditMode}
            schedDate={schedDate}
            schedStart={schedStart}
            schedEnd={schedEnd}
            onScheduleEdit={onUpdateJob ? handleScheduleEdit : undefined}
            onScheduleCancel={handleScheduleCancel}
            onScheduleSave={handleScheduleSave}
            onScheduleDateChange={setSchedDate}
            onScheduleStartChange={setSchedStart}
            onScheduleEndChange={setSchedEnd}
            onEditSummary={onUpdateJob ? () => setEditingField('summary') : undefined}
            onEditPhone={onUpdateJob ? () => setEditingField('phone') : undefined}
            onEditEmail={onUpdateJob ? () => setEditingField('email') : undefined}
          />

          {/* Quick-contact buttons — below Details since it's contact-related */}
          <QuickContactSection job={job} />

          {/* Quote breakdown — editable line items that make up the job total */}
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

          {/* Hidden file input for photo capture — rendered here so handlePhotoFiles
              has access to onUpdateJob via closure. The button lives in PhotosSection. */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            style={{ display: 'none' }}
            onChange={handlePhotoFiles}
            aria-hidden="true"
          />

          {/* Receipts / Photos / Notes: render as full sections when they have content,
              or as inline pill chips when empty. Chips are grouped on one row so they
              don't each take a full-width block of vertical space. */}
          {(() => {
            const receiptsEl = (
              <ReceiptsSection
                job={job}
                receipts={receipts}
                onViewPhoto={setLightboxSrc}
                onAddReceipt={onAddReceipt ? () => setReceiptModalOpen(true) : undefined}
                onDeleteReceipt={onDeleteReceipt ? handleDeleteReceipt : undefined}
                onEditReceipt={onUpdateJob ? setEditingReceipt : undefined}
              />
            );
            const photosEl = (
              <PhotosSection
                photos={job.photos}
                onViewPhoto={setLightboxSrc}
                onAddPhoto={onUpdateJob ? () => photoInputRef.current?.click() : undefined}
                photoAdding={photoAdding}
                onDeletePhoto={onUpdateJob ? handleDeletePhoto : undefined}
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

            // Determine which sections are in "pill chip" mode vs full-section mode.
            // A section component returns a <button className="jd-pill-chip"> when empty.
            // We collect all chips and render them in a single row to minimise vertical space.
            const hasReceiptContent = receipts.some(r =>
              r.jobId && (String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId))
            );
            const hasPhotoContent = Array.isArray(job.photos) && job.photos.length > 0;
            const hasNoteContent = (Array.isArray(job.jobNotes) && job.jobNotes.length > 0) ||
              (typeof job.notes === 'string' && job.notes.trim());

            const sections = [];

            // Full sections first
            if (hasReceiptContent) sections.push(<React.Fragment key="receipts">{receiptsEl}</React.Fragment>);
            if (hasPhotoContent) sections.push(<React.Fragment key="photos">{photosEl}</React.Fragment>);
            if (hasNoteContent || noteFormOpen) sections.push(<React.Fragment key="notes">{notesEl}</React.Fragment>);

            // Collect pill chips for empty sections
            const chips = [];
            if (!hasReceiptContent && onAddReceipt) chips.push(<React.Fragment key="chip-receipts">{receiptsEl}</React.Fragment>);
            if (!hasPhotoContent && onUpdateJob) chips.push(<React.Fragment key="chip-photos">{photosEl}</React.Fragment>);
            if (!hasNoteContent && !noteFormOpen && onUpdateJob) chips.push(<React.Fragment key="chip-notes">{notesEl}</React.Fragment>);

            if (chips.length > 0) {
              sections.push(
                <div key="pill-row" className="jd-pill-row">
                  {chips}
                </div>
              );
            }

            return sections;
          })()}

          {/* Payment history — self-gates when no payments */}
          <PaymentHistoryList
            job={job}
            onEditPayment={onUpdateJob ? setEditingPayment : undefined}
            onDeletePayment={onUpdateJob ? handleDeletePayment : undefined}
          />
        </div>

        {/* Toast */}
        {toast && (
          <div className="job-detail-toast" role="status">{toast}</div>
        )}
      </div>

      {/* Photo lightbox — sits on top of everything */}
      <PhotoLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

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
        />
      )}

      {/* SendInvoiceModal — rendered outside the sheet so it sits on top */}
      {invoiceModalOpen && (
        <SendInvoiceModal
          job={job}
          biz={biz ?? {}}
          profile={profile ?? null}
          jobs={jobs ?? []}
          onUpdate={onUpdateJob ?? (() => {})}
          onClose={() => setInvoiceModalOpen(false)}
          flash={showFlash}
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
          currentValue={job.customer || job.name || ''}
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
          fieldLabel="Job description"
          currentValue={job.summary || ''}
          inputType="textarea"
          rows={4}
          placeholder="Describe the job…"
          onSave={handleCustomerFieldSave}
          onClose={() => setEditingField(null)}
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
