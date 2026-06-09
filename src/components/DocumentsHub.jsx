/**
 * DocumentsHub — tabbed modal sheet that replaces the Design 1 Quotes/Invoices
 * accordions in JobDetailDrawer.
 *
 * Design 2, 2026-06. PRD spec implemented by ENG (Alaister / al-jobprofit).
 *
 * Architecture notes:
 *  - ALL hooks are declared before any early return (R1 — see PR #125 trap).
 *  - GatedSignature is a sub-component defined in this file; its hooks also
 *    live above its own early returns.
 *  - fmtDate / fmtDateTime are local helpers (keeps this module self-contained
 *    and unit-testable without DOM imports).
 */

import React, { useState } from 'react';
import Icon from './Icon';
import { buildQuoteRecordMeta, buildInvoiceRecordMeta } from '../lib/documentRecord';
import { downloadQuotePDF, downloadInvoicePDF } from '../lib/invoicePDF';
import { isPro } from '../lib/plan';
import { formatPartPaidLabel } from '../lib/partPaidChip';

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
 * }} props
 */
export default function DocumentsHub({ open, job, biz, profile, onClose, onBuildQuote, onSendInvoice }) {
  // R1: ALL hooks above any early return.
  const [tab, setTab]             = useState('quotes');
  const [generating, setGenerating] = useState(false);

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

  // ── PDF handlers ──────────────────────────────────────────────────────────
  async function handleViewPDF() {
    if (generating) return;
    setGenerating(true);
    try {
      if (tab === 'quotes') {
        await downloadQuotePDF({
          job,
          biz,
          profile,
          quoteUrl: '',
          qrDataUrl: '',
          hidePoweredBy: isPro(profile),
        });
      } else {
        await downloadInvoicePDF({
          job,
          biz,
          profile,
          invoiceNumber: job?.invoiceNumber,
          dueDate:       job?.invoiceDueDate,
          hidePoweredBy: isPro(profile),
        });
      }
    } catch (err) {
      console.error('[DocumentsHub] PDF generation failed', err);
    } finally {
      setGenerating(false);
    }
  }

  // ── Derived labels ────────────────────────────────────────────────────────
  const invoiceDocLabel = job?.invoiceNumber ? `Invoice ${job.invoiceNumber}` : 'Invoice';
  const activeRecord    = tab === 'quotes' ? quoteRecord : invoiceRecord;
  const docIsNone       = tab === 'quotes' ? quoteIsNone : invoiceIsNone;
  const isSigned        = !!(job?.acceptedAt || quoteRecord.state === 'signed' || quoteRecord.state === 'accepted');

  // PDF button label: signed quote → "View signed PDF"; unsigned → "View quote PDF"; invoice → "View invoice PDF"
  let pdfBtnLabel;
  if (generating) {
    pdfBtnLabel = 'Generating…';
  } else if (tab === 'quotes') {
    pdfBtnLabel = isSigned ? 'View signed PDF' : 'View quote PDF';
  } else {
    pdfBtnLabel = 'View invoice PDF';
  }

  // FIX 1: sheet is nested INSIDE the backdrop (not a sibling fragment).
  // The backdrop is position:fixed with display:flex — the sheet is its flex child.
  // Tap-outside (backdrop onClick) closes; stopPropagation on the sheet prevents
  // the backdrop click from firing when the user taps inside the sheet.
  return (
    <div
      className="modal-backdrop modal-backdrop--top"
      onClick={onClose}
      aria-hidden="true"
    >
      <div
        className="modal-sheet rs-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Documents & signatures"
        onClick={e => e.stopPropagation()}
      >
        {/* Header: back-chevron + title, left-aligned */}
        <div className="modal-sheet-header docs-hub-header">
          <button
            type="button"
            className="docs-hub-back-btn"
            onClick={onClose}
            aria-label="Back"
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <h2 className="modal-sheet-title rs-title">Documents &amp; signatures</h2>
        </div>

        {/* Tab switcher */}
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

        {/* Body — scrolls; header+tabs are sticky */}
        <div className="docs-hub-body">
          {docIsNone ? (
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

              {/* View PDF — green primary CTA */}
              <button
                type="button"
                className="docs-hub-view-pdf-btn docs-hub-view-pdf-btn--green"
                onClick={handleViewPDF}
                disabled={generating}
                aria-label={generating ? 'Generating PDF…' : pdfBtnLabel}
              >
                {pdfBtnLabel}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
