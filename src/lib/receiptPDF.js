import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { resolvePaidDate, resolveAmountPaid, formatReceiptDate } from './receiptMessage.js';

/**
 * Generates a branded RECEIPT PDF.
 *
 * Visually mirrors generateInvoicePDF (same header / table / footer system)
 * but labelled RECEIPT and carries:
 *   - A "PAID IN FULL" stamp instead of due-date / invoice-number block
 *   - Paid date (sourced via resolvePaidDate — payments[] first, paidAt second)
 *   - Amount paid (sourced via resolveAmountPaid)
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
const BRAND_GREEN   = [43, 196, 138];  // #2bc48a
const PAID_GREEN_BG = [14, 107, 67];   // #0E6B43 — deeper green for PAID stamp
const PAID_GREEN_FG = [220, 255, 238]; // near-white mint text on stamp
const DARK          = [20, 20, 20];
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

function drawHeader(doc, biz) {
  const w = doc.internal.pageSize.getWidth();
  const y = 16;

  const logo = bizLogoUrl(biz);
  if (logo) {
    try {
      const imgType = inferImageType(logo);
      doc.addImage(logo, imgType, MARGIN, y, HEADER_LOGO_W, HEADER_LOGO_H);
    } catch { /* logo decode failed — skip silently */ }
  }

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(biz?.name || 'Your Business', w - MARGIN, y + 7, { align: 'right' });

  if (biz?.address) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MID);
    doc.text(biz.address, w - MARGIN, y + 14, { align: 'right' });
  }

  const contact = [biz?.phone, biz?.email].filter(Boolean).join('  •  ');
  if (contact) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MID);
    doc.text(contact, w - MARGIN, y + 21, { align: 'right' });
  }

  const ruleY = y + HEADER_LOGO_H + 4;
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

function drawFooter(doc, biz, extra = '') {
  const w = doc.internal.pageSize.getWidth();
  const footerY = PAGE_H - 10;
  rule(doc, footerY - 4);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...LIGHT);
  const text = extra || `${biz?.name || 'JobProfit'}  •  Generated ${new Date().toLocaleDateString('en-GB')}`;
  doc.text(text, w / 2, footerY, { align: 'center' });
}

// ═══════════════════════════════════════════════════════════════════════════
// RECEIPT
// ═══════════════════════════════════════════════════════════════════════════

export function generateReceiptPDF({ job, biz, profile = null }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();

  // Merge biz + profile — mirrors invoicePDF.js convention so logo_url from
  // the Supabase profile row is picked up when biz is null or incomplete.
  const effectiveBiz = {
    name:    biz?.name    || profile?.business_name || '',
    address: biz?.address || profile?.address        || '',
    phone:   biz?.phone   || profile?.phone          || '',
    email:   biz?.email   || profile?.email          || '',
    logoUrl: biz?.logoUrl || biz?.logo_url || profile?.logo_url || '',
    logo_url: biz?.logo_url || biz?.logoUrl || profile?.logo_url || '',
  };

  const amountPaid  = resolveAmountPaid(job);
  const paidDate    = resolvePaidDate(job);
  const paidDateLabel = formatReceiptDate(paidDate);

  // ── Business header ──────────────────────────────────────────────────────
  let y = drawHeader(doc, effectiveBiz);

  // ── RECEIPT heading ──────────────────────────────────────────────────────
  y = drawDocTitle(doc, 'RECEIPT', [['Date', paidDateLabel]], y);

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

  // Subtotal row
  doc.setFillColor(248, 248, 248);
  doc.roundedRect(panelX, y + 4, 80, 28, 2, 2, 'F');

  let ty = y + 13;
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MID);
  doc.text('Subtotal', panelX + 6, ty);
  doc.text(`£${jobTotal.toFixed(2)}`, w - MARGIN - 4, ty, { align: 'right' });

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

  y += 36;

  // ── PAID IN FULL stamp ───────────────────────────────────────────────────
  y += 6;
  doc.setFillColor(...PAID_GREEN_BG);
  doc.roundedRect(MARGIN, y, w - MARGIN * 2, 18, 3, 3, 'F');
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PAID_GREEN_FG);
  doc.text('PAID IN FULL', w / 2, y + 12, { align: 'center' });

  y += 24;

  // ── Payment received line ────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MID);
  doc.text(`Payment received: ${paidDateLabel}`, MARGIN, y);

  // ── Thank-you ────────────────────────────────────────────────────────────
  y += 10;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...MID);
  doc.text('Thank you for your business.', MARGIN, y);

  // ── Footer ───────────────────────────────────────────────────────────────
  drawFooter(doc, effectiveBiz, `${effectiveBiz.name || 'JobProfit'}  •  Receipt generated ${new Date().toLocaleDateString('en-GB')}`);

  return doc;
}

export function downloadReceiptPDF({ job, biz, profile = null }) {
  const doc = generateReceiptPDF({ job, biz, profile });
  const customer = (job?.customer || job?.name || 'receipt').replace(/\s+/g, '-');
  doc.save(`receipt-${customer}.pdf`);
}

export function getReceiptPDFBlob({ job, biz, profile = null }) {
  const doc = generateReceiptPDF({ job, biz, profile });
  return doc.output('blob');
}
