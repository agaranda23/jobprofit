import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Generates an invoice PDF for the new Get Paid workflow. Distinct from
// the legacy generateInvoicePDF in App.jsx (which uses window.jspdf and
// the old `invoices` collection). This one reads everything from the job
// itself plus the structured biz fields added in PRD #2.

// ── Brand tokens ────────────────────────────────────────────────────────────
// Keep accent use sparse — these PDFs print on white; all body text is dark.
const BRAND_GREEN   = [43, 196, 138];  // #2bc48a — rule / column header accent
const DARK          = [20, 20, 20];    // near-black for headings and body text
const MID           = [80, 80, 80];    // secondary labels, address lines
const LIGHT         = [150, 150, 150]; // muted labels (BILL TO, INVOICE etc.)
const RULE          = [220, 220, 220]; // hairline separator

// ── Shared layout constants ──────────────────────────────────────────────────
const MARGIN        = 14;             // left/right margin (mm)
const PAGE_H        = 297;            // A4 height
const HEADER_LOGO_W = 28;
const HEADER_LOGO_H = 28;

// ── helpers ──────────────────────────────────────────────────────────────────

/** Draw a full-width horizontal hairline at y. */
function rule(doc, y) {
  const w = doc.internal.pageSize.getWidth();
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, w - MARGIN, y);
}

/**
 * Draws the shared business header block (logo + name + address + contact).
 * Returns the y position just below the header rule.
 *
 * Layout:
 *   logo (left)          business name (right, bold, large)
 *                        address (right, muted)
 *                        phone • email (right, muted)
 *   ── rule ──────────────────────────────────────────────────────
 */
function drawHeader(doc, biz) {
  const w = doc.internal.pageSize.getWidth();
  let y = 16;

  if (biz?.logoUrl) {
    try {
      doc.addImage(biz.logoUrl, 'JPEG', MARGIN, y, HEADER_LOGO_W, HEADER_LOGO_H);
    } catch { /* logo decode failed — skip silently */ }
  }

  // Business name — right-aligned, prominent
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(biz?.name || 'Your Business', w - MARGIN, y + 7, { align: 'right' });

  // Address
  if (biz?.address) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MID);
    doc.text(biz.address, w - MARGIN, y + 14, { align: 'right' });
  }

  // Phone • email
  const contact = [biz?.phone, biz?.email].filter(Boolean).join('  •  ');
  if (contact) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MID);
    doc.text(contact, w - MARGIN, y + 21, { align: 'right' });
  }

  // Horizontal rule beneath header
  const ruleY = y + HEADER_LOGO_H + 4;
  rule(doc, ruleY);

  return ruleY + 8; // caller starts drawing from here
}

/**
 * Draws the document-type block (e.g. "INVOICE") and its meta fields.
 * `fields` is an array of [label, value] pairs rendered as key: value lines.
 * Returns the y position after the block.
 */
function drawDocTitle(doc, title, fields, startY) {
  // Large document title
  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_GREEN);
  doc.text(title, MARGIN, startY);

  // Meta fields directly below title
  let y = startY + 9;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MID);
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

/**
 * Draws the "recipient" section (BILL TO / PREPARED FOR / RECEIVED FROM).
 * Returns the y position after the block.
 */
function drawRecipientBlock(doc, label, job, startY) {
  const w = doc.internal.pageSize.getWidth();

  // Faint background band
  doc.setFillColor(248, 248, 248);
  doc.roundedRect(MARGIN, startY - 3, w - MARGIN * 2, 22, 2, 2, 'F');

  // Label
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...LIGHT);
  doc.text(label.toUpperCase(), MARGIN + 4, startY + 3);

  // Customer name
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(job?.customer || job?.customerName || 'Customer', MARGIN + 4, startY + 10);

  // Address (if present)
  if (job?.address) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MID);
    doc.text(job.address, MARGIN + 4, startY + 16);
    return startY + 30;
  }

  return startY + 26;
}

/**
 * Draws the line-items autotable and returns the y position after it.
 */
function drawLineItems(doc, job, startY) {
  const items = (job?.lineItems || []).map(li => [
    li.desc || '',
    { content: `£${(li.cost || 0).toFixed(2)}`, styles: { halign: 'right' } },
  ]);

  if (items.length === 0) {
    items.push([
      job?.summary || 'Work completed',
      { content: `£${(job?.total ?? job?.amount ?? 0).toFixed(2)}`, styles: { halign: 'right' } },
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
    tableLineColor: RULE,
    tableLineWidth: 0.2,
  });

  return doc.lastAutoTable.finalY;
}

/**
 * Draws the totals block (subtotal / VAT / total) right-aligned.
 * Returns the y position after the block.
 */
function drawTotals(doc, { subtotal, showVat, vatNumber, totalLabel = 'TOTAL DUE' }, startY) {
  const w = doc.internal.pageSize.getWidth();
  const vat = showVat ? Math.round(subtotal * 0.2 * 100) / 100 : 0;
  const total = subtotal + vat;

  // Subtle background for the totals panel
  const panelX = w - MARGIN - 80;
  const panelH = showVat ? 32 : 22;
  doc.setFillColor(248, 248, 248);
  doc.roundedRect(panelX, startY + 4, 80, panelH, 2, 2, 'F');

  let y = startY + 12;
  const valX = w - MARGIN - 4;
  const labelX = panelX + 6;

  // Subtotal row
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MID);
  doc.text('Subtotal', labelX, y);
  doc.text(`£${subtotal.toFixed(2)}`, valX, y, { align: 'right' });

  // VAT row
  if (showVat) {
    y += 8;
    doc.text('VAT (20%)', labelX, y);
    doc.text(`£${vat.toFixed(2)}`, valX, y, { align: 'right' });
  }

  // Total rule
  y += 4;
  doc.setDrawColor(...BRAND_GREEN);
  doc.setLineWidth(0.5);
  doc.line(panelX + 4, y, w - MARGIN - 4, y);

  // Total row
  y += 7;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(totalLabel, labelX, y);
  doc.text(`£${total.toFixed(2)}`, valX, y, { align: 'right' });

  // VAT number (if applicable)
  if (showVat && vatNumber) {
    y += 7;
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...LIGHT);
    doc.text(`VAT Reg: ${vatNumber}`, MARGIN, y);
  }

  return y + 8;
}

/**
 * Draws the standard footer line.
 */
function drawFooter(doc, biz, label = '') {
  const w = doc.internal.pageSize.getWidth();
  const footerY = PAGE_H - 10;
  rule(doc, footerY - 4);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...LIGHT);
  const text = label
    || `${biz?.name || 'JobProfit'}  •  Generated ${new Date().toLocaleDateString('en-GB')}`;
  doc.text(text, w / 2, footerY, { align: 'center' });
}

// ═══════════════════════════════════════════════════════════════════════════
// INVOICE
// ═══════════════════════════════════════════════════════════════════════════

export function generateInvoicePDF({ job, biz, invoiceNumber, dueDate }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();

  // ── Header ──────────────────────────────────────────────────────────────
  let y = drawHeader(doc, biz);

  // ── Document title block ──────────────────────────────────────────────
  const metaFields = [
    ['Invoice no', invoiceNumber],
    ['Date',       new Date().toLocaleDateString('en-GB')],
    ['Due',        dueDate ? new Date(dueDate).toLocaleDateString('en-GB') : null],
  ];
  y = drawDocTitle(doc, 'INVOICE', metaFields, y);

  // ── Bill To ───────────────────────────────────────────────────────────
  y = drawRecipientBlock(doc, 'Bill To', job, y);

  // ── Job description line (if there are no line items, this sets context)
  if (job?.summary && (job?.lineItems || []).length > 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...MID);
    doc.text(job.summary, MARGIN, y);
    y += 7;
  }

  // ── Line items ────────────────────────────────────────────────────────
  y = drawLineItems(doc, job, y + 2) + 4;

  // ── Totals ────────────────────────────────────────────────────────────
  const subtotal = job?.total ?? job?.amount ?? 0;
  y = drawTotals(doc, {
    subtotal,
    showVat:   !!biz?.vatRegistered,
    vatNumber: biz?.vatNumber,
    totalLabel: 'TOTAL DUE',
  }, y);

  // ── Payment details ───────────────────────────────────────────────────
  y += 4;
  rule(doc, y);
  y += 8;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...LIGHT);
  doc.text('PAYMENT DETAILS', MARGIN, y);
  y += 7;

  // Pay-by-card block — shown only when a Stripe Payment Link is set
  const stripeLink = biz?.stripePaymentLink || biz?.stripe_payment_link || '';
  if (stripeLink) {
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK);
    doc.text('Pay by card:', MARGIN, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 91, 204);
    doc.textWithLink(stripeLink, MARGIN, y, { url: stripeLink });
    doc.setTextColor(...MID);
    y += 7;
  }

  // Bank transfer block
  const bankHeader = stripeLink ? 'Or pay by bank transfer:' : 'Bank details:';
  const hasBankFields = biz?.accountName || biz?.sortCode || biz?.accountNumber;

  if (hasBankFields || biz?.bankDetails) {
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK);
    doc.text(bankHeader, MARGIN, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MID);

    if (hasBankFields) {
      if (biz.accountName)   { doc.text(`Name: ${biz.accountName}`,         MARGIN, y); y += 5; }
      if (biz.sortCode)      { doc.text(`Sort code: ${biz.sortCode}`,        MARGIN, y); y += 5; }
      if (biz.accountNumber) { doc.text(`Account: ${biz.accountNumber}`,     MARGIN, y); y += 5; }
    } else {
      biz.bankDetails.split('\n').forEach(line => { doc.text(line, MARGIN, y); y += 5; });
    }
  }

  y += 2;
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(`Reference: ${invoiceNumber}`, MARGIN, y);

  if (biz?.vatRegistered && biz?.vatNumber) {
    y += 6;
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...LIGHT);
    doc.text(`VAT registration: ${biz.vatNumber}`, MARGIN, y);
  }

  // ── Footer ────────────────────────────────────────────────────────────
  drawFooter(doc, biz);

  return doc;
}

export function downloadInvoicePDF(args) {
  const doc = generateInvoicePDF(args);
  doc.save(`${args.invoiceNumber}.pdf`);
}

export function getInvoicePDFBlob(args) {
  const doc = generateInvoicePDF(args);
  return doc.output('blob');
}

// ══════════════════════════════════════════════════════════════════════════
// QUOTE PDF — Phase F
// ══════════════════════════════════════════════════════════════════════════
//
// Differences from the invoice template:
//   - Heading reads "QUOTE" not "INVOICE" (accent green, same size)
//   - No invoice number / due date block — just the date issued
//   - If job.acceptedSignature is present, embeds the PNG below the totals
//     with an "Accepted by customer" label and the acceptedAt date
//   - No bank details (quote is a price proposal, not a payment request)
//
// acceptedSignature: PNG dataURL string captured in the drawer. Embedded with
// doc.addImage; silently skipped if the dataURL fails to decode.

export function generateQuotePDF({ job, biz }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // ── Header ──────────────────────────────────────────────────────────────
  let y = drawHeader(doc, biz);

  // ── Document title block ──────────────────────────────────────────────
  const metaFields = [
    ['Date', new Date().toLocaleDateString('en-GB')],
  ];
  y = drawDocTitle(doc, 'QUOTE', metaFields, y);

  // ── Prepared for ──────────────────────────────────────────────────────
  y = drawRecipientBlock(doc, 'Prepared For', job, y);

  // ── Job description line
  if (job?.summary && (job?.lineItems || []).length > 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...MID);
    doc.text(job.summary, MARGIN, y);
    y += 7;
  }

  // ── Line items ────────────────────────────────────────────────────────
  y = drawLineItems(doc, job, y + 2) + 4;

  // ── Totals ────────────────────────────────────────────────────────────
  const subtotal = job?.total ?? job?.amount ?? 0;
  y = drawTotals(doc, {
    subtotal,
    showVat:   !!biz?.vatRegistered,
    vatNumber: biz?.vatNumber,
    totalLabel: 'QUOTE TOTAL',
  }, y);

  // ── Accepted signature — embed when present ───────────────────────────
  if (job?.acceptedSignature) {
    try {
      y += 4;
      rule(doc, y);
      y += 8;

      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...LIGHT);
      doc.text('ACCEPTED BY CUSTOMER', MARGIN, y);
      y += 5;

      doc.addImage(job.acceptedSignature, 'PNG', MARGIN, y, 80, 40);
      y += 44;

      if (job.acceptedAt) {
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...MID);
        doc.text(
          `Signed: ${new Date(job.acceptedAt).toLocaleString('en-GB')}`,
          MARGIN,
          y,
        );
      }
    } catch {
      // Signature decode failed — skip block, don't crash
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────
  drawFooter(doc, biz);

  return doc;
}

export function downloadQuotePDF(args) {
  const doc = generateQuotePDF(args);
  const customer = (args.job?.customer || 'quote').replace(/\s/g, '-');
  doc.save(`quote-${customer}.pdf`);
}

export function getQuotePDFBlob(args) {
  const doc = generateQuotePDF(args);
  return doc.output('blob');
}
