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
 *   onUpdate(job) – persists job update (invoiceSentAt, quoteSentAt, draft flags,
 *                   AND every inline edit made in DocumentPreview — see localJob below)
 *   onEdit()      – optional; renders the "Edit quote/invoice" ghost button, which
 *                   still closes this sheet and opens the full job-edit screen (an
 *                   explicit, distinctly-labelled escape hatch). Inline field/line-item
 *                   taps inside DocumentPreview no longer route through this — they
 *                   open a small overlay editor over the still-open sheet instead
 *                   (see DocumentPreview.jsx's onJobPatch/onInvoiceNumberChange/onDueDateChange).
 *   flash(msg)    – toast callback
 */

import { useState, useCallback } from 'react';
import Icon from './Icon';
import QRCode from 'qrcode';
import BankGateSheet from './BankGateSheet';
import DocumentPreview from './DocumentPreview';
import { downloadInvoicePDF, getInvoicePDFBlob } from '../lib/invoicePDF';
import { downloadQuotePDF } from '../lib/invoicePDF';
import { buildInvoiceWhatsAppMessage, buildWhatsAppLink } from '../lib/invoiceMessage';
import { nextInvoiceNumber } from '../lib/invoiceNumber';
import {
  buildPublicQuoteUrl,
} from '../lib/publicQuoteToken';
import { logTelemetry } from '../lib/telemetry';
import { getJobProfit } from '../lib/cashflow';
import { isPro } from '../lib/plan';
import { canShareFile } from '../lib/webShare';
import { sendQuote } from '../lib/sendQuote';

// ── Helpers ────────────────────────────────────────────────────────────────────

function resolvePhone(job) {
  return job.customerPhone || job.phone || job.mobile || job.whatsapp || '';
}

function gbp(n) {
  return '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Component ──────────────────────────────────────────────────────────────────

// ── DepositPickerRow — per-quote deposit control ───────────────────────────────
//
// V1 (bank-transfer-deposits): renders for ALL traders in quote mode.
// - Pro + Stripe-connected: "Deposit on acceptance" — customer can pay by card
//   on the public quote page, with bank-transfer as the fallback sub-line.
// - Everyone else: "Deposit to secure the booking" — bank transfer only.
//   A single capped Pro tease appears as the sub-line.
//
// Pre-filled from profile.default_deposit_percent.
// Writes deposit_percent + LOCKED deposit_amount_pence onto the job at send time.
// Uses the same 0/25/50/Custom button pattern as DefaultDepositRow in Settings.

const DEPOSIT_PRESETS = [
  { label: '0%',  value: 0 },
  { label: '25%', value: 25 },
  { label: '50%', value: 50 },
];

function DepositPickerRow({ profile, jobTotal, depositPercent, onDepositChange }) {
  const isConnected = profile?.stripe_connect_status === 'connected' && !!profile?.stripe_user_id;
  const isProUser   = isPro(profile);
  const isOnlineDeposit = isProUser && isConnected;

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

  // Method-aware label and sub-line copy
  const rowLabel = isOnlineDeposit ? 'Deposit on acceptance' : 'Deposit to secure the booking';
  const subLine = isOnlineDeposit
    ? 'Customer can tap to pay by card, or transfer it.'
    : "Customer pays this by bank transfer. You'll mark it received when it lands.";
  const proTease = !isOnlineDeposit && depositPercent > 0
    ? 'Customers transfer the deposit to you. Want tap-and-pay by card on acceptance? That\'s Pro.'
    : null;

  return (
    <div className="rs-deposit-row">
      <div className="rs-deposit-row-label">
        {rowLabel}
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
      {depositPercent > 0 && (
        <div className="rs-deposit-subline">{subLine}</div>
      )}
      {proTease && (
        <div className="rs-deposit-pro-tease">{proTease}</div>
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
  receipts = [],
  onClose,
  onDismiss,
  onUpdate,
  onEdit,
  flash,
  onProfileUpdate,
}) {
  const isInvoice = mode === 'invoice';

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

  // localJob: optimistically updated the moment an inline edit is made inside
  // DocumentPreview (line items/total, customer, phone, address) — mirrors the
  // localProfile pattern below. Every doc-generation path (WhatsApp send, PDF
  // download, deposit calc) reads localJob, not the raw `job` prop, so an edit
  // made THIS session is reflected in what's actually sent, not just the next
  // time the sheet opens. Persists via the real onUpdate data layer immediately
  // — this is not a "review-only" draft, it's the same save path as any other
  // job edit, just surfaced inline instead of via a screen jump.
  const [localJob, setLocalJob] = useState(job);

  // Central patch handler for DocumentPreview's inline job-content editors.
  const handleJobPatch = useCallback((patch) => {
    setLocalJob(prev => {
      const next = { ...prev, ...patch };
      onUpdate?.(next);
      return next;
    });
  }, [onUpdate]);

  const handleInvoiceNumberChange = useCallback((value) => {
    setInvoiceNumber(value);
    onUpdate?.({ ...localJob, invoiceNumber: value });
  }, [onUpdate, localJob]);

  const handleDueDateChange = useCallback((value) => {
    setDueDate(value);
    onUpdate?.({ ...localJob, invoiceDueDate: new Date(value).toISOString() });
  }, [onUpdate, localJob]);

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

  // localProfile: optimistically updated when the trader saves bank details via
  // the bank-gate, or a brand edit (logo/name/contact) via the DocumentPreview
  // tappable regions, inside this sheet. Mirrors the pattern from SendInvoiceModal.
  // All doc-generation paths below read localProfile (not the raw `profile` prop)
  // so a mid-session edit is reflected in THIS document too, not just future ones.
  const [localProfile, setLocalProfile] = useState(profile);
  const isProUser = isPro(localProfile);

  // Bank-gate view: 'main' | 'bank-gate'
  const [sheetView, setSheetView] = useState('main');

  const jobName = localJob?.summary || localJob?.customer || localJob?.name || 'Job';
  const sheetTitle = isInvoice
    ? `Review invoice · ${jobName}`
    : `Review quote · ${jobName}`;

  // Dismiss = close + save draft. Uses localJob so an inline edit made before
  // dismissing (without sending) is still persisted in the draft patch.
  const handleDismiss = useCallback(() => {
    const draftPatch = isInvoice
      ? { ...localJob, invoiceDraft: true }
      : { ...localJob, quoteDraft: true };
    onUpdate?.(draftPatch);
    flash?.('Draft saved. Send when you\'re ready.');
    onDismiss?.();
  }, [isInvoice, localJob, onUpdate, flash, onDismiss]);

  // ── Invoice: WhatsApp send ─────────────────────────────────────────────────
  // Decision tree:
  //   1. Generate PDF blob first (needed for file-share paths).
  //   2. canShareFile(file) + has phone  → navigator.share({ files, text }) + wa.me deep-link in text
  //   3. canShareFile(file), no phone    → navigator.share({ files, text }) only (user picks recipient)
  //   4. No Web Share Level 2            → wa.me text-only + auto-trigger PDF download as manual fallback
  //   5. AbortError (sheet dismissed)    → don't close, don't flash error
  // All job data below reads localJob (not the raw `job` prop) so an inline
  // edit made this session — a line-item change, an added customer — is
  // reflected in the invoice actually sent, not just the next time this sheet
  // opens. Nothing about the send DECISION TREE below changed.
  const handleInvoiceWhatsApp = async () => {
    setBusy(true);
    const message = buildInvoiceWhatsAppMessage({ job: localJob, biz, invoiceNumber, dueDate });
    const phone = resolvePhone(localJob);
    const link = buildWhatsAppLink({ phone, message });

    let shareMethod = 'wame_fallback';
    try {
      const blob = await getInvoicePDFBlob({ job: localJob, biz, profile: localProfile, invoiceNumber, dueDate, hidePoweredBy: isProUser });
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
        await downloadInvoicePDF({ job: localJob, biz, profile: localProfile, invoiceNumber, dueDate, hidePoweredBy: isProUser });
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
    const _inv1 = getJobProfit(localJob, receipts);
    logTelemetry('invoice_sent', { headline_price: _inv1.quote, job_costs: _inv1.materials, true_profit: _inv1.profit, channel: 'whatsapp' });
    onUpdate?.({
      ...localJob,
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
    const _inv2 = getJobProfit(localJob, receipts);
    logTelemetry('invoice_sent', { headline_price: _inv2.quote, job_costs: _inv2.materials, true_profit: _inv2.profit, channel: 'download' });
    try {
      await downloadInvoicePDF({ job: localJob, biz, profile: localProfile, invoiceNumber, dueDate, hidePoweredBy: isProUser });
      flash?.('Saved to Files. Share it however you like.');
    } catch {
      flash?.('PDF failed — check Settings for business details');
    }
  };

  // ── Quote: WhatsApp send ───────────────────────────────────────────────────
  // Thin wrapper around the shared sendQuote() helper (src/lib/sendQuote.js) —
  // the voice-quote confirm card (AddJobModal) calls the exact same function
  // directly, without hopping through this sheet. See sendQuote.js for the
  // full decision tree (bank-gate, token persist, PDF+QR, share fallbacks).
  const handleQuoteWhatsApp = async () => {
    const result = await sendQuote(localJob, {
      biz,
      profile: localProfile,
      depositPercent,
      receipts,
      onUpdate,
      flash,
      onClose,
      setBusy,
    });
    if (result?.reason === 'bank-gate') {
      setSheetView('bank-gate');
    }
  };

  // ── Quote: PDF download ────────────────────────────────────────────────────
  // Passes quoteUrl only when a token is already present on the job (i.e. the
  // quote was previously sent and the sign-link exists). For unsent drafts the
  // token hasn't been minted yet, so quoteUrl = '' and the sign block is skipped.
  const handleQuoteDownloadPDF = async () => {
    logTelemetry('quote_send', { channel: 'download', source: 'review_sheet' });
    const _q2 = getJobProfit(localJob, receipts);
    logTelemetry('quote_sent', { headline_price: _q2.quote, job_costs: _q2.materials, true_profit: _q2.profit, channel: 'download' });
    try {
      const existingToken = localJob.publicAccessToken || '';
      const downloadQuoteUrl = existingToken ? buildPublicQuoteUrl(existingToken) : '';
      let downloadQrDataUrl = '';
      if (downloadQuoteUrl) {
        try {
          downloadQrDataUrl = await QRCode.toDataURL(downloadQuoteUrl, {
            width: 128,
            margin: 1,
            errorCorrectionLevel: 'M',
          });
        } catch {
          // QR generation failed — proceed without it
        }
      }
      await downloadQuotePDF({ job: localJob, biz, profile: localProfile, quoteUrl: downloadQuoteUrl, qrDataUrl: downloadQrDataUrl, hidePoweredBy: isProUser });
      flash?.('Saved to Files. Share it however you like.');
    } catch {
      flash?.('PDF failed — check Settings for business details');
    }
  };

  const primaryAction = isInvoice ? handleInvoiceWhatsApp : handleQuoteWhatsApp;
  const primaryLabel = isInvoice ? 'Send invoice via WhatsApp' : 'Send via WhatsApp';
  const handleDownloadPDF = isInvoice ? handleInvoiceDownloadPDF : handleQuoteDownloadPDF;

  // ── Bank-gate view ─────────────────────────────────────────────────────────
  if (sheetView === 'bank-gate') {
    return (
      <BankGateSheet
        onClose={onClose}
        onProfileUpdate={onProfileUpdate}
        onSaved={(patch) => {
          setLocalProfile(prev => ({ ...(prev || {}), ...patch }));
          setSheetView('main');
        }}
        onSkip={() => {
          // Send without deposit — zero out the percent and proceed
          setDepositPercent(0);
          setSheetView('main');
          flash?.('Sending without a deposit');
        }}
      />
    );
  }

  return (
    <div
      className="modal-backdrop modal-backdrop--top"
      onClick={e => { if (e.target === e.currentTarget) handleDismiss(); }}
    >
      {/* stopPropagation here is the P0 dismiss-jank fix (founder live-test,
          2026-07): every tap inside the sheet — including a tap on a document
          region that isn't wired to anything — must never reach the backdrop's
          onClick and dismiss the sheet / fall through to the screen behind it.
          Only the X button and a genuine backdrop tap (outside this div) close it. */}
      <div
        className="modal-sheet rs-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={sheetTitle}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-sheet-header">
          <h3 className="modal-sheet-title rs-title">{sheetTitle}</h3>
          <button
            className="modal-sheet-close"
            onClick={handleDismiss}
            aria-label="Close"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Document preview — tappable facsimile ("Preview & Edit" full-tap
            slice, built on slice 1). job={localJob} + onJobPatch so every
            inline edit (line items, customer, phone/address) is reflected here
            AND in the doc this sheet is about to send. profile={localProfile}
            so a brand edit made mid-session (logo / business name / contact)
            shows here AND in the doc too — see the localProfile note above. */}
        <DocumentPreview
          mode={mode}
          job={localJob}
          biz={biz}
          profile={localProfile}
          depositPercent={depositPercent}
          invoiceNumber={invoiceNumber}
          dueDate={dueDate}
          onJobPatch={onUpdate ? handleJobPatch : undefined}
          onInvoiceNumberChange={handleInvoiceNumberChange}
          onDueDateChange={handleDueDateChange}
          onProfileUpdate={onProfileUpdate}
          onProfileSaved={(patch) => setLocalProfile(prev => ({ ...(prev || {}), ...patch }))}
          flash={flash}
        />

        {/* Deposit picker — quote mode only, available to all traders */}
        {!isInvoice && (
          <DepositPickerRow
            profile={localProfile}
            jobTotal={Number(localJob.total ?? localJob.amount ?? 0)}
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
          const proUser = isPro(localProfile);
          const autoOn  = localProfile?.auto_chase_enabled !== false;

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
          {onEdit && (
            <button
              type="button"
              className="btn-ghost rs-peer-btn"
              onClick={onEdit}
              aria-label={isInvoice ? 'Edit invoice' : 'Edit quote'}
            >
              {isInvoice ? 'Edit invoice' : 'Edit quote'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
