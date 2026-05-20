import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Generates an invoice PDF for the new Get Paid workflow. Distinct from
// the legacy generateInvoicePDF in App.jsx (which uses window.jspdf and
// the old `invoices` collection). This one reads everything from the job
// itself plus the structured biz fields added in PRD #2.

export function generateInvoicePDF({ job, biz, invoiceNumber, dueDate }) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
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

  // INVOICE block
  y = 60;
  doc.setTextColor(30);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE', 14, y);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Number: ${invoiceNumber}`, 14, y + 8);
  doc.text(`Date: ${new Date().toLocaleDateString('en-GB')}`, 14, y + 14);
  doc.text(`Due: ${new Date(dueDate).toLocaleDateString('en-GB')}`, 14, y + 20);

  // Bill to
  y = 95;
  doc.setFontSize(9);
  doc.setTextColor(150);
  doc.text('BILL TO', 14, y);
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

  // Job summary
  y = 120;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30);
  doc.text(job?.summary || 'Work completed', 14, y);

  // Line items
  const items = (job?.lineItems || []).map(li => [li.desc || '', `£${(li.cost || 0).toFixed(2)}`]);
  if (items.length === 0) {
    items.push([job?.summary || 'Work completed', `£${((job?.total ?? job?.amount ?? 0)).toFixed(2)}`]);
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

  // Totals
  const subtotal = job?.total ?? job?.amount ?? 0;
  const showVat = !!biz?.vatRegistered;
  const vat = showVat ? Math.round(subtotal * 0.2 * 100) / 100 : 0;
  const total = subtotal + vat;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Subtotal', pageWidth - 60, afterTable);
  doc.text(`£${subtotal.toFixed(2)}`, pageWidth - 14, afterTable, { align: 'right' });
  if (showVat) {
    afterTable += 6;
    doc.text('VAT (20%)', pageWidth - 60, afterTable);
    doc.text(`£${vat.toFixed(2)}`, pageWidth - 14, afterTable, { align: 'right' });
  }
  afterTable += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('TOTAL', pageWidth - 60, afterTable);
  doc.text(`£${total.toFixed(2)}`, pageWidth - 14, afterTable, { align: 'right' });

  // Payment details — prefer structured fields, fallback to legacy blob
  afterTable += 16;
  doc.setFontSize(9);
  doc.setTextColor(150);
  doc.setFont('helvetica', 'normal');
  doc.text('PAYMENT DETAILS', 14, afterTable);
  afterTable += 6;
  doc.setFontSize(10);
  doc.setTextColor(60);
  if (biz?.accountName || biz?.sortCode || biz?.accountNumber) {
    if (biz.accountName) { doc.text(`Name: ${biz.accountName}`, 14, afterTable); afterTable += 5; }
    if (biz.sortCode) { doc.text(`Sort code: ${biz.sortCode}`, 14, afterTable); afterTable += 5; }
    if (biz.accountNumber) { doc.text(`Account: ${biz.accountNumber}`, 14, afterTable); afterTable += 5; }
  } else if (biz?.bankDetails) {
    biz.bankDetails.split('\n').forEach(line => {
      doc.text(line, 14, afterTable);
      afterTable += 5;
    });
  }
  afterTable += 4;
  doc.setFont('helvetica', 'bold');
  doc.text(`Reference: ${invoiceNumber}`, 14, afterTable);

  if (showVat && biz?.vatNumber) {
    afterTable += 8;
    doc.setFont('helvetica', 'normal');
    doc.text(`VAT registration: ${biz.vatNumber}`, 14, afterTable);
  }

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 12;
  doc.setFontSize(8);
  doc.setTextColor(170);
  doc.text(`${biz?.name || 'JobProfit'} • Generated ${new Date().toLocaleDateString('en-GB')}`, pageWidth / 2, footerY, { align: 'center' });

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

// ── Quote PDF — Phase F ────────────────────────────────────────────────────
//
// Generates a QUOTE document instead of an invoice. Differences from the
// invoice template:
//   - Heading reads "QUOTE" not "INVOICE"
//   - No invoice number / due date block
//   - If job.acceptedSignature is present, embeds the PNG below the totals
//     with an "Accepted by customer" label and the acceptedAt date
//
// acceptedSignature: PNG dataURL string (~5 KB) captured in the drawer.
// The signature is embedded with doc.addImage so it appears inline in the
// generated PDF. If the dataURL is absent or fails to decode we skip the
// block silently rather than crashing the download.

export function generateQuotePDF({ job, biz }) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header — same as invoice
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

  // QUOTE heading
  y = 60;
  doc.setTextColor(30);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('QUOTE', 14, y);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${new Date().toLocaleDateString('en-GB')}`, 14, y + 8);

  // Bill to
  y = 90;
  doc.setFontSize(9);
  doc.setTextColor(150);
  doc.text('PREPARED FOR', 14, y);
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

  // Summary
  y = 115;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30);
  doc.text(job?.summary || 'Work to be completed', 14, y);

  // Line items
  const items = (job?.lineItems || []).map(li => [li.desc || '', `£${(li.cost || 0).toFixed(2)}`]);
  if (items.length === 0) {
    items.push([job?.summary || 'Work to be completed', `£${((job?.total ?? job?.amount ?? 0)).toFixed(2)}`]);
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

  // Totals
  const subtotal = job?.total ?? job?.amount ?? 0;
  const showVat = !!biz?.vatRegistered;
  const vat = showVat ? Math.round(subtotal * 0.2 * 100) / 100 : 0;
  const total = subtotal + vat;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text('Subtotal', pageWidth - 60, afterTable);
  doc.text(`£${subtotal.toFixed(2)}`, pageWidth - 14, afterTable, { align: 'right' });
  if (showVat) {
    afterTable += 6;
    doc.text('VAT (20%)', pageWidth - 60, afterTable);
    doc.text(`£${vat.toFixed(2)}`, pageWidth - 14, afterTable, { align: 'right' });
  }
  afterTable += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(30);
  doc.text('TOTAL', pageWidth - 60, afterTable);
  doc.text(`£${total.toFixed(2)}`, pageWidth - 14, afterTable, { align: 'right' });

  if (showVat && biz?.vatNumber) {
    afterTable += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`VAT registration: ${biz.vatNumber}`, 14, afterTable);
  }

  // Accepted signature — embed when present
  if (job?.acceptedSignature) {
    try {
      afterTable += 16;
      doc.setFontSize(9);
      doc.setTextColor(150);
      doc.setFont('helvetica', 'normal');
      doc.text('ACCEPTED BY CUSTOMER', 14, afterTable);
      afterTable += 4;
      // Signature image: 80px wide × 40px tall on the page
      doc.addImage(job.acceptedSignature, 'PNG', 14, afterTable, 80, 40);
      afterTable += 44;
      if (job.acceptedAt) {
        doc.setFontSize(9);
        doc.setTextColor(100);
        doc.text(
          `Signed: ${new Date(job.acceptedAt).toLocaleString('en-GB')}`,
          14,
          afterTable,
        );
      }
    } catch {
      // Signature decode failed — skip block, don't crash
    }
  }

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 12;
  doc.setFontSize(8);
  doc.setTextColor(170);
  doc.text(`${biz?.name || 'JobProfit'} • Generated ${new Date().toLocaleDateString('en-GB')}`, pageWidth / 2, footerY, { align: 'center' });

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
