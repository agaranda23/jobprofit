import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { resolvePaidDate, resolveAmountPaid, formatReceiptDate } from './receiptMessage.js';
import { logoUrlToBase64 } from './invoicePDF.js';
import { downscaleDataUrl } from './photoCompress.js';

/**
 * Generates a branded RECEIPT PDF.
 *
 * Visually mirrors generateInvoicePDF (same header / table / footer system)
 * but labelled RECEIPT and carries:
 *   - Receipt number — R-<invoice number> if available, or R-<job id slice>
 *   - A "PAID IN FULL" stamp instead of due-date / invoice-number block
 *   - Paid date (sourced via resolvePaidDate — payments[] first, paidAt second)
 *   - Amount paid (sourced via resolveAmountPaid)
 *   - Payment method — "Paid by: Cash / Bank transfer / Card" (from payments[].method
 *     or job.paymentType / job.payment_type). Omitted when method is unknown/missing.
 *   - VAT breakdown (net / VAT / gross) when the business is VAT-registered.
 *     Non-VAT-registered traders never see any VAT line or VAT number.
 *   - Full header parity with the invoice (logo, name, address, phone, email,
 *     website when set, VAT reg number when registered) via resolveBusinessIdentity.
 *   - A short thank-you line before the footer
 *
 * No bank details are shown — this is a confirmation of payment received,
 * not a payment request.
 *
 * The header / table / footer helpers are inlined here (not imported from
 * invoicePDF.js) so that receiptPDF remains a stand-alone module — safe to
 * unit test and deploy independently.
 */


// ── Brand tokens (mirrors invoicePDF.js — keep in sync if tokens change) ───
const BRAND_GREEN   = [37, 99, 235];   // #2563eb brand blue
const PAID_GREEN_BG = [14, 107, 67];   // #0E6B43 — deeper green for PAID stamp
const PAID_GREEN_FG = [220, 255, 238]; // near-white mint text on stamp
const DARK          = [30, 58, 95];    // #1E3A5F visible-navy — headings and body text
const MID           = [80, 80, 80];
const LIGHT         = [150, 150, 150];
const RULE_COLOR    = [220, 220, 220];

const MARGIN        = 14;
const PAGE_H        = 297;
const HEADER_LOGO_W = 28;
const HEADER_LOGO_H = 28;

// ── Shared drawing helpers ──────────────────────────────────────────────────

function rule(doc, y) {
  const w = doc.internal.pageSize.getWidth();
  doc.setDrawColor(...RULE_COLOR);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, w - MARGIN, y);
}

function bizLogoUrl(biz) {
  return biz?.logoUrl || biz?.logo_url || null;
}

function inferImageType(src) {
  if (!src) return 'PNG';
  const lower = src.toLowerCase();
  if (lower.startsWith('data:image/jpeg') || lower.startsWith('data:image/jpg')) return 'JPEG';
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'JPEG';
  return 'PNG';
}

/**
 * Full header parity with invoicePDF.js drawHeader:
 *   logo (left) | name, address, phone•email•website, UTR, VAT reg (right)
 *
 * Returns y position below the header rule.
 */
async function drawHeader(doc, biz) {
  const w = doc.internal.pageSize.getWidth();
  let y = 16;

  const logo = bizLogoUrl(biz);
  if (logo) {
    try {
      // Downscale the user logo to longest-edge ≤600 px and re-encode as JPEG
      // before embedding — matches invoicePDF.js behaviour. Transparent PNGs are
      // flattened onto white (the header background), so JPEG is always safe.
      const { dataUrl: scaledLogo, format: scaledFmt } = await downscaleDataUrl(logo, 600, 0.85);
      doc.addImage(scaledLogo, scaledFmt, MARGIN, y, HEADER_LOGO_W, HEADER_LOGO_H);
    } catch { /* logo decode failed — skip silently */ }
  }

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(biz?.name || 'Your Business', w - MARGIN, y + 7, { align: 'right' });

  let rightY = y + 14;

  // Address — split on newlines or commas, max 3 fragments
  const address = biz?.address || '';
  if (address) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MID);
    const lines = address.split(/\n|,\s*/).slice(0, 3);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        doc.text(trimmed, w - MARGIN, rightY, { align: 'right' });
        rightY += 4.5;
      }
    }
  }

  // Phone • email • website
  const contact = [biz?.phone, biz?.email, biz?.website].filter(Boolean).join('  •  ');
  if (contact) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MID);
    doc.text(contact, w - MARGIN, rightY, { align: 'right' });
    rightY += 4.5;
  }

  // UTR — when set
  const utr = biz?.utr || biz?.utr_number || '';
  if (utr) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...LIGHT);
    doc.text(`UTR: ${utr}`, w - MARGIN, rightY, { align: 'right' });
    rightY += 4.5;
  }

  // VAT reg number — ONLY when the business is actually VAT-registered
  const vatRegistered = biz?.vatRegistered || biz?.vat_registered || false;
  const vatNumber = biz?.vatNumber || biz?.vat_number || '';
  if (vatRegistered && vatNumber) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...LIGHT);
    doc.text(`VAT Reg: ${vatNumber}`, w - MARGIN, rightY, { align: 'right' });
    rightY += 4.5;
  }

  const logoBottom = y + HEADER_LOGO_H + 4;
  const ruleY = Math.max(logoBottom, rightY + 2);
  rule(doc, ruleY);
  return ruleY + 8;
}

function drawDocTitle(doc, title, fields, startY) {
  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_GREEN);
  doc.text(title, MARGIN, startY);

  let y = startY + 9;
  doc.setFontSize(9);
  for (const [label, value] of fields) {
    if (value) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...DARK);
      doc.text(`${label}: `, MARGIN, y);
      const labelW = doc.getTextWidth(`${label}: `);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MID);
      doc.text(value, MARGIN + labelW, y);
      y += 5.5;
    }
  }
  return y + 4;
}

function drawRecipientBlock(doc, label, job, startY) {
  const w = doc.internal.pageSize.getWidth();

  doc.setFillColor(248, 248, 248);
  doc.roundedRect(MARGIN, startY - 3, w - MARGIN * 2, 22, 2, 2, 'F');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...LIGHT);
  doc.text(label.toUpperCase(), MARGIN + 4, startY + 3);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(job?.customer || job?.customerName || 'Customer', MARGIN + 4, startY + 10);

  if (job?.address) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MID);
    doc.text(job.address, MARGIN + 4, startY + 16);
    return startY + 30;
  }

  return startY + 26;
}

function drawLineItems(doc, job, startY) {
  const items = (job?.lineItems || []).map(li => [
    li.desc || '',
    { content: `£${(li.cost || 0).toFixed(2)}`, styles: { halign: 'right' } },
  ]);

  if (items.length === 0) {
    items.push([
      job?.summary || 'Work completed',
      {
        content: `£${(job?.total ?? job?.amount ?? 0).toFixed(2)}`,
        styles: { halign: 'right' },
      },
    ]);
  }

  autoTable(doc, {
    startY,
    head: [['Description', { content: 'Amount', styles: { halign: 'right' } }]],
    body: items,
    theme: 'plain',
    headStyles: {
      fillColor: BRAND_GREEN,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
    },
    bodyStyles: {
      fontSize: 10,
      textColor: DARK,
      cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
    },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: { 1: { cellWidth: 42 } },
    tableLineColor: RULE_COLOR,
    tableLineWidth: 0.2,
  });

  return doc.lastAutoTable.finalY;
}

/**
 * @param {object} doc
 * @param {object} biz
 * @param {string} [extra]          - override text for the main footer line
 * @param {boolean} [hidePoweredBy] - true for Pro traders (white-label perk); suppresses the "Sent with OHNAR" footer line
 */
async function drawFooter(doc, biz, extra = '', hidePoweredBy = false) {
  const w = doc.internal.pageSize.getWidth();
  const footerY = PAGE_H - 10;
  rule(doc, footerY - 4);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...LIGHT);
  const text = extra || `${biz?.name || 'OHNAR'}  •  Generated ${new Date().toLocaleDateString('en-GB')}`;
  doc.text(text, w / 2, footerY, { align: 'center' });

  if (!hidePoweredBy) {
    // OHNAR "O" mark — vector ring, no base64 blob needed.
    const LOGO_SIZE = 5;  // mm
    const logoX = w / 2 - 30;
    const logoY = footerY + 2;
    const cx = logoX + LOGO_SIZE / 2;
    const cy = logoY + LOGO_SIZE / 2;
    const r = LOGO_SIZE / 2;
    doc.setDrawColor(37, 99, 235);   // #2563EB brand blue
    doc.setLineWidth(0.8);
    doc.circle(cx, cy, r, 'S');
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...LIGHT);
    doc.text('Sent with OHNAR — jobprofit.co.uk', logoX + LOGO_SIZE + 1.5, footerY + 5.5, { align: 'left' });
  }
}

// ── Payment method label resolution ────────────────────────────────────────

const METHOD_LABELS = {
  cash:    'Cash',
  bank:    'Bank transfer',
  card:    'Card',
  other:   'Other',
};

/**
 * Derives the human-readable payment method label for the receipt.
 *
 * Priority:
 *   1. Latest payment row's method from payments[] (the structured partial-
 *      payment ledger added in Phase B). Uses the method of the last payment
 *      by date, which for fully-paid jobs is the final settlement.
 *   2. job.paymentType / job.payment_type — legacy string field on the job
 *      (values: 'awaiting' | 'cash' | 'bank' | 'card'). 'awaiting' maps to ''.
 *
 * Returns '' when the method cannot be determined — callers must omit the
 * "Paid by:" line entirely in this case (never show "Paid by: Unknown").
 */
export function resolvePaymentMethod(job) {
  const payments = job?.payments;
  if (Array.isArray(payments) && payments.length > 0) {
    const sorted = [...payments].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const method = sorted[0]?.method;
    return METHOD_LABELS[method] || '';
  }
  // Legacy per-job field
  const legacy = job?.paymentType || job?.payment_type || '';
  if (legacy && legacy !== 'awaiting') {
    return METHOD_LABELS[legacy] || '';
  }
  return '';
}

// ── Receipt number resolution ────────────────────────────────────────────────

/**
 * Derives a receipt number for the document meta block.
 *
 * Priority:
 *   1. job.receiptNumber — explicitly stored on the job (future-proof field)
 *   2. R-<settled invoice number> — if the job carries an invoiceNumber, prefix R-
 *   3. R-<last 4 chars of job id> — stable fallback matching the Q- quote scheme
 *
 * The R- prefix distinguishes receipts from invoices in the trader's records.
 */
export function resolveReceiptNumber(job) {
  if (job?.receiptNumber) return job.receiptNumber;
  if (job?.invoiceNumber) return `R-${job.invoiceNumber}`;
  const id = job?.id ?? job?.cloudId ?? '';
  return id ? `R-${String(id).slice(-4).toUpperCase()}` : '';
}

// ═══════════════════════════════════════════════════════════════════════════
// RECEIPT
// ═══════════════════════════════════════════════════════════════════════════

export async function generateReceiptPDF({ job, biz, profile = null, hidePoweredBy = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();

  // Full biz merge — profile wins for every field it sets (mirrors resolveBusinessIdentity).
  // This closes header parity with the invoice: logo_url, address, UTR, VAT reg all
  // flow from the Supabase profile row rather than the stale localStorage biz object.
  const effectiveBiz = {
    name:         profile?.business_name || biz?.name    || '',
    address:      profile?.address       || biz?.address  || '',
    phone:        profile?.phone         || biz?.phone    || '',
    email:        profile?.email         || biz?.email    || '',
    website:      profile?.website       || biz?.website  || '',
    logoUrl:      profile?.logo_url      || biz?.logoUrl  || biz?.logo_url || '',
    logo_url:     profile?.logo_url      || biz?.logo_url || biz?.logoUrl  || '',
    utr:          profile?.utr_number    || biz?.utr      || biz?.utr_number || '',
    vatRegistered: profile?.vat_registered ?? biz?.vatRegistered ?? biz?.vat_registered ?? false,
    vatNumber:    profile?.vat_number    || biz?.vatNumber || biz?.vat_number || '',
  };

  const amountPaid    = resolveAmountPaid(job);
  const paidDate      = resolvePaidDate(job);
  const paidDateLabel = formatReceiptDate(paidDate);
  const receiptNumber = resolveReceiptNumber(job);
  const paymentMethod = resolvePaymentMethod(job);

  // VAT breakdown — shown only when the business is VAT-registered
  const showVat = !!effectiveBiz.vatRegistered;
  // Net = amount before VAT. If the job's total is the gross-inc-VAT amount, net = total / 1.2.
  // We use the settled amountPaid as the gross figure.
  const vatAmount  = showVat ? Math.round(amountPaid / 6 * 100) / 100 : 0; // VAT at 20% = gross/6
  const netAmount  = showVat ? Math.round((amountPaid - vatAmount) * 100) / 100 : 0;

  // ── Logo pre-fetch ────────────────────────────────────────────────────
  const rawLogoUrlR = effectiveBiz.logoUrl || effectiveBiz.logo_url || null;
  if (rawLogoUrlR) {
    const b64 = await logoUrlToBase64(rawLogoUrlR);
    effectiveBiz.logoUrl = b64 || '';
    effectiveBiz.logo_url = b64 || '';
  }

  // ── Business header ──────────────────────────────────────────────────────
  let y = await drawHeader(doc, effectiveBiz);

  // ── RECEIPT heading ──────────────────────────────────────────────────────
  y = drawDocTitle(doc, 'RECEIPT', [
    ['Receipt no', receiptNumber],
    ['Date',       paidDateLabel],
  ], y);

  // ── Received From ────────────────────────────────────────────────────────
  y = drawRecipientBlock(doc, 'Received From', job, y);

  // ── Job description line
  if (job?.summary && (job?.lineItems || []).length > 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...MID);
    doc.text(job.summary, MARGIN, y);
    y += 7;
  }

  // ── Line items ───────────────────────────────────────────────────────────
  y = drawLineItems(doc, job, y + 2) + 4;

  // ── Totals panel ─────────────────────────────────────────────────────────
  const jobTotal = job?.total ?? job?.amount ?? 0;
  const panelX = w - MARGIN - 80;

  // Compute panel row count to size it correctly
  const panelRows = 1                // Subtotal
    + (showVat ? 2 : 0)              // Net + VAT rows (when registered)
    + 1;                             // AMOUNT PAID row
  const panelH = 12 + (panelRows - 1) * 8 + 14;

  doc.setFillColor(248, 248, 248);
  doc.roundedRect(panelX, y + 4, 80, panelH, 2, 2, 'F');

  let ty = y + 13;

  // Subtotal row
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MID);
  doc.text('Subtotal', panelX + 6, ty);
  doc.text(`£${jobTotal.toFixed(2)}`, w - MARGIN - 4, ty, { align: 'right' });

  // VAT breakdown — only when VAT-registered
  if (showVat) {
    ty += 8;
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MID);
    doc.text(`Net (ex. VAT)`, panelX + 6, ty);
    doc.text(`£${netAmount.toFixed(2)}`, w - MARGIN - 4, ty, { align: 'right' });

    ty += 8;
    doc.text('VAT (20%)', panelX + 6, ty);
    doc.text(`£${vatAmount.toFixed(2)}`, w - MARGIN - 4, ty, { align: 'right' });
  }

  // Rule above AMOUNT PAID
  ty += 4;
  doc.setDrawColor(...BRAND_GREEN);
  doc.setLineWidth(0.5);
  doc.line(panelX + 4, ty, w - MARGIN - 4, ty);

  ty += 7;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text('AMOUNT PAID', panelX + 6, ty);
  doc.text(`£${amountPaid.toFixed(2)}`, w - MARGIN - 4, ty, { align: 'right' });

  // VAT reg footnote below panel (mirrors invoicePDF.js convention)
  if (showVat && effectiveBiz.vatNumber) {
    const footnoteY = y + 4 + panelH + 4;
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...LIGHT);
    doc.text(`VAT Reg: ${effectiveBiz.vatNumber}`, MARGIN, footnoteY);
    y = footnoteY + 8;
  } else {
    y += panelH + 12;
  }

  // ── PAID IN FULL stamp ───────────────────────────────────────────────────
  y += 6;
  doc.setFillColor(...PAID_GREEN_BG);
  doc.roundedRect(MARGIN, y, w - MARGIN * 2, 18, 3, 3, 'F');
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PAID_GREEN_FG);
  doc.text('PAID IN FULL', w / 2, y + 12, { align: 'center' });

  y += 24;

  // ── Payment received + method lines ──────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MID);
  doc.text(`Payment received: ${paidDateLabel}`, MARGIN, y);
  y += 5.5;

  if (paymentMethod) {
    doc.text(`Paid by: ${paymentMethod}`, MARGIN, y);
    y += 5.5;
  }

  // ── Thank-you ────────────────────────────────────────────────────────────
  y += 4;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...MID);
  doc.text('Thank you for your business.', MARGIN, y);

  // ── Footer ───────────────────────────────────────────────────────────────
  await drawFooter(doc, effectiveBiz, `${effectiveBiz.name || 'OHNAR'}  •  Receipt generated ${new Date().toLocaleDateString('en-GB')}`, hidePoweredBy);

  return doc;
}

export async function downloadReceiptPDF({ job, biz, profile = null, hidePoweredBy = false }) {
  const doc = await generateReceiptPDF({ job, biz, profile, hidePoweredBy });
  const customer = (job?.customer || job?.name || 'receipt').replace(/\s+/g, '-');
  doc.save(`receipt-${customer}.pdf`);
}

export async function getReceiptPDFBlob({ job, biz, profile = null, hidePoweredBy = false }) {
  const doc = await generateReceiptPDF({ job, biz, profile, hidePoweredBy });
  return doc.output('blob');
}
