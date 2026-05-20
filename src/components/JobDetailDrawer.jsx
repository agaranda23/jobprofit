import { useState, useEffect, useRef } from 'react';
import PaymentSummaryBlock from './PaymentSummaryBlock';
import PaymentHistoryList from './PaymentHistoryList';
import RecordPaymentModal from './RecordPaymentModal';
import SendInvoiceModal from './SendInvoiceModal';
import AddReceiptModal from './AddReceiptModal';
import {
  getChaseState,
  recordChase,
  buildChaseLink,
  computeTier,
  lastChasedLabel,
} from '../lib/chaseLadder';
import { computeBalance, computeAmountPaid } from '../lib/payments';
import { gbp } from '../lib/today';
import { compressPhoto } from '../lib/photoCompress';

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
 */
function DetailsSection({ job }) {
  const hasDesc = !!job.summary;
  const hasAddress = !!job.address;
  const hasPhone = !!(job.phone || job.customerPhone || job.mobile);
  const hasEmail = !!job.email;
  const hasDate = !!(job.date || job.createdAt);
  const hasScheduled = !!job.scheduledDate;
  const hasCompleted = !!job.completedAt;
  const hasHours = !!(job.hoursEstimate || job.hours);

  const visible = hasDesc || hasAddress || hasPhone || hasEmail || hasDate || hasScheduled || hasCompleted || hasHours;
  if (!visible) return null;

  const phone = job.phone || job.customerPhone || job.mobile || '';
  const scheduledTime =
    job.scheduledStart && job.scheduledEnd
      ? `${job.scheduledStart} – ${job.scheduledEnd}`
      : job.scheduledStart || '';

  return (
    <div className="jd-section">
      <div className="jd-section-header">Details</div>
      <div className="jd-section-body">
        {hasDesc && (
          <p className="jd-detail-desc">{job.summary}</p>
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
        {hasPhone && (
          <a href={`tel:${phone}`} className="jd-detail-row jd-detail-link">
            <span className="jd-detail-icon">📞</span>
            <span>{phone}</span>
          </a>
        )}
        {hasEmail && (
          <a href={`mailto:${job.email}`} className="jd-detail-row jd-detail-link">
            <span className="jd-detail-icon">✉️</span>
            <span>{job.email}</span>
          </a>
        )}
        {hasDate && (
          <div className="jd-detail-row">
            <span className="jd-detail-icon">📅</span>
            <span>Created {fmtDate(job.date || job.createdAt)}</span>
          </div>
        )}
        {hasScheduled && (
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
      </div>
    </div>
  );
}

/**
 * ProfitBarSection — read-only stacked bar showing quote / materials / profit / margin.
 * "Materials" here means actual receipts/expenses linked to the job (not the quote lineItems).
 * Hidden entirely when job.quote === 0 (no "0% margin" stub for jobs with no quote).
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
      <div className="jd-section-body">
        <div className="jd-profit-grid">
          <div className="jd-profit-cell">
            <div className="jd-profit-label">Quote</div>
            <div className="jd-profit-value jd-profit-value--quote">{gbp(quote)}</div>
          </div>
          <div className="jd-profit-cell">
            <div className="jd-profit-label">Materials</div>
            <div className="jd-profit-value jd-profit-value--materials">{gbp(materials)}</div>
          </div>
          <div className="jd-profit-cell">
            <div className="jd-profit-label">Profit</div>
            <div className="jd-profit-value jd-profit-value--profit">{gbp(profit)}</div>
          </div>
          <div className="jd-profit-cell">
            <div className="jd-profit-label">Margin</div>
            <div className="jd-profit-value" style={{ color: marginColor }}>{margin}%</div>
          </div>
        </div>
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
      </div>
    </div>
  );
}

/**
 * QuoteBreakdownSection — read-only list of job.lineItems[].
 * Shows per-item description, optional quantity, unit cost, and a total.
 * Hidden when lineItems is empty or absent. Edit/add is Phase E (deferred).
 */
function QuoteBreakdownSection({ job }) {
  const items = Array.isArray(job.lineItems) ? job.lineItems.filter(i => i.desc || i.cost) : [];
  if (items.length === 0) return null;

  const total = items.reduce((sum, i) => {
    const qty = Number(i.qty || i.quantity || 1);
    const unit = Number(i.cost || i.unitCost || i.price || 0);
    return sum + qty * unit;
  }, 0);

  return (
    <div className="jd-section">
      <div className="jd-section-header">Quote breakdown</div>
      <div className="jd-section-body jd-section-body--flush">
        {items.map((item, idx) => {
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
        })}
        <div className="jd-line-total">
          <span className="jd-line-total-label">Total</span>
          <span className="jd-line-total-value">{gbp(total)}</span>
        </div>
      </div>
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
function ReceiptsSection({ job, receipts, onViewPhoto, onAddReceipt, onDeleteReceipt }) {
  // receipts shape from getTodayReceipts: { id, label, amount, photo, date, jobId, imagePath }
  // Match on both string UUID (cloud) and legacy integer-style IDs
  const jobReceipts = receipts.filter(r => {
    if (!r.jobId) return false;
    return String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId);
  });

  // Hide entirely when there's nothing to show and no handler to add one
  if (jobReceipts.length === 0 && !onAddReceipt) return null;

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
      {jobReceipts.length > 0 && (
        <div className="jd-section-body jd-section-body--flush">
          {jobReceipts.map(r => (
            <div key={r.id} className="jd-receipt-row">
              {r.photo ? (
                <button
                  type="button"
                  className="jd-receipt-thumb-btn"
                  onClick={() => onViewPhoto(r.photo)}
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
                    onClick={() => onDeleteReceipt(r.id)}
                    aria-label="Delete receipt"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
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
 * The file input and its ref live in JobDetailDrawer (the parent) because
 * the async compression handler needs access to onUpdateJob. This component
 * receives onAddPhoto (a function that triggers photoInputRef.current.click())
 * and photoAdding (a loading flag) for display purposes.
 *
 * onDeletePhoto(idx) — optional; when present, each thumbnail gets an × button.
 */
function PhotosSection({ photos, onViewPhoto, onAddPhoto, photoAdding, onDeletePhoto }) {
  const hasPhotos = Array.isArray(photos) && photos.length > 0;

  // Hide entirely when nothing to show and no handler to add
  if (!hasPhotos && !onAddPhoto) return null;

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
      {hasPhotos && (
        <div className="jd-section-body">
          <div className="jd-photos-grid">
            {photos.map((src, i) => (
              <div key={i} className="jd-photo-thumb-wrap">
                <button
                  type="button"
                  className="jd-photo-thumb-btn"
                  onClick={() => onViewPhoto(src)}
                  aria-label={`View photo ${i + 1}`}
                >
                  <img src={src} alt="" className="jd-photo-thumb" />
                </button>
                {onDeletePhoto && (
                  <button
                    type="button"
                    className="jd-photo-delete-btn"
                    onClick={() => onDeletePhoto(i)}
                    aria-label={`Delete photo ${i + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
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
}) {
  const structuredNotes = Array.isArray(job.jobNotes) ? job.jobNotes : [];
  // cloud jobs may have a plain notes string instead of the structured array
  const plainNotes = typeof job.notes === 'string' ? job.notes.trim() : '';

  const hasContent = structuredNotes.length > 0 || !!plainNotes;
  const canAdd = typeof onOpenNoteForm === 'function';

  // Hide entirely when there's nothing to display and no way to add
  if (!hasContent && !canAdd) return null;

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
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [toast, setToast] = useState(null);

  // Photo add — hidden file input, ref kept here so the button can trigger it
  const photoInputRef = useRef(null);
  const [photoAdding, setPhotoAdding] = useState(false);

  // Note add — inline form state
  const [noteFormOpen, setNoteFormOpen] = useState(false);
  const [noteSubject, setNoteSubject] = useState('');
  const [noteBody, setNoteBody] = useState('');

  // Close on Escape — also closes lightbox if open
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (lightboxSrc) { setLightboxSrc(null); return; }
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, lightboxSrc]);

  const status = deriveStatus(job);
  const statusClass = STATUS_CLASS[status] || '';
  const displayName = job.customer || job.name || 'Unnamed job';
  const amount = job.total ?? job.amount;
  const showChase = shouldShowChase(job);

  // Invoice send CTA gating:
  // - "Send invoice" when the job has never been invoiced (status not Invoiced/Paid,
  //   and invoiceSentAt is absent).
  // - "Resend invoice" (secondary link) when invoice was already sent.
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

  // ── Photo add ─────────────────────────────────────────────────────────────
  // Mirrors handleJobPhoto in App.jsx (lines 618): file → base64 → compress → push
  const handlePhotoFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPhotoAdding(true);
    const compressed = [];
    for (const f of files) {
      try {
        const dataUrl = await compressPhoto(f);
        compressed.push(dataUrl);
      } catch {
        // skip unreadable files silently — user can try again
      }
    }
    if (compressed.length && onUpdateJob) {
      onUpdateJob({ ...job, photos: [...(job.photos || []), ...compressed] });
      showFlash('Photo added');
    }
    setPhotoAdding(false);
    // reset input so the same file can be re-added if needed
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

  // ── Photo delete ──────────────────────────────────────────────────────────
  // Mirrors rmPhoto in App.jsx (line 619): splice by index, write via onUpdateJob.
  const handleDeletePhoto = (idx) => {
    if (!window.confirm('Delete this photo?')) return;
    const updated = (job.photos || []).filter((_, i) => i !== idx);
    onUpdateJob({ ...job, photos: updated });
    showFlash('Photo deleted');
  };

  // ── Note delete ───────────────────────────────────────────────────────────
  // Mirrors deleteNote in App.jsx (line 617): filter by id, write via onUpdateJob.
  const handleDeleteNote = (noteId) => {
    if (!window.confirm('Delete this note?')) return;
    const updated = (job.jobNotes || []).filter(n => n.id !== noteId);
    onUpdateJob({ ...job, jobNotes: updated });
    showFlash('Note deleted');
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
              <div className="job-detail-customer">{displayName}</div>
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

          {/* Primary CTA block — mutually exclusive based on invoice state */}
          {showSendInvoice && (
            <div className="job-detail-cta-row">
              <button
                type="button"
                className="btn-primary job-detail-cta-primary"
                onClick={() => setInvoiceModalOpen(true)}
              >
                Send invoice
              </button>
            </div>
          )}

          {/* Once invoice is sent: Record payment becomes the primary CTA */}
          {!showSendInvoice && status !== 'Paid' && (
            <div className="job-detail-cta-row">
              <button
                type="button"
                className="btn-primary job-detail-cta-primary"
                onClick={() => setPaymentModalOpen(true)}
              >
                Record payment
              </button>
            </div>
          )}

          {/* Resend invoice — secondary, only when invoice already sent and not paid */}
          {showResendInvoice && (
            <div className="job-detail-resend-row">
              <button
                type="button"
                className="btn-ghost job-detail-resend-btn"
                onClick={() => setInvoiceModalOpen(true)}
              >
                Resend invoice
              </button>
            </div>
          )}

          {/* Chase CTA — only when unpaid + outstanding > 0 + phone present */}
          {showChase && (
            <div className="job-detail-chase-row">
              <button
                type="button"
                className="btn-secondary job-detail-chase-btn"
                onClick={handleChase}
              >
                Chase customer
              </button>
              {chasedLabel && (
                <span className="job-detail-chased-label">{chasedLabel}</span>
              )}
            </div>
          )}

          {/* ── Content sections ── */}

          {/* Profit overview — sits above the details so profitability is front-and-centre */}
          <ProfitBarSection job={job} receipts={receipts} />

          {/* Job details (description, address, contact, dates) */}
          <DetailsSection job={job} />

          {/* Quick-contact buttons — below Details since it's contact-related */}
          <QuickContactSection job={job} />

          {/* Quote breakdown — the priced line items that make up the job total */}
          <QuoteBreakdownSection job={job} />

          {/* Receipts (material purchase photos / linked expense records) */}
          <ReceiptsSection
            job={job}
            receipts={receipts}
            onViewPhoto={setLightboxSrc}
            onAddReceipt={onAddReceipt ? () => setReceiptModalOpen(true) : undefined}
            onDeleteReceipt={onDeleteReceipt ? handleDeleteReceipt : undefined}
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

          <PhotosSection
            photos={job.photos}
            onViewPhoto={setLightboxSrc}
            onAddPhoto={onUpdateJob ? () => photoInputRef.current?.click() : undefined}
            photoAdding={photoAdding}
            onDeletePhoto={onUpdateJob ? handleDeletePhoto : undefined}
          />

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
          />

          {/* Payment history — self-gates when no payments */}
          <PaymentHistoryList job={job} />
        </div>

        {/* Toast */}
        {toast && (
          <div className="job-detail-toast" role="status">{toast}</div>
        )}
      </div>

      {/* Photo lightbox — sits on top of everything */}
      <PhotoLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

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

      {/* AddReceiptModal — pre-bound to this job; jobId is injected in handleReceiptSave */}
      {receiptModalOpen && (
        <AddReceiptModal
          onClose={() => setReceiptModalOpen(false)}
          onSave={handleReceiptSave}
        />
      )}
    </>
  );
}
