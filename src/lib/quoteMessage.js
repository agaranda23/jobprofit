// WhatsApp quote-link text builder for the "Send quote link" flow.
// Intentionally lighter than invoiceMessage.js — no bank details, no VAT,
// no due date. This is a pre-work quote, not a payment request.

/**
 * @param {{ job: object, biz: object, quoteUrl: string, depositPayUrl?: string }} params
 *   depositPayUrl — the /p/<token> URL for the deposit Checkout Session.
 *   When set (trader connected + deposit_percent > 0), appended as a separate
 *   tappable line above the main quote link so the customer can pay the deposit
 *   from the WhatsApp message without opening the quote page first.
 *   When absent or empty, the message is unchanged (no deposit, or unconnected).
 */
export function buildQuoteWhatsAppMessage({ job, biz, quoteUrl, depositPayUrl = '' }) {
  const firstName = (job?.customer || job?.customerName || '').split(' ')[0] || '';
  const summary = (job?.summary || job?.name || 'your job').slice(0, 200);
  const total = job?.total ?? job?.amount ?? 0;
  const totalStr = total > 0 ? `£${total.toFixed(2)}` : '';
  const businessName = biz?.name || biz?.business_name || '';

  // Deposit line (PR 4) — only when deposit_percent > 0 and a pay URL exists.
  const depositPercent = Number(job?.deposit_percent ?? 0);
  const depositAmount = depositPercent > 0 && total > 0
    ? `£${(total * depositPercent / 100).toFixed(2)}`
    : '';

  // Link-first ordering: WhatsApp truncates file-share captions on iOS,
  // so the sign URL must sit in the first 2-3 lines or the customer will
  // only see the PDF and miss the call to action. Greeting + sign link
  // come first; details (summary, total, deposit) sit below as context.
  const lines = [
    firstName ? `Hi ${firstName},` : 'Hi,',
    '',
    `📝 Tap to view and sign your quote:`,
    quoteUrl,
    '',
    `🔨 ${summary}`,
  ];
  if (totalStr) lines.push(`💷 Total: ${totalStr}`);

  // Deposit pay link — separate visible block below the sign link.
  if (depositPayUrl && depositAmount) {
    lines.push('');
    lines.push(`Pay ${depositAmount} deposit (locks in your slot):`);
    lines.push(depositPayUrl);
  }

  lines.push('');
  lines.push(`Cheers,`);
  lines.push(businessName);

  return lines.join('\n');
}
