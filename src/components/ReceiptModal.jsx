/**
 * ReceiptModal — bottom-sheet shown when the trader taps "View receipt" on a Paid job.
 *
 * View A (receipt): branded RECEIPT summary with job details, amount paid, paid date,
 *   and a PAID IN FULL marker.
 * View B (send): WhatsApp deep-link (primary) + share-sheet with PDF + download.
 *
 * Delivery mirrors SendInvoiceModal conventions so the two flows feel identical.
 *
 * Props:
 *   job       – full job object (must be Paid stage)
 *   biz       – business settings (name, branding — no bank details on receipts)
 *   onClose() – close the modal
 *   flash(msg) – toast callback
 */
import { useState } from 'react';
import {
  resolvePaidDate,
  resolveAmountPaid,
  formatReceiptDate,
  buildReceiptWhatsAppMessage,
} from '../lib/receiptMessage.js';
import { getReceiptPDFBlob, downloadReceiptPDF } from '../lib/receiptPDF.js';
import { buildWhatsAppLink } from '../lib/invoiceMessage.js';
import { logTelemetry } from '../lib/telemetry.js';

// Module-level capability check — same pattern as SendInvoiceModal.
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

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * ReceiptSummary — the branded RECEIPT card shown in the modal body.
 * Renders the job details, amount paid, paid date, and PAID IN FULL stamp.
 */
function ReceiptSummary({ job, biz }) {
  const amountPaid = resolveAmountPaid(job);
  const paidDate = resolvePaidDate(job);
  const paidDateLabel = formatReceiptDate(paidDate);
  const jobTotal = Number(job?.total ?? job?.amount ?? 0) || 0;

  // Line items: prefer job.lineItems if present, otherwise single row from summary + total.
  const lineItems =
    Array.isArray(job?.lineItems) && job.lineItems.length > 0
      ? job.lineItems
      : [{ desc: job?.summary || 'Work completed', cost: jobTotal }];

  return (
    <div className="receipt-card" aria-label="Receipt summary">
      {/* Business header */}
      <div className="receipt-biz-name">{biz?.name || 'Your Business'}</div>
      {biz?.address && <div className="receipt-biz-address">{biz.address}</div>}

      <div className="receipt-divider" />

      {/* RECEIPT label + date */}
      <div className="receipt-heading-row">
        <span className="receipt-heading-label">RECEIPT</span>
        <span className="receipt-heading-date">{paidDateLabel}</span>
      </div>

      {/* Customer */}
      <div className="receipt-customer">
        {job?.customer || job?.name || 'Customer'}
      </div>

      {/* Job summary */}
      <div className="receipt-summary-text">
        {job?.summary || 'Work completed'}
      </div>

      <div className="receipt-divider" />

      {/* Line items */}
      <div className="receipt-line-items">
        {lineItems.map((li, i) => (
          <div key={i} className="receipt-line-item">
            <span className="receipt-line-desc">{li.desc || 'Item'}</span>
            <span className="receipt-line-amount">£{(li.cost || 0).toFixed(2)}</span>
          </div>
        ))}
      </div>

      <div className="receipt-divider" />

      {/* Amount paid */}
      <div className="receipt-total-row">
        <span className="receipt-total-label">Amount paid</span>
        <span className="receipt-total-value">£{amountPaid.toFixed(2)}</span>
      </div>

      {/* PAID IN FULL stamp */}
      <div className="receipt-paid-stamp" aria-label="Paid in full">
        PAID IN FULL
      </div>

      <div className="receipt-thankyou">Thank you for your business.</div>
    </div>
  );
}

// ── ReceiptModal ──────────────────────────────────────────────────────────────

export default function ReceiptModal({ job, biz, onClose, flash }) {
  const [busy, setBusy] = useState(false);

  const phone = job?.customerPhone || job?.phone || job?.mobile || '';
  const message = buildReceiptWhatsAppMessage({ job, biz });

  // Primary: WhatsApp deep-link — fast, no PDF overhead
  const handleWhatsApp = () => {
    logTelemetry('receipt_send', { channel: 'whatsapp' });
    const link = buildWhatsAppLink({ phone, message });
    window.open(link, '_blank', 'noopener');
    flash?.('Receipt sent');
    onClose?.();
  };

  // Secondary: Web Share API with PDF (iOS/Android share sheet)
  const handleSharePDF = async () => {
    logTelemetry('receipt_send', { channel: 'share' });
    setBusy(true);
    try {
      const blob = getReceiptPDFBlob({ job, biz });
      const customer = (job?.customer || job?.name || 'receipt').replace(/\s+/g, '-');
      const file = new File([blob], `receipt-${customer}.pdf`, { type: 'application/pdf' });
      if (canShareFile(file)) {
        await navigator.share({ files: [file], text: message, title: 'Receipt' });
        flash?.('Receipt sent');
        onClose?.();
      } else {
        // Fallback: download PDF + WhatsApp text
        downloadReceiptPDF({ job, biz });
        const link = buildWhatsAppLink({ phone, message });
        window.open(link, '_blank', 'noopener');
        flash?.('Receipt sent');
        onClose?.();
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        flash?.('Could not send — try download below');
      }
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  // Tertiary: plain PDF download
  const handleDownloadPDF = () => {
    logTelemetry('receipt_send', { channel: 'download' });
    try {
      downloadReceiptPDF({ job, biz });
      flash?.('Receipt downloaded');
      onClose?.();
    } catch {
      flash?.('PDF failed — check Settings for business details');
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="modal-sheet">
        {/* Header */}
        <div className="modal-sheet-header">
          <h3 className="modal-sheet-title">Receipt</h3>
          <button
            type="button"
            className="modal-sheet-close"
            onClick={onClose}
            aria-label="Close receipt"
          >
            ✕
          </button>
        </div>

        {/* Branded receipt card */}
        <div className="modal-sheet-body">
          <ReceiptSummary job={job} biz={biz} />
        </div>

        {/* Send receipt — primary: WhatsApp */}
        <button
          type="button"
          className="btn-primary modal-sheet-btn receipt-send-whatsapp"
          onClick={handleWhatsApp}
        >
          Send receipt via WhatsApp
        </button>

        {/* Secondary send options */}
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
