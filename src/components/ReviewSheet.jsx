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
import QRCode from 'qrcode';
import { downloadInvoicePDF, getInvoicePDFBlob } from '../lib/invoicePDF';
import { downloadQuotePDF, getQuotePDFBlob } from '../lib/invoicePDF';
import { buildInvoiceWhatsAppMessage, buildWhatsAppLink } from '../lib/invoiceMessage';
import { buildQuoteWhatsAppMessage } from '../lib/quoteMessage';
import { nextInvoiceNumber } from '../lib/invoiceNumber';
import {
  generatePublicAccessToken,
  buildPublicQuoteUrl,
} from '../lib/publicQuoteToken';
import { persistPublicToken } from '../lib/store';
import { extractJobMeta, writeJobMeta } from '../lib/jobMeta';
import { logTelemetry } from '../lib/telemetry';
import { isPro } from '../lib/plan';
import { canShareFile } from '../lib/webShare';
import { stagePatch } from '../lib/jobStatus';

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

// ── DepositPickerRow — per-quote deposit control (Pro + Stripe-connected only) ──
//
// Shown in the quote-send sheet above the WhatsApp button.
// Pre-filled from profile.default_deposit_percent.
// Writes deposit_percent + LOCKED deposit_amount_pence onto the job at send time.
// Free users see "Get deposits with Pro", not the picker.
// Hidden entirely when no Stripe Connect account is present.
//
// Uses the same 0/25/50/Custom button pattern as DefaultDepositRow in Settings.

const DEPOSIT_PRESETS = [
  { label: '0%',  value: 0 },
  { label: '25%', value: 25 },
  { label: '50%', value: 50 },
];

function DepositPickerRow({ profile, jobTotal, depositPercent, onDepositChange }) {
  const isConnected = profile?.stripe_connect_status === 'connected' && !!profile?.stripe_user_id;
  const isProUser   = isPro(profile);

  // Not connected to Stripe — hide the row entirely (customer can't pay anyway)
  if (!isConnected) return null;

  // Free user — show upsell nudge, not the picker
  if (!isProUser) {
    return (
      <div className="rs-deposit-upsell">
        Get deposits on acceptance with Pro
      </div>
    );
  }

  const isPreset = DEPOSIT_PRESETS.some(p => p.value === depositPercent);
  const [showCustom, setShowCustom] = useState(!isPreset && depositPercent > 0);
  const [customValue, setCustomValue] = useState(!isPreset && depositPercent > 0 ? String(depositPercent) : '');

  // Live preview: "= £X of £Y"
  const depositGbp = depositPercent > 0 && jobTotal > 0
    ? gbp(Math.round(jobTotal * (depositPercent / 100) * 100) / 100)
    : null;

  const handlePreset = (value) => {
    setShowCustom(false);
    setCustomValue('');
    onDepositChange(value);
  };

  const handleCustomBlur = () => {
    const n = Math.max(0, Math.min(100, parseInt(customValue, 10) || 0));
    onDepositChange(n);
  };

  return (
    <div className="rs-deposit-row">
      <div className="rs-deposit-row-label">
        Deposit on acceptance
        {depositGbp && <span className="rs-deposit-preview"> = {depositGbp} of {gbp(jobTotal)}</span>}
      </div>
      <div className="rs-deposit-picker" role="group" aria-label="Deposit percentage">
        {DEPOSIT_PRESETS.map(({ label, value }) => (
          <button
            key={value}
            type="button"
            className={`rs-deposit-btn${depositPercent === value && !showCustom ? ' rs-deposit-btn--active' : ''}`}
            onClick={() => handlePreset(value)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={`rs-deposit-btn${showCustom ? ' rs-deposit-btn--active' : ''}`}
          onClick={() => {
            setShowCustom(true);
            if (!customValue) setCustomValue(String(depositPercent || ''));
          }}
        >
          Custom
        </button>
      </div>
      {showCustom && (
        <div className="rs-deposit-custom-row">
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            className="rs-deposit-custom-input"
            value={customValue}
            onChange={e => setCustomValue(e.target.value)}
            onBlur={handleCustomBlur}
            aria-label="Custom deposit percentage"
            placeholder="e.g. 30"
          />
          <span className="rs-deposit-custom-suffix">%</span>
        </div>
      )}
    </div>
  );
}

export default function ReviewSheet({
  mode,
  job,
  biz,
  jobs,
  profile,
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

  // Per-quote deposit percent — pre-filled from the profile default or the job's
  // existing value (in case the sheet is opened on a job that already has one set).
  // Only active in quote mode.
  const [depositPercent, setDepositPercent] = useState(() => {
    if (isInvoice) return 0;
    // Job already has a deposit set — respect it
    if (typeof job.deposit_percent === 'number') return job.deposit_percent;
    // Fall back to the profile default (0 if unset)
    return Number(profile?.default_deposit_percent ?? 0);
  });

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
  // Decision tree:
  //   1. Generate PDF blob first (needed for file-share paths).
  //   2. canShareFile(file) + has phone  → navigator.share({ files, text }) + wa.me deep-link in text
  //   3. canShareFile(file), no phone    → navigator.share({ files, text }) only (user picks recipient)
  //   4. No Web Share Level 2            → wa.me text-only + auto-trigger PDF download as manual fallback
  //   5. AbortError (sheet dismissed)    → don't close, don't flash error
  const handleInvoiceWhatsApp = async () => {
    setBusy(true);
    const message = buildInvoiceWhatsAppMessage({ job, biz, invoiceNumber, dueDate });
    const phone = resolvePhone(job);
    const link = buildWhatsAppLink({ phone, message });

    let shareMethod = 'wame_fallback';
    try {
      const blob = await getInvoicePDFBlob({ job, biz, profile, invoiceNumber, dueDate, hidePoweredBy: isProUser });
      const file = new File([blob], `invoice-${invoiceNumber}.pdf`, { type: 'application/pdf' });

      if (canShareFile(file)) {
        shareMethod = 'web_share_files';
        const shareData = phone
          ? { files: [file], text: message + '\n' + link, title: `Invoice ${invoiceNumber}` }
          : { files: [file], text: message, title: `Invoice ${invoiceNumber}` };
        await navigator.share(shareData);
      } else {
        // Web Share Level 2 not available — open wa.me + give the user the PDF to attach manually
        shareMethod = 'wame_fallback';
        window.open(link, '_blank', 'noopener');
        await downloadInvoicePDF({ job, biz, profile, invoiceNumber, dueDate, hidePoweredBy: isProUser });
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        // User dismissed the share sheet — not an error, don't close
        setBusy(false);
        return;
      }
      // PDF generation failed — fall back to text-only wa.me so the user can still send
      shareMethod = 'wame_fallback';
      window.open(link, '_blank', 'noopener');
      flash?.('PDF failed — invoice sent as text');
    }

    logTelemetry('invoice_send', { channel: 'whatsapp', source: 'review_sheet', share_method: shareMethod });
    onUpdate?.({
      ...job,
      status: 'invoice_sent',
      invoiceSentAt: new Date().toISOString(),
      invoiceNumber,
      invoiceDueDate: new Date(dueDate).toISOString(),
      invoiceDraft: false,
    });
    flash?.('Invoice sent');
    setBusy(false);
    onClose?.();
  };

  // ── Invoice: PDF download ──────────────────────────────────────────────────
  // downloadInvoicePDF is now async (QR code generation when payNowUrl is set).
  // ReviewSheet doesn't have a payNowUrl — omitting it renders the PDF as before.
  const handleInvoiceDownloadPDF = async () => {
    logTelemetry('invoice_send', { channel: 'download', source: 'review_sheet' });
    try {
      await downloadInvoicePDF({ job, biz, profile, invoiceNumber, dueDate, hidePoweredBy: isProUser });
      flash?.('Saved to Files. Share it however you like.');
    } catch {
      flash?.('PDF failed — check Settings for business details');
    }
  };

  // ── Quote: WhatsApp send ───────────────────────────────────────────────────
  // Decision tree:
  //   1. Mint/reuse publicAccessToken and AWAIT its write to the cloud BEFORE
  //      generating the PDF or share link — this is the fix for the "Quote not
  //      found" bug. The URL is embedded in both the QR code and the PDF; if the
  //      customer opens the link before the cloud write completes (even 200ms),
  //      fetchPublicJob returns null → "Quote not found."
  //   2. If the cloud write fails offline → warn the trader and abort the send.
  //   3. canShareFile(file) + has phone  → navigator.share({ files, text })
  //   4. canShareFile(file), no phone    → navigator.share({ files, text }) only
  //   5. No Web Share Level 2 + phone    → wa.me text-only + auto-trigger PDF download
  //   6. No Web Share Level 2, no phone  → clipboard copy of quote URL
  //   7. AbortError                      → don't close, don't flash error
  const handleQuoteWhatsApp = async () => {
    setBusy(true);
    let token = job.publicAccessToken;
    if (!token) {
      token = generatePublicAccessToken();
    }

    // ── Step 1: persist the token to cloud BEFORE producing the shareable URL ──
    // Build the full meta snapshot that includes the new token and stage fields so
    // the single cloud write captures everything in one round-trip.
    const isLead = job.status === 'lead' || !job.status;
    const jobTotal = Number(job.total ?? job.amount ?? 0);
    const lockedDepositPence = depositPercent > 0 && jobTotal > 0
      ? Math.round(jobTotal * (depositPercent / 100) * 100)
      : 0;
    const updatedJob = {
      ...job,
      ...(isLead ? stagePatch('Quoted') : {}),
      quoteStatus: 'sent',
      quoteSentAt: new Date().toISOString(),
      publicAccessToken: token,
      quoteDraft: false,
      deposit_percent:       depositPercent > 0 ? depositPercent : 0,
      deposit_amount_pence:  lockedDepositPence > 0 ? lockedDepositPence : null,
    };
    // Write to localStorage first (synchronous, always succeeds).
    const mergedMeta = writeJobMeta(updatedJob.id, extractJobMeta(updatedJob));

    // Await the cloud write. If we're offline the token can't reach Supabase, so
    // the sign link will be dead — surface this clearly rather than producing a
    // silently broken link.
    const persistResult = await persistPublicToken(updatedJob.id, mergedMeta);
    if (!persistResult.ok) {
      if (persistResult.offline) {
        flash?.('No connection — quote link won\'t work until you\'re back online. Try again when connected.');
      } else {
        flash?.('Could not save quote link — try again');
      }
      setBusy(false);
      return;
    }

    // Token is now committed to the cloud. The URL is safe to share.
    const quoteUrl = buildPublicQuoteUrl(token);
    const phone = resolvePhone(job);
    const message = buildQuoteWhatsAppMessage({ job: updatedJob, biz, quoteUrl });
    const link = buildWhatsAppLink({ phone: phone || '', message });

    // Pre-generate QR for embedding in the PDF.
    // Mirrors the invoice pay-now flow's QRCode.toDataURL pattern.
    // Best-effort: if QR generation fails, the PDF still renders with just the
    // clickable button (qrDataUrl falsy in drawSignQuoteRow).
    let qrDataUrl = '';
    try {
      qrDataUrl = await QRCode.toDataURL(quoteUrl, {
        width: 220,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
    } catch {
      // QR generation failed — proceed without it
    }

    let shareMethod = 'wame_fallback';
    try {
      const blob = getQuotePDFBlob({ job: updatedJob, biz, profile, quoteUrl, qrDataUrl });
      const customer = (job?.customer || 'quote').replace(/\s/g, '-');
      const file = new File([blob], `quote-${customer}.pdf`, { type: 'application/pdf' });

      if (canShareFile(file)) {
        shareMethod = 'web_share_files';
        const shareData = phone
          ? { files: [file], text: message + '\n' + link, title: 'Your quote' }
          : { files: [file], text: message, title: 'Your quote' };
        await navigator.share(shareData);
      } else if (phone) {
        shareMethod = 'wame_fallback';
        window.open(link, '_blank', 'noopener');
        downloadQuotePDF({ job: updatedJob, biz, profile, quoteUrl, qrDataUrl, hidePoweredBy: isProUser });
      } else {
        // No file share, no phone — copy the quote URL so the user can paste it
        shareMethod = 'web_share_text';
        try {
          await navigator.clipboard.writeText(quoteUrl);
          flash?.('Link copied — paste it in WhatsApp');
        } catch {
          flash?.('Share this URL: ' + quoteUrl);
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        // User dismissed the share sheet. The token was already persisted so it's
        // safe to call onUpdate and close — the link exists in the cloud.
        onUpdate?.(updatedJob);
        flash?.('Quote saved — tap Send to share when ready');
        setBusy(false);
        onClose?.();
        return;
      }
      // PDF generation failed — fall back to text-only wa.me
      shareMethod = 'wame_fallback';
      if (phone) {
        window.open(link, '_blank', 'noopener');
      } else {
        flash?.('Could not share — try copying the link');
        setBusy(false);
        return;
      }
    }

    logTelemetry('quote_send', { channel: 'whatsapp', source: 'review_sheet', share_method: shareMethod });
    // The cloud write already happened above. onUpdate here updates React state
    // (in-memory jobs list) — it will call writeJobMeta+syncMetaToCloud again but
    // that is idempotent (same meta object, no-op cloud write).
    onUpdate?.(updatedJob);
    flash?.('Quote sent');
    setBusy(false);
    onClose?.();
  };

  // ── Quote: PDF download ────────────────────────────────────────────────────
  // Passes quoteUrl only when a token is already present on the job (i.e. the
  // quote was previously sent and the sign-link exists). For unsent drafts the
  // token hasn't been minted yet, so quoteUrl = '' and the sign block is skipped.
  const handleQuoteDownloadPDF = async () => {
    logTelemetry('quote_send', { channel: 'download', source: 'review_sheet' });
    try {
      const existingToken = job.publicAccessToken || '';
      const downloadQuoteUrl = existingToken ? buildPublicQuoteUrl(existingToken) : '';
      let downloadQrDataUrl = '';
      if (downloadQuoteUrl) {
        try {
          downloadQrDataUrl = await QRCode.toDataURL(downloadQuoteUrl, {
            width: 220,
            margin: 1,
            errorCorrectionLevel: 'M',
          });
        } catch {
          // QR generation failed — proceed without it
        }
      }
      downloadQuotePDF({ job, biz, profile, quoteUrl: downloadQuoteUrl, qrDataUrl: downloadQrDataUrl, hidePoweredBy: isProUser });
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

        {/* Deposit picker — quote mode only, Pro + Stripe-connected traders */}
        {!isInvoice && (
          <DepositPickerRow
            profile={profile}
            jobTotal={Number(job.total ?? job.amount ?? 0)}
            depositPercent={depositPercent}
            onDepositChange={setDepositPercent}
          />
        )}

        {/* Primary CTA — green WhatsApp button */}
        <button
          type="button"
          className="btn-primary modal-sheet-btn rs-send-btn"
          onClick={primaryAction}
          disabled={busy}
        >
          {busy ? 'Preparing…' : primaryLabel}
        </button>

        {/* Auto-chase chip — invoice mode only.
            Shows real state: on for pro/trial with auto_chase_enabled,
            a Pro upsell for free users, hidden when explicitly off. */}
        {isInvoice && (() => {
          const proUser = isPro(profile);
          const autoOn  = profile?.auto_chase_enabled !== false;

          if (proUser && autoOn) {
            return (
              <div className="rs-autochase-chip rs-autochase-chip--on" aria-label="Auto-chase is on">
                Auto-chase: on
              </div>
            );
          }

          if (proUser && !autoOn) {
            // Explicitly turned off — show nothing (user made the choice)
            return null;
          }

          // Free user — show a Pro upsell instead of a false "on" claim
          return (
            <div className="rs-autochase-chip rs-autochase-chip--upsell" aria-label="Auto-chase requires Pro">
              Auto-chase · Pro
            </div>
          );
        })()}

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
