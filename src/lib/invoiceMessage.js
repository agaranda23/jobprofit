// WhatsApp invoice text + wa.me link builder for the new Get Paid flow.
// Distinct from the legacy waInvoiceLink in App.jsx (which uses the old
// `invoices` collection). This one reads directly from the job + biz.

const WA_URL_LIMIT = 2000; // wa.me practical URL cap; truncate long summaries

export function buildInvoiceWhatsAppMessage({ job, biz, invoiceNumber, dueDate }) {
  const customer = (job?.customer || job?.customerName || '').split(' ')[0] || '';
  const total = job?.total ?? job?.amount ?? 0;
  const showVat = !!biz?.vatRegistered;
  const grossTotal = showVat ? total + Math.round(total * 0.2 * 100) / 100 : total;
  const dueStr = new Date(dueDate).toLocaleDateString('en-GB');
  const summary = (job?.summary || 'Work completed').slice(0, 200);

  const lines = [
    `Hi ${customer},`,
    '',
    `Here's your invoice:`,
    `📄 ${invoiceNumber}`,
    `🔨 ${summary}`,
    `💷 £${grossTotal.toFixed(2)}${showVat ? ' (inc VAT)' : ''}`,
    `📅 Due: ${dueStr}`,
    '',
  ];

  if (biz?.accountName || biz?.sortCode || biz?.accountNumber) {
    lines.push('Bank details:');
    if (biz.accountName) lines.push(`Name: ${biz.accountName}`);
    if (biz.sortCode) lines.push(`Sort code: ${biz.sortCode}`);
    if (biz.accountNumber) lines.push(`Account: ${biz.accountNumber}`);
    lines.push('');
  } else if (biz?.bankDetails) {
    lines.push('Bank details:');
    lines.push(biz.bankDetails);
    lines.push('');
  }

  lines.push(`Ref: ${invoiceNumber}`);
  lines.push('');
  lines.push(`Cheers,`);
  lines.push(biz?.name || '');

  return lines.join('\n');
}

// Normalises a UK phone number for wa.me. Strips spaces, replaces a leading
// 0 with the UK country code 44, and drops a leading +. Returns '' if no
// usable digits — wa.me will then open with no recipient (acceptable
// degradation per PRD).
export function buildWhatsAppLink({ phone, message }) {
  const cleanPhone = (phone || '').replace(/\s/g, '').replace(/^0/, '44').replace(/^\+/, '');
  const link = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  if (link.length > WA_URL_LIMIT) {
    // Encoded message is too long; rare with our ~200-char summary cap, but
    // safe-guard against huge bank details blobs by trimming the message.
    const baseLen = `https://wa.me/${cleanPhone}?text=`.length;
    const room = WA_URL_LIMIT - baseLen;
    const truncated = encodeURIComponent(message).slice(0, room);
    return `https://wa.me/${cleanPhone}?text=${truncated}`;
  }
  return link;
}
