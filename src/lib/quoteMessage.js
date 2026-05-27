// WhatsApp quote-link text builder for the "Send quote link" flow.
// Intentionally lighter than invoiceMessage.js — no bank details, no VAT,
// no due date. This is a pre-work quote, not a payment request.

export function buildQuoteWhatsAppMessage({ job, biz, quoteUrl }) {
  const firstName = (job?.customer || job?.customerName || '').split(' ')[0] || '';
  const summary = (job?.summary || job?.name || 'your job').slice(0, 200);
  const total = job?.total ?? job?.amount ?? 0;
  const totalStr = total > 0 ? `£${total.toFixed(2)}` : '';
  const businessName = biz?.name || biz?.business_name || '';

  const lines = [
    firstName ? `Hi ${firstName},` : 'Hi,',
    '',
    `Here's your quote for:`,
    `🔨 ${summary}`,
  ];
  if (totalStr) lines.push(`💷 Total: ${totalStr}`);
  lines.push('');
  lines.push(`Tap to view and sign:`);
  lines.push(quoteUrl);
  lines.push('');
  lines.push(`Cheers,`);
  lines.push(businessName);

  return lines.join('\n');
}
