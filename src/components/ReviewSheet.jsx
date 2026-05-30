/**
 * ReviewSheet — bottom sheet for reviewing a quote or invoice before sending.
 *
 * PRD spec: Option A (locked 2026-05-30).
 *
 * Modes:
 *   'quote'   — "Review quote · {Job name}"
 *               Primary: "Send via WhatsApp"
 *               Peers: "Save draft" · "Download PDF"
 *
 *   'invoice' — "Review invoice · {Job name}"
 *               Primary: "Send invoice via WhatsApp"
 *               Peers: "Save draft" · "Download PDF"
 *               Chip: "Auto-chase: on" (visual only in v1)
 *
 * Dismissing without sending auto-saves draft flag on the job and shows
 * "Draft saved. Send when you're ready." toast.
 *
 * PDF download shows "Saved to Files. Share it however you like." toast.
 *
 * Props:
 *   mode          – 'quote' | 'invoice'
 *   job           – full job object
 *   biz           – business settings object
 *   jobs          – all jobs array (for nextInvoiceNumber)
 *   onClose()     – close without draft save
 *   onDismiss()   – close + save draft (called when user taps X or backdrop)
 *   onUpdate(job) – persists job update (invoiceSentAt, quoteSentAt, draft flags)
 *   flash(msg)    – toast callback
 */

import { useState, useCallback } from 'react';
import { downloadInvoicePDF } from '../lib/invoicePDF';
import { downloadQuotePDF } from '../lib/invoicePDF';
import { buildInvoiceWhatsAppMessage, buildWhatsAppLink } from '../lib/invoiceMessage';
import { buildQuoteWhatsAppMessage } from '../lib/quoteMessage';
import { nextInvoiceNumber } from '../lib/invoiceNumber';
import {
  generatePublicAccessToken,
  buildPublicQuoteUrl,
} from '../lib/publicQuoteToken';
import { logTelemetry } from '../lib/telemetry';

// ── Helpers ────────────────────────────────────────────────────────────────────

function resolvePhone(job) {
  return job.customerPhone || job.phone || job.mobile || job.whatsapp || '';
}

function gbp(n) {
  return '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Line-item preview ──────────────────────────────────────────────────────────

function PreviewTable({ job }) {
  const lineItems = Array.isArray(job?.lineItems) && job.lineItems.length > 0
    ? job.lineItems
    : [{ desc: job?.summary || 'Work', cost: job?.total ?? job?.amount ?? 0 }];

  const total = job?.total ?? job?.amount ?? 0;

  return (
    <div className="rs-preview">
      <div className="rs-preview-header">
        <span className="rs-preview-customer">
          {job?.customer || job?.name
            ? (job.customer || job.name)
            : <span className="rs-preview-add-customer">+ Add customer</span>}
        </span>
        <span className="rs-preview-total">{gbp(total)}</span>
      </div>
      <ul className="rs-line-items" aria-label="Line items">
        {lineItems.map((li, i) => (
          <li key={i} className="rs-line-item">
            <span className="rs-li-desc">{li.desc || '—'}</span>
            <span className="rs-li-cost">{gbp(li.cost ?? 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ReviewSheet({
  mode,
  job,
  biz,
  jobs,
  onClose,
  onDismiss,
  onUpdate,
  flash,
}) {
  const isInvoice = mode === 'invoice';

  const [invoiceNumber] = useState(
    () => job.invoiceNumber || nextInvoiceNumber(jobs)
  );
  const [dueDate] = useState(() => {
    if (job.invoiceDueDate) return new Date(job.invoiceDueDate).toISOString().slice(0, 10);
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState(false);

  const jobName = job?.summary || job?.customer || job?.name || 'Job';
  const sheetTitle = isInvoice
    ? `Review invoice · ${jobName}`
    : `Review quote · ${jobName}`;

  // Dismiss = close + save draft
  const handleDismiss = useCallback(() => {
    const draftPatch = isInvoice
      ? { ...job, invoiceDraft: true }
      : { ...job, quoteDraft: true };
    onUpdate?.(draftPatch);
    flash?.('Draft saved. Send when you\'re ready.');
    onDismiss?.();
  }, [isInvoice, job, onUpdate, flash, onDismiss]);

  // ── Invoice: WhatsApp send ─────────────────────────────────────────────────
  const handleInvoiceWhatsApp = () => {
    logTelemetry('invoice_send', { channel: 'whatsapp', source: 'review_sheet' });
    const message = buildInvoiceWhatsAppMessage({ job, biz, invoiceNumber, dueDate });
    const link = buildWhatsAppLink({
      phone: resolvePhone(job),
      message,
    });
    onUpdate?.({
      ...job,
      status: 'invoice_sent',
      invoiceSentAt: new Date().toISOString(),
      invoiceNumber,
      invoiceDueDate: new Date(dueDate).toISOString(),
      invoiceDraft: false,
    });
    window.open(link, '_blank', 'noopener');
    flash?.('Invoice sent');
    onClose?.();
  };

  // ── Invoice: PDF download ──────────────────────────────────────────────────
  const handleInvoiceDownloadPDF = () => {
    logTelemetry('invoice_send', { channel: 'download', source: 'review_sheet' });
    try {
      downloadInvoicePDF({ job, biz, invoiceNumber, dueDate });
      flash?.('Saved to Files. Share it however you like.');
    } catch {
      flash?.('PDF failed — check Settings for business details');
    }
  };

  // ── Quote: WhatsApp send ───────────────────────────────────────────────────
  const handleQuoteWhatsApp = async () => {
    logTelemetry('quote_send', { channel: 'whatsapp', source: 'review_sheet' });
    let token = job.publicAccessToken;
    if (!token) {
      token = generatePublicAccessToken();
    }
    const quoteUrl = buildPublicQuoteUrl(token);
    const phone = resolvePhone(job);
    const message = buildQuoteWhatsAppMessage({ job, biz, quoteUrl });
    const link = buildWhatsAppLink({ phone: phone || '', message });

    onUpdate?.({
      ...job,
      status: job.status === 'lead' ? 'quoted' : job.status,
      quoteStatus: 'sent',
      quoteSentAt: new Date().toISOString(),
      publicAccessToken: token,
      quoteDraft: false,
    });

    if (phone) {
      window.open(link, '_blank', 'noopener');
    } else if (navigator.share) {
      setBusy(true);
      try {
        await navigator.share({ title: 'Your quote', text: message, url: quoteUrl });
      } catch (err) {
        if (err?.name !== 'AbortError') {
          flash?.('Could not share — try copying the link');
        }
        setBusy(false);
        return;
      }
      setBusy(false);
    } else {
      try {
        await navigator.clipboard.writeText(quoteUrl);
        flash?.('Link copied — paste it in WhatsApp');
      } catch {
        flash?.('Share this URL: ' + quoteUrl);
      }
    }

    flash?.('Quote sent');
    onClose?.();
  };

  // ── Quote: PDF download ────────────────────────────────────────────────────
  const handleQuoteDownloadPDF = () => {
    logTelemetry('quote_send', { channel: 'download', source: 'review_sheet' });
    try {
      downloadQuotePDF({ job, biz });
      flash?.('Saved to Files. Share it however you like.');
    } catch {
      flash?.('PDF failed — check Settings for business details');
    }
  };

  const primaryAction = isInvoice ? handleInvoiceWhatsApp : handleQuoteWhatsApp;
  const primaryLabel = isInvoice ? 'Send invoice via WhatsApp' : 'Send via WhatsApp';
  const handleDownloadPDF = isInvoice ? handleInvoiceDownloadPDF : handleQuoteDownloadPDF;

  return (
    <div
      className="modal-backdrop modal-backdrop--top"
      onClick={e => { if (e.target === e.currentTarget) handleDismiss(); }}
    >
      <div className="modal-sheet rs-sheet" role="dialog" aria-modal="true" aria-label={sheetTitle}>
        {/* Header */}
        <div className="modal-sheet-header">
          <h3 className="modal-sheet-title rs-title">{sheetTitle}</h3>
          <button
            className="modal-sheet-close"
            onClick={handleDismiss}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Document preview */}
        <PreviewTable job={job} />

        {/* Primary CTA — green WhatsApp button */}
        <button
          type="button"
          className="btn-primary modal-sheet-btn rs-send-btn"
          onClick={primaryAction}
          disabled={busy}
        >
          {busy ? 'Preparing…' : primaryLabel}
        </button>

        {/* Auto-chase chip — invoice mode only, visual in v1 */}
        {isInvoice && (
          <div className="rs-autochase-chip" aria-label="Auto-chase is on">
            Auto-chase: on
          </div>
        )}

        {/* Peer ghost buttons */}
        <div className="rs-peer-row">
          <button
            type="button"
            className="btn-ghost rs-peer-btn"
            onClick={handleDismiss}
          >
            Save draft
          </button>
          <button
            type="button"
            className="btn-ghost rs-peer-btn"
            onClick={handleDownloadPDF}
          >
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}
