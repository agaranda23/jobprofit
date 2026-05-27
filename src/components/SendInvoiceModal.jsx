/**
 * SendInvoiceModal — bottom-sheet for sending an invoice from JobDetailDrawer.
 *
 * Primary send path: wa.me deep-link opens WhatsApp directly with invoice
 * text + bank details. Fast, native, no app-switching friction.
 *
 * Secondary path ("More ways to send"):
 *   - Web Share API with PDF file (attaches the actual PDF — heavier but
 *     useful when the customer needs a formal document).
 *   - PDF download (for manual attachment or filing).
 *
 * Props:
 *   job         – full job object
 *   biz         – business settings object (name, bank details, VAT flag, etc.)
 *   profile     – Supabase profiles row (or null when unauthenticated)
 *   jobs        – all jobs array (needed by nextInvoiceNumber to avoid gaps)
 *   onUpdate(updatedJob) – persists the job update (sets invoiceSentAt, etc.)
 *   onClose()   – close the modal
 *   flash(msg)  – toast callback from the parent drawer
 */
import { useState } from 'react';
import { getInvoicePDFBlob, downloadInvoicePDF } from '../lib/invoicePDF';
import { buildInvoiceWhatsAppMessage, buildWhatsAppLink } from '../lib/invoiceMessage';
import { nextInvoiceNumber } from '../lib/invoiceNumber';
import { getMissingInvoiceFields } from '../lib/bizValidation';
import { canSendInvoice, incrementSendCount } from '../lib/plan';
import { supabase } from '../lib/supabase';
import { logTelemetry } from '../lib/telemetry';

// Returns true when this browser supports navigator.share() with a files array.
// Stored as a module-level constant so we don't recalculate on every render.
const SUPPORTS_FILE_SHARE =
  typeof navigator !== 'undefined' &&
  typeof navigator.share === 'function' &&
  typeof navigator.canShare === 'function';

function canShareFile(file) {
  if (!SUPPORTS_FILE_SHARE) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SendInvoiceModal({
  job,
  biz,
  profile,
  jobs,
  onUpdate,
  onClose,
  flash,
}) {
  const [invoiceNumber, setInvoiceNumber] = useState(
    () => job.invoiceNumber || nextInvoiceNumber(jobs)
  );
  const [dueDate, setDueDate] = useState(() => {
    if (job.invoiceDueDate) return new Date(job.invoiceDueDate).toISOString().slice(0, 10);
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('send'); // 'send' | 'paywall'

  const isFirstSend = job.status !== 'invoice_sent';
  const missing = getMissingInvoiceFields(biz, profile);
  const message = buildInvoiceWhatsAppMessage({ job, biz, invoiceNumber, dueDate });

  // Performs the status transition on first send.
  // Returns false when the paywall should block the send.
  const attemptSend = () => {
    if (isFirstSend && !canSendInvoice(profile)) {
      setView('paywall');
      return false;
    }
    if (isFirstSend) {
      onUpdate({
        ...job,
        status: 'invoice_sent',
        invoiceSentAt: new Date().toISOString(),
        invoiceNumber,
        invoiceDueDate: new Date(dueDate).toISOString(),
      });
      // Fire-and-forget Supabase increment — silently tolerates offline.
      incrementSendCount(supabase, profile?.id);
    }
    return true;
  };

  // Primary path: wa.me deep-link — opens WhatsApp with invoice text + bank
  // details. Fast, no PDF generation overhead, works on any phone.
  const handleWhatsApp = () => {
    logTelemetry('invoice_send', { channel: 'whatsapp' });
    if (!attemptSend()) return;
    const link = buildWhatsAppLink({
      phone: job.customerPhone || job.phone || '',
      message,
    });
    window.open(link, '_blank', 'noopener');
    flash('Invoice sent');
    onClose();
  };

  // Secondary path: Web Share API with PDF file (modern iOS/Android). Attaches
  // the actual PDF so customers who need a formal document get one.
  const handleSharePDF = async () => {
    logTelemetry('invoice_send', { channel: 'share' });
    if (!attemptSend()) return;
    setBusy(true);
    try {
      const blob = getInvoicePDFBlob({ job, biz, invoiceNumber, dueDate });
      const file = new File([blob], `${invoiceNumber}.pdf`, { type: 'application/pdf' });
      if (canShareFile(file)) {
        await navigator.share({
          files: [file],
          text: message,
          title: `Invoice ${invoiceNumber}`,
        });
        flash('Invoice sent');
        onClose();
      } else {
        // Fallback: download PDF + open WhatsApp deep-link with text.
        downloadInvoicePDF({ job, biz, invoiceNumber, dueDate });
        const link = buildWhatsAppLink({
          phone: job.customerPhone || job.phone || '',
          message,
        });
        window.open(link, '_blank', 'noopener');
        flash('Invoice sent');
        onClose();
      }
    } catch (err) {
      // navigator.share throws AbortError when the user dismisses the sheet —
      // that's intentional, not a failure. Don't flash an error for it and
      // don't close the modal so the trader can try again.
      if (err?.name !== 'AbortError') {
        flash('Could not send — try the download below');
      }
      // NOTE: if attemptSend already called onUpdate we can't rollback cleanly
      // without a dedicated undo path, so we only rollback when no share happened.
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  const handleDownloadPDF = () => {
    logTelemetry('invoice_send', { channel: 'download' });
    if (!attemptSend()) return;
    try {
      downloadInvoicePDF({ job, biz, invoiceNumber, dueDate });
      flash('Invoice downloaded');
      onClose();
    } catch {
      flash('PDF failed — check Settings for business details');
    }
  };

  // ── Paywall view ───────────────────────────────────────────────────────────
  if (view === 'paywall') {
    return (
      <div className="modal-backdrop modal-backdrop--top" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal-sheet">
          <div className="modal-sheet-header">
            <h3 className="modal-sheet-title">Unlock unlimited sends</h3>
            <button className="modal-sheet-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="modal-sheet-body">
            <p className="modal-sheet-text">You sent your first invoice on us.</p>
            <p className="modal-sheet-text">Pro keeps the loop running — every quote, every invoice, every chase, no cap.</p>
            <p className="modal-sheet-text">Same app, same 30 seconds, no per-invoice fee.</p>
          </div>
          <div className="modal-price-block">
            <div className="modal-price">£12<span className="modal-price-period">/month</span></div>
            <div className="modal-price-sub">cancel anytime · early access price</div>
          </div>
          {/* Waitlist URL is a placeholder — replace with Stripe checkout when wired. */}
          <a
            href="https://tally.so/r/jobprofit-pro-waitlist"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary modal-sheet-btn"
          >
            Get Pro
          </a>
          {/* "Not yet" returns to send view, not to job detail */}
          <button
            className="btn-ghost modal-sheet-btn"
            onClick={() => setView('send')}
          >
            Not yet
          </button>
        </div>
      </div>
    );
  }

  // ── Send view ──────────────────────────────────────────────────────────────
  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet">
        <div className="modal-sheet-header">
          <h3 className="modal-sheet-title">Send Invoice</h3>
          <button className="modal-sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Job summary card */}
        <div className="invoice-preview-card">
          <div className="invoice-preview-name">{job.customer || job.name}</div>
          <div className="invoice-preview-summary">
            {(job.summary || '').slice(0, 60)}
          </div>
          <div className="invoice-preview-amount">
            {typeof (job.total ?? job.amount) === 'number'
              ? `£${Number(job.total ?? job.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`
              : ''}
          </div>
        </div>

        {/* Invoice number + due date row */}
        <div className="invoice-fields-row">
          <div className="invoice-field-group">
            <label className="invoice-field-label" htmlFor="inv-number">
              Invoice number
            </label>
            <input
              id="inv-number"
              className="invoice-field-input"
              value={invoiceNumber}
              onChange={e => setInvoiceNumber(e.target.value)}
            />
          </div>
          <div className="invoice-field-group">
            <label className="invoice-field-label" htmlFor="inv-due">
              Due date
            </label>
            <input
              id="inv-due"
              type="date"
              className="invoice-field-input"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
            />
          </div>
        </div>

        {/* Missing fields warning */}
        {missing.length > 0 && (
          <div className="invoice-missing-warning">
            Missing: {missing.join(', ')} — fix in Settings for payment instructions
          </div>
        )}

        {/* Primary CTA — WhatsApp deep-link (fast, no PDF overhead) */}
        <button
          type="button"
          className="btn-primary modal-sheet-btn invoice-send-whatsapp"
          onClick={handleWhatsApp}
        >
          💬 Send via WhatsApp
        </button>

        {/* More ways to send — secondary options, always visible */}
        <div className="invoice-secondary-actions">
          <div className="invoice-more-ways-label">More ways to send</div>
          <button
            type="button"
            className="btn-secondary modal-sheet-btn"
            onClick={handleSharePDF}
            disabled={busy}
          >
            {busy ? 'Preparing PDF…' : 'Send with PDF (share sheet)'}
          </button>
          <button
            type="button"
            className="btn-ghost modal-sheet-btn"
            onClick={handleDownloadPDF}
          >
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}
