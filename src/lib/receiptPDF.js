import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { resolvePaidDate, resolveAmountPaid, formatReceiptDate } from './receiptMessage.js';

/**
 * Generates a branded RECEIPT PDF.
 *
 * Visually mirrors generateInvoicePDF (same header, same biz block,
 * same line-items table) but labelled RECEIPT and carries:
 *   - A "PAID IN FULL" stamp instead of due-date / invoice-number block
 *   - Paid date (sourced via resolvePaidDate — payments[] first, paidAt second)
 *   - Amount paid (sourced via resolveAmountPaid)
 *   - A short thank-you line in the footer section
 *
 * No bank details are shown — this is a confirmation of payment received,
 * not a payment request.
 */
export function generateReceiptPDF({ job, biz }) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  const amountPaid = resolveAmountPaid(job);
  const paidDate = resolvePaidDate(job);
  const paidDateLabel = formatReceiptDate(paidDate);

  // ── Business header (identical to invoice) ──────────────────────────────
  let y = 20;
  if (biz?.logoUrl) {
    try { doc.addImage(biz.logoUrl, 'JPEG', 14, y, 30, 30); } catch { /* logo decode failed */ }
  }
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(biz?.name || 'Your Business', pageWidth - 14, y + 8, { align: 'right' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  if (biz?.address) doc.text(biz.address, pageWidth - 14, y + 16, { align: 'right' });
  const contact = [biz?.phone, biz?.email].filter(Boolean).join(' • ');
  if (contact) doc.text(contact, pageWidth - 14, y + 22, { align: 'right' });

  // ── RECEIPT heading block ────────────────────────────────────────────────
  y = 60;
  doc.setTextColor(30);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('RECEIPT', 14, y);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${paidDateLabel}`, 14, y + 8);

  // ── Bill to ─────────────────────────────────────────────────────────────
  y = 90;
  doc.setFontSize(9);
  doc.setTextColor(150);
  doc.text('RECEIVED FROM', 14, y);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30);
  doc.text(job?.customer || job?.customerName || 'Customer', 14, y + 7);
  if (job?.address) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80);
    doc.text(job.address, 14, y + 13);
  }

  // ── Job summary ─────────────────────────────────────────────────────────
  y = 115;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30);
  doc.text(job?.summary || 'Work completed', 14, y);

  // ── Line items (same as invoice) ────────────────────────────────────────
  const items = (job?.lineItems || []).map(li => [li.desc || '', `£${(li.cost || 0).toFixed(2)}`]);
  if (items.length === 0) {
    items.push([job?.summary || 'Work completed', `£${(job?.total ?? job?.amount ?? 0).toFixed(2)}`]);
  }
  autoTable(doc, {
    startY: y + 6,
    head: [['Description', 'Amount']],
    body: items,
    theme: 'striped',
    headStyles: { fillColor: [30, 30, 30] },
    styles: { fontSize: 10 },
    columnStyles: { 1: { halign: 'right', cellWidth: 40 } },
  });

  let afterTable = doc.lastAutoTable.finalY + 8;

  // ── Amount paid row ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text('Subtotal', pageWidth - 60, afterTable);
  doc.text(`£${(job?.total ?? job?.amount ?? 0).toFixed(2)}`, pageWidth - 14, afterTable, { align: 'right' });

  afterTable += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(30);
  doc.text('AMOUNT PAID', pageWidth - 60, afterTable);
  doc.text(`£${amountPaid.toFixed(2)}`, pageWidth - 14, afterTable, { align: 'right' });

  // ── PAID IN FULL stamp ───────────────────────────────────────────────────
  afterTable += 16;
  doc.setFillColor(14, 107, 67); // #0E6B43 — Paid stage green
  doc.roundedRect(14, afterTable - 6, pageWidth - 28, 20, 3, 3, 'F');
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(179, 240, 213); // #B3F0D5 — light mint ink
  doc.text('PAID IN FULL', pageWidth / 2, afterTable + 7, { align: 'center' });

  afterTable += 28;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(`Payment received: ${paidDateLabel}`, 14, afterTable);

  // ── Thank-you ────────────────────────────────────────────────────────────
  afterTable += 12;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(80);
  doc.text('Thank you for your business.', 14, afterTable);

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerY = doc.internal.pageSize.getHeight() - 12;
  doc.setFontSize(8);
  doc.setTextColor(170);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${biz?.name || 'JobProfit'} • Receipt generated ${new Date().toLocaleDateString('en-GB')}`,
    pageWidth / 2,
    footerY,
    { align: 'center' },
  );

  return doc;
}

export function downloadReceiptPDF({ job, biz }) {
  const doc = generateReceiptPDF({ job, biz });
  const customer = (job?.customer || job?.name || 'receipt').replace(/\s+/g, '-');
  doc.save(`receipt-${customer}.pdf`);
}

export function getReceiptPDFBlob({ job, biz }) {
  const doc = generateReceiptPDF({ job, biz });
  return doc.output('blob');
}
