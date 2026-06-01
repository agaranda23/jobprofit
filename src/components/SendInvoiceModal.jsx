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
 * Pay-now Connect prompt (Section 1.3 a, brief 2026-05-31):
 *   - If trader is NOT connected to Stripe: slim banner at top of modal.
 *     "Not now" dismisses for this invoice only (component-local state).
 *     "Set up" calls onNavigateToCardPayments.
 *     Send button still reads "Send invoice" — invoice sends as today.
 *   - If trader IS connected: Pay-now link is generated on modal open,
 *     prepended to all message paths. Button reads "Send invoice with Pay-now".
 *     Never blocks the send if the link fails to generate — falls back gracefully.
 *
 * Props:
 *   job         – full job object
 *   biz         – business settings object (name, bank details, VAT flag, etc.)
 *   profile     – Supabase profiles row (or null when unauthenticated)
 *   jobs        – all jobs array (needed by nextInvoiceNumber to avoid gaps)
 *   onUpdate(updatedJob) – persists the job update (sets invoiceSentAt, etc.)
 *   onClose()   – close the modal
 *   flash(msg)  – toast callback from the parent drawer
 *   onNavigateToCardPayments() – optional; called when trader taps "Set up" in connect prompt
 */
import { useState, useEffect } from 'react';
import { getInvoicePDFBlob, downloadInvoicePDF } from '../lib/invoicePDF';
import { buildInvoiceWhatsAppMessage, buildWhatsAppLink } from '../lib/invoiceMessage';
import { nextInvoiceNumber } from '../lib/invoiceNumber';
import { getMissingInvoiceFields } from '../lib/bizValidation';
import { canSendInvoice, incrementSendCount } from '../lib/plan';
import { supabase } from '../lib/supabase';
import { logTelemetry } from '../lib/telemetry';
import { startCheckout } from '../lib/billing';
import InvoiceDocumentPreview from './InvoiceDocumentPreview';

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
  // Optional: called when the user taps "Add price" on the £0 banner.
  // The drawer passes () => { closeModal; setEditingField('amount') }.
  onNeedsPrice,
  // Optional: called when the trader taps "Set up" in the connect prompt.
  // Typically navigates to Settings → Card payments.
  onNavigateToCardPayments,
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
  const [checkoutError, setCheckoutError] = useState(null);
  // showPreview: toggles the in-app invoice document preview panel.
  // Collapsed by default so the send CTA is the first thing the founder sees.
  const [showPreview, setShowPreview] = useState(false);

  // ── Pay-now state ────────────────────────────────────────────────────────────
  // isConnected: true when the trader has a connected Stripe account.
  const isConnected = profile?.stripe_connect_status === 'connected' && !!profile?.stripe_user_id;

  // payNowUrl: the generated Pay-now URL for connected traders. Populated on
  // mount via the create-invoice-payment-link function. Empty string = not yet
  // generated or generation failed. Never blocks the send.
  const [payNowUrl, setPayNowUrl]           = useState('');
  const [payNowLoading, setPayNowLoading]   = useState(false);

  // connectBannerDismissed: "Not now" in the connect prompt hides it for this
  // modal session only. Intentionally component-local (not persisted) so the
  // trader sees it again next time they open Send Invoice.
  const [connectBannerDismissed, setConnectBannerDismissed] = useState(false);

  // All hooks above — no early returns until after this point (PR #125 lesson).

  // Generate a Pay-now link when the modal opens for connected traders.
  // Fire-and-forget: if it fails, the modal still renders and the send path
  // falls back to the existing bank-transfer-only message.
  useEffect(() => {
    if (!isConnected || !job?.id) return;
    let cancelled = false;

    async function generate() {
      setPayNowLoading(true);
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
      } catch {
        // Silently skip — falls back to bank transfer only.
      } finally {
        if (!cancelled) setPayNowLoading(false);
      }
    }

    generate();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, job?.id]);

  const isFirstSend = job.status !== 'invoice_sent';
  const missing = getMissingInvoiceFields(biz, profile);
  // Merge the Stripe Payment Link from profile into biz so the lib functions
  // (invoiceMessage, invoicePDF) can read it regardless of the nav path.
  // biz may be null in the new-nav flow where only profile is available.
  // When the trader is connected and a Pay-now URL was generated, we use that
  // as the stripePaymentLink so the invoiceMessage lib injects it naturally
  // into the WhatsApp template (see invoiceMessage.js — it already handles this field).
  const effectivePaymentLink =
    (isConnected && payNowUrl)
      ? payNowUrl
      : (profile?.stripe_payment_link || biz?.stripePaymentLink || '');

  const bizWithStripe = {
    ...(biz || {}),
    stripePaymentLink: effectivePaymentLink,
  };
  const message = buildInvoiceWhatsAppMessage({ job, biz: bizWithStripe, invoiceNumber, dueDate });
  // Check whether the job has a usable price — treat null AND 0 as "no price".
  const invAmount = Number(job.total ?? job.amount);
  const isUnpriced = !invAmount || invAmount <= 0;

  // Performs the status transition on first send.
  // Returns false when the paywall should block the send.
  const attemptSend = () => {
    // Hard-stop backstop for £0 invoices — belt-and-suspenders behind the UI banner.
    if (isUnpriced) return false;
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
      // getInvoicePDFBlob is now async (generates QR code if payNowUrl is set).
      const blob = await getInvoicePDFBlob({ job, biz: bizWithStripe, invoiceNumber, dueDate, payNowUrl });
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
        await downloadInvoicePDF({ job, biz: bizWithStripe, invoiceNumber, dueDate, payNowUrl });
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

  const handleDownloadPDF = async () => {
    logTelemetry('invoice_send', { channel: 'download' });
    if (!attemptSend()) return;
    try {
      // downloadInvoicePDF is now async (QR code generation).
      await downloadInvoicePDF({ job, biz: bizWithStripe, invoiceNumber, dueDate, payNowUrl });
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
          {checkoutError && (
            <p className="modal-sheet-error" role="alert">{checkoutError}</p>
          )}
          <button
            type="button"
            className="btn-primary modal-sheet-btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setCheckoutError(null);
              const { error } = await startCheckout();
              if (error) {
                setCheckoutError(error);
                setBusy(false);
              }
              // On success startCheckout redirects — nothing else runs
            }}
          >
            {busy ? 'Loading…' : 'Get Pro'}
          </button>
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

        {/* Pay-now connect prompt (Section 1.3 a) — shown when not connected and
            the trader hasn't dismissed it for this invoice session yet */}
        {!isConnected && !connectBannerDismissed && !isUnpriced && (
          <div className="invoice-connect-prompt" role="note">
            <div className="invoice-connect-prompt__body">
              <strong>Add a Pay-now button?</strong> Your customer can pay by card straight
              from the invoice. Takes 5 min.
            </div>
            <div className="invoice-connect-prompt__actions">
              {onNavigateToCardPayments && (
                <button
                  type="button"
                  className="invoice-connect-prompt__setup"
                  onClick={() => { onClose(); onNavigateToCardPayments(); }}
                >
                  Set up
                </button>
              )}
              <button
                type="button"
                className="invoice-connect-prompt__dismiss"
                onClick={() => setConnectBannerDismissed(true)}
              >
                Not now
              </button>
            </div>
          </div>
        )}

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

        {/* £0 guard — blocking banner when the job has no price */}
        {isUnpriced && (
          <div className="invoice-no-price-banner" role="alert">
            <span>This job has no price yet — add one before sending.</span>
            {onNeedsPrice && (
              <button
                type="button"
                className="invoice-no-price-add-btn"
                onClick={onNeedsPrice}
              >
                Add price
              </button>
            )}
          </div>
        )}

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

        {/* Invoice document preview toggle — lets the founder see the branded
            document before sending. Collapsed by default to keep the CTA front
            and centre on mobile (one-hand kerb use case). */}
        <button
          type="button"
          className="invoice-preview-toggle"
          onClick={() => setShowPreview(v => !v)}
          aria-expanded={showPreview}
        >
          {showPreview ? 'Hide preview' : 'Preview invoice document'}
        </button>

        {showPreview && (
          <InvoiceDocumentPreview
            job={job}
            biz={bizWithStripe}
            profile={profile}
            invoiceNumber={invoiceNumber}
            dueDate={dueDate}
            payNowUrl={payNowUrl}
          />
        )}

        {/* Pay-now link loading hint — shown only while the dynamic Stripe link
            is being generated AND there is no static fallback link available.
            When a static stripe_payment_link is already set, we allow immediate
            send (the fallback link is included) and skip the wait-spinner. */}
        {isConnected && payNowLoading && !effectivePaymentLink && (
          <div className="invoice-paynow-loading" role="status" aria-live="polite">
            Generating Pay-now link…
          </div>
        )}

        {/* Primary CTA — WhatsApp deep-link (fast, no PDF overhead).
            Label changes when connected + Pay-now URL is ready (per brief 1.4).
            Only blocked while loading if there is no static fallback payment link —
            if a fallback exists the message is already complete and the trader can
            send immediately without waiting for the dynamic link. */}
        <button
          type="button"
          className="btn-primary modal-sheet-btn invoice-send-whatsapp"
          onClick={handleWhatsApp}
          disabled={isUnpriced || (isConnected && payNowLoading && !effectivePaymentLink)}
          aria-disabled={isUnpriced}
        >
          {isConnected && payNowUrl
            ? '💬 Send invoice with Pay-now'
            : '💬 Send via WhatsApp'}
        </button>

        {/* More ways to send — secondary options, always visible */}
        <div className="invoice-secondary-actions">
          <div className="invoice-more-ways-label">More ways to send</div>
          <button
            type="button"
            className="btn-secondary modal-sheet-btn"
            onClick={handleSharePDF}
            disabled={busy || isUnpriced}
          >
            {busy ? 'Preparing PDF…' : 'Send with PDF (share sheet)'}
          </button>
          <button
            type="button"
            className="btn-ghost modal-sheet-btn"
            onClick={handleDownloadPDF}
            disabled={isUnpriced}
          >
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}
