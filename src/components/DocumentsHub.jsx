/**
 * DocumentsHub — tabbed modal sheet that replaces the Design 1 Quotes/Invoices
 * accordions in JobDetailDrawer.
 *
 * Design 2, 2026-06. PRD spec implemented by ENG (Alaister / al-jobprofit).
 *
 * View-first document preview (2026-07): tapping "View … PDF" no longer
 * downloads a file straight away — it opens the branded DocumentPreview
 * (read-only; the same facsimile ReviewSheet uses before a send) inside this
 * sheet, with a Back control to return to the timeline. PDF generation is
 * deferred until the trader actually taps Save/Share in the action tray under
 * the preview — the preview itself renders instantly with no PDF wait. Save,
 * Share and Copy link are PERSONAL actions (view/keep a copy) — unlike
 * ReviewSheet/SendInvoiceModal's send paths, none of them set
 * quoteSentAt/invoiceSentAt or otherwise mutate the job's send-state; the only
 * job write is persisting publicAccessToken (idempotent — see persistToken
 * below) so the embedded quote link/QR and the Copy-link URL resolve.
 *
 * Architecture notes:
 *  - ALL hooks are declared before any early return (R1 — see PR #125 trap).
 *  - GatedSignature is a sub-component defined in this file; its hooks also
 *    live above its own early returns.
 *  - fmtDate / fmtDateTime are local helpers (keeps this module self-contained
 *    and unit-testable without DOM imports).
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { buildQuoteRecordMeta, buildInvoiceRecordMeta } from '../lib/documentRecord';
import {
  downloadQuotePDF,
  downloadInvoicePDF,
  getQuotePDFBlob,
  getInvoicePDFBlob,
} from '../lib/invoicePDF';
import { isPro } from '../lib/plan';
import { formatPartPaidLabel } from '../lib/partPaidChip';
import { buildPublicQuoteUrl } from '../lib/publicQuoteToken';
import { buildPublicInvoiceUrl } from '../lib/publicInvoiceToken';
import { reissuePublicToken } from '../lib/store';
import { canShareFile } from '../lib/webShare';
import { logTelemetry } from '../lib/telemetry';
import DocumentPreview from './DocumentPreview';
import Icon from './Icon';

// ─── Internal date formatter ──────────────────────────────────────────────────
// Mirrors fmtDate in JobDetailDrawer.jsx — en-GB, day numeric, month short, year.
function fmtDate(raw) {
  if (!raw) return '';
  try {
    const d = raw.length === 10 ? new Date(raw + 'T00:00:00') : new Date(raw);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return raw;
  }
}

// ─── Date + time formatter ────────────────────────────────────────────────────
// Returns e.g. "6 Jun, 4:12pm". Returns '' for missing/invalid input (never throws).
function fmtDateTime(raw) {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', {
      day:     'numeric',
      month:   'short',
      hour:    'numeric',
      minute:  '2-digit',
      hour12:  true,
    });
  } catch {
    return '';
  }
}

// ─── Overdue day count ────────────────────────────────────────────────────────
// Returns the number of calendar days past the due date (positive integer),
// or 0 if not yet overdue or due date absent.
function overdueDays(invoiceDueDate) {
  if (!invoiceDueDate) return 0;
  const due = new Date(invoiceDueDate + 'T00:00:00');
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueStart   = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diff = Math.round((todayStart - dueStart) / 86400000);
  return diff > 0 ? diff : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GatedSignature — shows audit text + optionally gates the signature image
// behind a reveal toggle. Hooks sit above the early return.
// ─────────────────────────────────────────────────────────────────────────────
function GatedSignature({ job }) {
  // R1: declare all hooks BEFORE any conditional return.
  const [sigShown, setSigShown] = useState(false);

  const isDeposit = job?.acceptedSource === 'deposit_payment';
  const hasSig    = !!job?.acceptedSignature;

  // Only render when the quote is in signed state (acceptedAt present)
  if (!job?.acceptedAt) return null;

  const name    = job.acceptedName || 'customer';
  const dateStr = fmtDate(job.acceptedAt);

  let auditLine;
  if (job.acceptedSource === 'remote') {
    auditLine = `Signed remotely by ${name} · ${dateStr}`;
  } else if (job.acceptedSource === 'deposit_payment') {
    auditLine = `Accepted via deposit payment · ${dateStr}`;
  } else {
    auditLine = `Signed on screen by ${name} · ${dateStr}`;
  }

  // deposit_payment with no handwritten signature — show badge only, no gated control
  if (isDeposit && !hasSig) {
    return (
      <div className="docs-hub-audit-block">
        <div className="docs-sig-audit">{auditLine}</div>
        <div className="sig-accepted-card docs-hub-deposit-badge">
          <div className="sig-accepted-label">Accepted by card deposit</div>
          <div className="sig-accepted-source">
            Customer paid the deposit — quote accepted
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="docs-hub-audit-block">
      <div className="docs-sig-audit">{auditLine}</div>
      {hasSig && (
        <div className="docs-hub-sig-reveal">
          <p className="docs-hub-sig-hint">
            SIGNATURE — HIDDEN BY DEFAULT
          </p>
          <button
            type="button"
            className="docs-hub-sig-btn"
            onClick={() => setSigShown(s => !s)}
            aria-expanded={sigShown}
            aria-controls="docs-hub-sig-img"
          >
            {sigShown ? 'Hide signature' : '🔒 View signature'}
          </button>
          {sigShown && (
            <div id="docs-hub-sig-img" className="docs-hub-sig-img-wrap">
              <img
                src={job.acceptedSignature}
                alt="Customer signature"
                className="sig-accepted-img"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DocumentTimeline — vertical step timeline for one doc type.
// steps = [{ label, subLine, consentSuffix, date, reached, isOverdue, isDue, partPaidLabel }]
// ─────────────────────────────────────────────────────────────────────────────
function DocumentTimeline({ steps }) {
  return (
    <ol className="docs-timeline" aria-label="Document timeline">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <li key={step.label} className={`docs-step${step.reached ? ' docs-step--reached' : ''}`}>
            <div className="docs-step-track">
              <div className={`docs-step-dot${step.reached ? ' docs-step-dot--filled' : ''}`} />
              {!isLast && <div className={`docs-step-connector${step.reached ? ' docs-step-connector--filled' : ''}`} />}
            </div>
            <div className="docs-step-content">
              <span
                className="docs-step-label"
                style={step.isOverdue ? { color: 'var(--jp-rose)' } : step.isDue ? { color: 'var(--jp-amber)' } : undefined}
              >
                {step.isOverdue && step.overdueLabel ? step.overdueLabel : step.label}
              </span>
              {step.reached && step.subLine && (
                <span className="docs-step-date">
                  {step.subLine}{step.consentSuffix ? ' · consent given' : ''}
                </span>
              )}
              {step.partPaidLabel && (
                <span className="docs-step-part-paid">{step.partPaidLabel}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DocumentsHub — main exported component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   open: boolean,
 *   job: object,
 *   biz: object,
 *   profile: object | null,
 *   onClose: () => void,
 *   onBuildQuote: () => void,
 *   onSendInvoice: () => void,
 *   onUpdateJob?: (updatedJob: object) => void — persists job field updates.
 *     Required for Save/Share/Copy-link to persist a public token when one
 *     doesn't already exist. Omitting it degrades gracefully: the preview
 *     still opens and PDFs still generate, just without a live link/QR
 *     embedded (mirrors ReceiptModal's optional onUpdate).
 *   flash?: (msg: string) => void — toast callback.
 *   onProfileUpdate?: (patch: object) => Promise<void> — threaded straight
 *     into DocumentPreview so a mid-preview logo/business-name edit saves via
 *     the app's central profile pipeline (same as ReviewSheet); falls back to
 *     a direct Supabase write when omitted (DocumentPreview's own fallback).
 * }} props
 */
export default function DocumentsHub({
  open,
  job,
  biz,
  profile,
  onClose,
  onBuildQuote,
  onSendInvoice,
  onUpdateJob,
  flash,
  onProfileUpdate,
}) {
  // R1: ALL hooks above any early return.
  const [tab, setTab]             = useState('quotes');
  // previewOpen: toggles the sheet's body between the timeline/record card and
  // the DocumentPreview "screen" — see the view-first note above the imports.
  const [previewOpen, setPreviewOpen] = useState(false);
  // busy: disables the Save/Share tray buttons while a PDF is being generated
  // and handed to the OS share sheet / download — mirrors ReceiptModal's busy.
  const [busy, setBusy] = useState(false);

  // Early return AFTER hooks
  if (!open) return null;

  // ── Derived record metadata ───────────────────────────────────────────────
  const quoteRecord   = buildQuoteRecordMeta(job);
  const invoiceRecord = buildInvoiceRecordMeta(job);

  // ── Quote timeline steps ──────────────────────────────────────────────────
  const quoteIsNone = quoteRecord.state === 'none';

  const customerName = job?.customer || job?.name || 'customer';
  const acceptedName = job?.acceptedName || 'customer';

  // Signed step: actor-aware label based on acceptedSource
  let signedLabel = 'Signed';
  if (job?.acceptedAt || quoteRecord.state === 'signed' || quoteRecord.state === 'accepted') {
    if (job?.acceptedSource === 'remote') {
      signedLabel = `Signed remotely by ${acceptedName}`;
    } else if (job?.acceptedSource === 'deposit_payment') {
      signedLabel = 'Accepted via deposit payment';
    } else if (job?.acceptedSource) {
      signedLabel = `Signed on screen by ${acceptedName}`;
    }
  }

  const quoteSteps = [
    {
      label:   'Created',
      subLine: fmtDateTime(job?.createdAt),
      reached: quoteRecord.state !== 'none',
    },
    {
      label:   `Sent to ${customerName}`,
      subLine: fmtDateTime(job?.quoteSentAt),
      reached: !!job?.quoteSentAt,
    },
    {
      label:   'Opened by customer',
      subLine: fmtDateTime(job?.quoteLinkOpenedAt),
      reached: !!job?.quoteLinkOpenedAt,
    },
    {
      label:         signedLabel,
      subLine:       fmtDateTime(job?.acceptedAt),
      // Consent suffix only for remote signatures — remote signing hard-requires consent.
      // Channel (WhatsApp etc.) is NOT stored; omitting to avoid fabrication.
      consentSuffix: job?.acceptedSource === 'remote' && !!(job?.acceptedAt || quoteRecord.state === 'signed' || quoteRecord.state === 'accepted'),
      reached:       !!(job?.acceptedAt || quoteRecord.state === 'signed' || quoteRecord.state === 'accepted'),
    },
  ];

  // ── Invoice timeline steps ────────────────────────────────────────────────
  const invoiceIsNone = invoiceRecord.state === 'none';
  const daysOver      = overdueDays(job?.invoiceDueDate);
  const isOverdue     = invoiceRecord.state === 'overdue';
  const isDue         = invoiceRecord.state === 'due';
  const isPartPaid    = invoiceRecord.state === 'part-paid';
  const hasInvoiceContent = !!job?.invoiceSentAt;

  const invoiceSteps = [
    {
      label:   'Created',
      subLine: '',
      reached: hasInvoiceContent,
    },
    {
      label:   `Sent to ${customerName}`,
      subLine: fmtDateTime(job?.invoiceSentAt),
      reached: !!job?.invoiceSentAt,
    },
    {
      label:       isOverdue ? 'Overdue' : 'Due',
      subLine:     job?.invoiceDueDate ? fmtDate(job.invoiceDueDate) : '',
      reached:     !!(job?.invoiceDueDate && !!job?.invoiceSentAt),
      isOverdue,
      isDue,
      overdueLabel: isOverdue ? `Overdue · ${daysOver}d` : undefined,
      partPaidLabel: isPartPaid ? formatPartPaidLabel(job) : undefined,
    },
    {
      label:   'Paid',
      subLine: fmtDateTime(job?.paidAt),
      reached: !!(job?.paidAt || invoiceRecord.state === 'paid'),
    },
  ];

  // ── Derived labels ────────────────────────────────────────────────────────
  const invoiceDocLabel = job?.invoiceNumber ? `Invoice ${job.invoiceNumber}` : 'Invoice';
  const activeRecord    = tab === 'quotes' ? quoteRecord : invoiceRecord;
  const docIsNone       = tab === 'quotes' ? quoteIsNone : invoiceIsNone;
  const isSigned        = !!(job?.acceptedAt || quoteRecord.state === 'signed' || quoteRecord.state === 'accepted');
  const docType         = tab === 'quotes' ? 'quote' : 'invoice';

  // PDF button label: signed quote → "View signed PDF"; unsigned → "View quote PDF"; invoice → "View invoice PDF"
  const pdfBtnLabel = tab === 'quotes'
    ? (isSigned ? 'View signed PDF' : 'View quote PDF')
    : 'View invoice PDF';

  // ── Public token — Save/Share/Copy-link all need a live URL to embed/copy.
  // Mirrors ReceiptModal's persistToken() pattern exactly: reissuePublicToken
  // recomputes fresh each render (cheap — it only mints a new UUID when the
  // job has no token yet or the previous one was revoked; otherwise it hands
  // back the SAME existing job.publicAccessToken), and persistToken() writes
  // it via onUpdateJob only when needed. Because every action below reads
  // `token` from the SAME render pass it fires in, and onUpdateJob's result
  // flows back down as a fresh `job` prop before the trader's next tap, the
  // three actions never race each other into minting different tokens.
  const { token, wasRevoked: tokenWasRevoked } = reissuePublicToken(job);

  function persistToken() {
    if (onUpdateJob && (tokenWasRevoked || !job?.publicAccessToken)) {
      onUpdateJob({
        ...job,
        publicAccessToken: token,
        ...(tokenWasRevoked ? { publicTokenRevokedAt: undefined } : {}),
      });
    }
  }

  function docTitle() {
    return tab === 'quotes' ? 'Quote' : invoiceDocLabel;
  }

  function pdfFileName() {
    if (tab === 'quotes') {
      const customer = (job?.customer || 'quote').replace(/\s/g, '-');
      return `quote-${customer}.pdf`;
    }
    return `${job?.invoiceNumber || 'invoice'}.pdf`;
  }

  // Builds the args object each PDF helper expects. Quote mode embeds the
  // hosted quote link + QR (mirrors ReviewSheet.handleQuoteDownloadPDF exactly
  // — this is "blocker B", the link-less/QR-less PDF the founder flagged).
  // Invoice mode intentionally omits a link/QR: generateInvoicePDF only draws
  // a QR for a Stripe payNowUrl (Pay-now), which DocumentsHub does not own —
  // ReviewSheet's own invoice download omits it too ("ReviewSheet doesn't
  // have a payNowUrl — omitting it renders the PDF as before"). Wiring
  // Pay-now generation into DocumentsHub is a SendInvoiceModal-sized feature,
  // out of scope for this view-first preview slice.
  async function buildPdfArgs() {
    if (tab === 'quotes') {
      const quoteUrl = buildPublicQuoteUrl(token);
      let qrDataUrl = '';
      try {
        qrDataUrl = await QRCode.toDataURL(quoteUrl, {
          width: 128,
          margin: 1,
          errorCorrectionLevel: 'M',
        });
      } catch {
        // QR generation failed — proceed without it, same fallback ReviewSheet uses.
      }
      return { job, biz, profile, quoteUrl, qrDataUrl, hidePoweredBy: isPro(profile) };
    }
    return {
      job,
      biz,
      profile,
      invoiceNumber: job?.invoiceNumber,
      dueDate:       job?.invoiceDueDate,
      hidePoweredBy: isPro(profile),
    };
  }

  // Shared PDF → File → share-or-download core for Save and Share. Mirrors
  // the exact ReceiptModal/SendInvoiceModal pattern: getBlob → new File →
  // canShareFile → navigator.share, else fall back to the real PDF download
  // (never a naked <a download> — satisfies the iOS "route through the share
  // sheet naturally" requirement, since canShareFile is true on iOS Safari).
  async function generateAndDeliver({ withTitle }) {
    const args = await buildPdfArgs();
    const getBlob    = tab === 'quotes' ? getQuotePDFBlob    : getInvoicePDFBlob;
    const downloadFn = tab === 'quotes' ? downloadQuotePDF   : downloadInvoicePDF;
    const blob = await getBlob(args);
    const file = new File([blob], pdfFileName(), { type: 'application/pdf' });
    if (canShareFile(file)) {
      await navigator.share(withTitle ? { files: [file], title: docTitle() } : { files: [file] });
      return 'shared';
    }
    await downloadFn(args);
    return 'downloaded';
  }

  function handleOpenPreview() {
    setPreviewOpen(true);
    logTelemetry('document_preview_opened', { docType });
  }

  function handleClosePreview() {
    setPreviewOpen(false);
  }

  // Save PDF — primary tray CTA. No text/title on the share call so the OS
  // share sheet leads with Save-to-Files/Save-to-Photos style targets rather
  // than messaging apps (that's Share's job, below).
  async function handleSavePDF() {
    if (busy) return;
    setBusy(true);
    persistToken();
    logTelemetry(`${docType}_send`, { channel: 'save', source: 'docs_hub_preview' });
    try {
      await generateAndDeliver({ withTitle: false });
      flash?.(tab === 'quotes' ? 'Quote saved' : 'Invoice saved');
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('[DocumentsHub] Save PDF failed', err);
        flash?.('Could not save — try again');
      }
    } finally {
      setBusy(false);
    }
  }

  // Share — secondary tray action. Opens the OS share sheet with a title so
  // the file is identifiable in Notes/Files/WhatsApp etc.
  async function handleShare() {
    if (busy) return;
    setBusy(true);
    persistToken();
    logTelemetry(`${docType}_send`, { channel: 'share', source: 'docs_hub_preview' });
    try {
      const outcome = await generateAndDeliver({ withTitle: true });
      flash?.(outcome === 'shared'
        ? (tab === 'quotes' ? 'Quote shared' : 'Invoice shared')
        : 'Saved — share it from your Files app');
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('[DocumentsHub] Share PDF failed', err);
        flash?.('Could not share — try again');
      }
    } finally {
      setBusy(false);
    }
  }

  // Copy link — tertiary tray action. Persists the token first so the copied
  // URL always resolves, then copies via the clipboard API (mirrors
  // SettingsScreen's handleCopy "books link" pattern).
  async function handleCopyLink() {
    persistToken();
    const url = tab === 'quotes' ? buildPublicQuoteUrl(token) : buildPublicInvoiceUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      flash?.('Link copied');
      logTelemetry('document_preview_link_copied', { docType });
    } catch {
      flash?.('Could not copy — try again');
    }
  }

  // FIX 1: sheet is nested INSIDE the backdrop (not a sibling fragment).
  // The backdrop is position:fixed with display:flex — the sheet is its flex child.
  // Tap-outside (backdrop onClick) closes; stopPropagation on the sheet prevents
  // the backdrop click from firing when the user taps inside the sheet.
  //
  // FIX 2 (2026-07-13): portal to <body>. DocumentsHub renders as a sibling
  // inside JobDetailDrawer, deep inside the dashboard swipe-pager. The pager's
  // scroll container `.dp-viewport` is `position:fixed; z-index:0` (index.css
  // ~line 1153) — a ROOT stacking context that caps EVERY in-pager descendant at
  // z:0 relative to the root, so this sheet's z-index:500 (--z-modal-top) can
  // never actually beat the root-level .bottom-nav (--z-nav:100), which is a
  // sibling of the pager under #root. (A transient `transform` on the pager during
  // drag/settle, or the drawer's own slide-up transform, traps it the same way —
  // index.css ~line 1136 spells this out.) The trapped nav then paints over the
  // sheet's lower content ("Send invoice") and steals its taps (clicks land on the
  // nav / the content behind). Rendering into document.body lifts the sheet out of
  // every trapped ancestor, so its z-500 backdrop sits in the ROOT stacking context
  // above the nav and captures all outside taps. This also makes the fix independent
  // of the shared body.overlay-open nav-hide (a non-refcounted class nested
  // overlays can stomp).
  return createPortal(
    <div
      className="modal-backdrop modal-backdrop--top"
      onClick={onClose}
    >
      <div
        className="modal-sheet rs-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Documents & signatures"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — swaps to a Back control while the preview screen is open;
            the close (✕) button stays put in both modes so the whole sheet
            is always one tap from closing regardless of view. */}
        <div className="modal-sheet-header">
          {previewOpen ? (
            <button
              type="button"
              className="docs-hub-back-btn"
              onClick={handleClosePreview}
              aria-label="Back to documents"
            >
              <Icon name="chevron-left" size={20} />
              Back
            </button>
          ) : (
            <h2 className="modal-sheet-title rs-title">Documents &amp; signatures</h2>
          )}
          <button
            type="button"
            className="modal-sheet-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Tab switcher — hidden while previewing (switching doc type mid-
            preview would show a stale doc type); Back returns to it. */}
        {!previewOpen && (
          <div
            className="work-segments docs-hub-tabs"
            role="tablist"
            aria-label="Document type"
          >
            <button
              type="button"
              className={`work-segment${tab === 'quotes' ? ' work-segment--active' : ''}`}
              role="tab"
              aria-selected={tab === 'quotes'}
              onClick={() => setTab('quotes')}
            >
              Quotes
            </button>
            <button
              type="button"
              className={`work-segment${tab === 'invoices' ? ' work-segment--active' : ''}`}
              role="tab"
              aria-selected={tab === 'invoices'}
              onClick={() => setTab('invoices')}
            >
              Invoices
            </button>
          </div>
        )}

        {/* Body — scrolls; header+tabs are sticky */}
        <div className="docs-hub-body">
          {previewOpen ? (
            /* View-first preview — read-only facsimile (onJobPatch/
               onInvoiceNumberChange/onDueDateChange all omitted, per the
               DocumentPreview "onEdit optional" convention). Logo/business
               identity stay tappable — those persist to the PROFILE, not the
               job, via onProfileUpdate, same as everywhere else DocumentPreview
               is used. Renders instantly; no PDF is generated until Save/Share. */
            <DocumentPreview
              mode={tab === 'quotes' ? 'quote' : 'invoice'}
              job={job}
              biz={biz}
              profile={profile}
              depositPercent={Number(job?.deposit_percent ?? 0)}
              invoiceNumber={job?.invoiceNumber}
              dueDate={job?.invoiceDueDate}
              onProfileUpdate={onProfileUpdate}
              flash={flash}
            />
          ) : docIsNone ? (
            /* Empty state */
            <div className="docs-hub-empty">
              <p className="docs-hub-empty-text">
                {tab === 'quotes' ? 'No quote sent yet.' : 'No invoice sent yet.'}
              </p>
              <button
                type="button"
                className="docs-hub-ghost-btn"
                onClick={tab === 'quotes' ? onBuildQuote : onSendInvoice}
              >
                {tab === 'quotes' ? 'Build a quote' : 'Send invoice'}
              </button>
            </div>
          ) : (
            /* Doc content — wrapped in a rounded dark card */
            <div className="docs-hub-card">
              {/* Card header: doc label left, status pill right */}
              <div className="docs-hub-card-header">
                <span className="docs-hub-doc-label">
                  {tab === 'quotes' ? 'Quote' : invoiceDocLabel}
                </span>
                {activeRecord.chipLabel && (
                  <span className={`jd-doc-chip jd-doc-chip--${activeRecord.chipClass}`}>
                    {activeRecord.chipLabel}
                  </span>
                )}
              </div>

              {/* Timeline */}
              <DocumentTimeline steps={tab === 'quotes' ? quoteSteps : invoiceSteps} />

              {/* Gated signature — Quotes tab only, when signed */}
              {tab === 'quotes' && quoteRecord.state === 'signed' && (
                <GatedSignature job={job} />
              )}

              {/* View PDF — opens the read-only preview above; green primary CTA */}
              <button
                type="button"
                className="docs-hub-view-pdf-btn docs-hub-view-pdf-btn--green"
                onClick={handleOpenPreview}
                aria-label={pdfBtnLabel}
              >
                {pdfBtnLabel}
              </button>
            </div>
          )}
        </div>

        {/* Action tray — Save (primary) · Share · Copy link. Pinned below the
            scrolling preview as a flex sibling of .docs-hub-body (same pattern
            the header/tabs use to stay put above it), so it's always reachable
            without scrolling. Save reuses the app-wide .btn-primary "Live Steel
            Blue" recipe (var(--accent), PREMIUM PRIMARY BUTTON SYSTEM further
            down index.css) — same convention as ReviewSheet's .rs-send-btn —
            rather than a one-off colour; .docs-hub-tray-btn--primary only adds
            layout on top, same as .rs-send-btn does. */}
        {previewOpen && (
          <div className="docs-hub-preview-tray">
            <button
              type="button"
              className="btn-primary docs-hub-tray-btn--primary"
              onClick={handleSavePDF}
              disabled={busy}
            >
              {busy ? 'Working…' : 'Save PDF'}
            </button>
            <div className="docs-hub-tray-row">
              <button
                type="button"
                className="docs-hub-tray-btn docs-hub-tray-btn--secondary"
                onClick={handleShare}
                disabled={busy}
              >
                <Icon name="share" size={16} />
                Share
              </button>
              <button
                type="button"
                className="docs-hub-tray-btn docs-hub-tray-btn--secondary"
                onClick={handleCopyLink}
              >
                <Icon name="link" size={16} />
                Copy link
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
